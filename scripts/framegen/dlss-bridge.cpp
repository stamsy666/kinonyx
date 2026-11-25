// DLSS-G bridge for decoded SDR video in the VapourSynth filter.
#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>
#include <d3d12.h>
#include <dxgi1_6.h>
#include <wrl/client.h>
#include "nvsdk_ngx_helpers_dlssg_d3d.h"

#include <array>
#include <cstdint>
#include <mutex>
#include <stdexcept>
using Microsoft::WRL::ComPtr;

static void check(HRESULT value, const char* operation)
{
    if (FAILED(value)) {
        throw std::runtime_error(operation);
    }
}

static void ngx_check(NVSDK_NGX_Result value, const char* operation)
{
    if (NVSDK_NGX_FAILED(value)) {
        throw std::runtime_error(operation);
    }
}

struct Context {
    ComPtr<ID3D12Device> device;
    ComPtr<ID3D12CommandQueue> queue;
    ComPtr<ID3D12CommandAllocator> allocator;
    ComPtr<ID3D12GraphicsCommandList> list;
    ComPtr<ID3D12Fence> fence;
    UINT64 timeline = 0;

    Context()
    {
        ComPtr<IDXGIFactory4> factory;
        check(CreateDXGIFactory1(IID_PPV_ARGS(&factory)), "CreateDXGIFactory1");
        for (UINT index = 0; !device; ++index) {
            ComPtr<IDXGIAdapter1> adapter;
            if (factory->EnumAdapters1(index, &adapter) == DXGI_ERROR_NOT_FOUND) break;
            DXGI_ADAPTER_DESC1 desc{};
            if (FAILED(adapter->GetDesc1(&desc)) || desc.VendorId != 0x10de) continue;
            check(D3D12CreateDevice(adapter.Get(), D3D_FEATURE_LEVEL_12_0, IID_PPV_ARGS(&device)), "D3D12CreateDevice");
        }
        if (!device) check(E_FAIL, "No NVIDIA D3D12 device");
        D3D12_COMMAND_QUEUE_DESC q{};
        q.Type = D3D12_COMMAND_LIST_TYPE_DIRECT;
        check(device->CreateCommandQueue(&q, IID_PPV_ARGS(&queue)), "CreateCommandQueue");
        check(device->CreateCommandAllocator(q.Type, IID_PPV_ARGS(&allocator)), "CreateCommandAllocator");
        check(device->CreateCommandList(0, q.Type, allocator.Get(), nullptr, IID_PPV_ARGS(&list)), "CreateCommandList");
        check(device->CreateFence(0, D3D12_FENCE_FLAG_NONE, IID_PPV_ARGS(&fence)), "CreateFence");
    }

    void submit()
    {
        check(list->Close(), "Close");
        ID3D12CommandList* lists[]{list.Get()};
        queue->ExecuteCommandLists(1, lists);
        check(queue->Signal(fence.Get(), ++timeline), "Signal");
        HANDLE event = CreateEventW(nullptr, FALSE, FALSE, nullptr);
        if (!event) check(HRESULT_FROM_WIN32(GetLastError()), "CreateEventW");
        check(fence->SetEventOnCompletion(timeline, event), "SetEventOnCompletion");
        if (WaitForSingleObject(event, 10000) != WAIT_OBJECT_0) check(E_ABORT, "GPU timeout");
        CloseHandle(event);
        check(device->GetDeviceRemovedReason(), "Device health");
        check(allocator->Reset(), "Reset allocator");
        check(list->Reset(allocator.Get(), nullptr), "Reset list");
    }

    ComPtr<ID3D12Resource> allocate(const D3D12_RESOURCE_DESC& desc, D3D12_HEAP_TYPE type, D3D12_RESOURCE_STATES state)
    {
        D3D12_HEAP_PROPERTIES heap{};
        heap.Type = type;
        ComPtr<ID3D12Resource> resource;
        check(device->CreateCommittedResource(&heap,D3D12_HEAP_FLAG_NONE,&desc,state,nullptr,IID_PPV_ARGS(&resource)),
              "CreateCommittedResource");
        return resource;
    }

    ComPtr<ID3D12Resource> buffer(UINT64 size, D3D12_HEAP_TYPE type, D3D12_RESOURCE_STATES state)
    {
        D3D12_RESOURCE_DESC desc{};
        desc.Dimension = D3D12_RESOURCE_DIMENSION_BUFFER;
        desc.Width = size;
        desc.Height = 1;
        desc.DepthOrArraySize = 1;
        desc.MipLevels = 1;
        desc.SampleDesc.Count = 1;
        desc.Layout = D3D12_TEXTURE_LAYOUT_ROW_MAJOR;
        return allocate(desc, type, state);
    }
};

struct Texture {
    ComPtr<ID3D12Resource> texture;
    ComPtr<ID3D12Resource> transfer;
    D3D12_PLACED_SUBRESOURCE_FOOTPRINT layout{};
    D3D12_RESOURCE_STATES state;
    UINT64 bytes = 0;
    UINT width;
    UINT height;

    Texture(Context& gpu, UINT w, UINT h, DXGI_FORMAT format, bool output)
        : state(output ? D3D12_RESOURCE_STATE_UNORDERED_ACCESS : D3D12_RESOURCE_STATE_COPY_DEST), width(w), height(h)
    {
        D3D12_RESOURCE_DESC desc{};
        desc.Dimension = D3D12_RESOURCE_DIMENSION_TEXTURE2D;
        desc.Width = width;
        desc.Height = height;
        desc.DepthOrArraySize = 1;
        desc.MipLevels = 1;
        desc.SampleDesc.Count = 1;
        desc.Format = format;
        if (output) desc.Flags = D3D12_RESOURCE_FLAG_ALLOW_UNORDERED_ACCESS;
        texture = gpu.allocate(desc, D3D12_HEAP_TYPE_DEFAULT, state);
        gpu.device->GetCopyableFootprints(&desc,0,1,0,&layout,nullptr,nullptr,&bytes);
        transfer = gpu.buffer(bytes, output ? D3D12_HEAP_TYPE_READBACK : D3D12_HEAP_TYPE_UPLOAD,
            output ? D3D12_RESOURCE_STATE_COPY_DEST : D3D12_RESOURCE_STATE_GENERIC_READ);
    }

    void transition(Context& gpu, D3D12_RESOURCE_STATES target)
    {
        if (state == target) return;
        D3D12_RESOURCE_BARRIER barrier{};
        barrier.Type = D3D12_RESOURCE_BARRIER_TYPE_TRANSITION;
        barrier.Transition = {texture.Get(), D3D12_RESOURCE_BARRIER_ALL_SUBRESOURCES, state, target};
        gpu.list->ResourceBarrier(1, &barrier);
        state = target;
    }

    void copy(Context& gpu, bool to_texture)
    {
        D3D12_TEXTURE_COPY_LOCATION destination{}, source{};
        auto& t = to_texture ? destination : source;
        auto& b = to_texture ? source : destination;
        t.pResource = texture.Get();
        t.Type = D3D12_TEXTURE_COPY_TYPE_SUBRESOURCE_INDEX;
        b.pResource = transfer.Get();
        b.Type = D3D12_TEXTURE_COPY_TYPE_PLACED_FOOTPRINT;
        b.PlacedFootprint = layout;
        gpu.list->CopyTextureRegion(&destination,0,0,0,&source,nullptr);
    }

    template<class Pixel>
    void upload(Context& gpu, Pixel pixel)
    {
        void* data = nullptr;
        D3D12_RANGE read{};
        check(transfer->Map(0,&read,&data), "Map upload");
        auto rows = static_cast<uint8_t*>(data) + layout.Offset;
        for (UINT y=0; y<height; ++y) {
            auto row = reinterpret_cast<uint32_t*>(rows + y*layout.Footprint.RowPitch);
            for (UINT x=0; x<width; ++x) row[x] = pixel(x,y);
        }
        transfer->Unmap(0,nullptr);
        transition(gpu,D3D12_RESOURCE_STATE_COPY_DEST);
        copy(gpu,true);
        transition(gpu,D3D12_RESOURCE_STATE_NON_PIXEL_SHADER_RESOURCE | D3D12_RESOURCE_STATE_PIXEL_SHADER_RESOURCE);
    }

    void download(uint8_t* rgb)
    {
        void* data = nullptr;
        check(transfer->Map(0, nullptr, &data), "Map readback");
        const auto rows = static_cast<const uint8_t*>(data) + layout.Offset;
        const size_t plane_size = static_cast<size_t>(width) * height;
        for (UINT y = 0; y < height; ++y) {
            const auto row = rows + y * layout.Footprint.RowPitch;
            const auto offset = static_cast<size_t>(y) * width;
            for (UINT x = 0; x < width; ++x) {
                rgb[offset + x] = row[4 * x];
                rgb[plane_size + offset + x] = row[4 * x + 1];
                rgb[2 * plane_size + offset + x] = row[4 * x + 2];
            }
        }
        D3D12_RANGE empty{};
        transfer->Unmap(0, &empty);
    }
};

static NVSDK_NGX_DLSSG_Opt_Eval_Params options(UINT width, UINT height, UINT count, UINT index, bool reset)
{
    NVSDK_NGX_DLSSG_Opt_Eval_Params opt{};
    for (int i=0;i<4;++i) {
        opt.cameraViewToClip[i][i] = 1;
        opt.clipToCameraView[i][i] = 1;
        opt.clipToLensClip[i][i] = 1;
        opt.clipToPrevClip[i][i] = 1;
        opt.prevClipToClip[i][i] = 1;
    }
    opt.cameraNear = 0.1f;
    opt.cameraFar = 1000.0f;
    opt.cameraFOV = 1.5707963f;
    opt.cameraAspectRatio = static_cast<float>(width)/height;
    opt.cameraUp[1] = opt.cameraRight[0] = opt.cameraFwd[2] = 1;
    opt.cameraViewToClip[0][0] = 1 / opt.cameraAspectRatio;
    float z = opt.cameraFar/(opt.cameraFar-opt.cameraNear);
    opt.cameraViewToClip[2][2] = z;
    opt.cameraViewToClip[2][3] = 1;
    opt.cameraViewToClip[3][2] = -opt.cameraNear*z;
    opt.mvecScale[0] = opt.mvecScale[1] = 1;
    opt.colorBuffersHDR = false;
    opt.depthInverted = false;
    opt.cameraMotionIncluded = true;
    opt.reset = reset;
    opt.motionVectorsInvalidValue = 3.402823466e38f;
    opt.minRelativeLinearDepthObjectSeparation = 40;
    opt.backbufferSubrectSize = opt.outputInterpSubrectSize = opt.mvecsSubrectSize = opt.depthSubrectSize = {width,height};
    opt.multiFrameCount = count;
    opt.multiFrameIndex = index;
    return opt;
}

// NGX is process-wide, including temporary overlap when mpv replaces a filter graph.
std::mutex ngx_mutex;

struct Ngx {
    Context& gpu;
    NVSDK_NGX_Parameter* params = nullptr;
    NVSDK_NGX_Handle* handle = nullptr;
    bool initialized = false;

    explicit Ngx(Context& context) : gpu(context) {}

    void start(const wchar_t* runtime, const wchar_t* cache, UINT width, UINT height, UINT count)
    {
        const wchar_t* search[]{runtime};
        NVSDK_NGX_FeatureCommonInfo common{};
        common.PathListInfo.Path = search;
        common.PathListInfo.Length = 1;
        ngx_check(NVSDK_NGX_D3D12_Init_with_ProjectID("a491bb67-2854-40ba-992e-0662405ddc94",
            NVSDK_NGX_ENGINE_TYPE_CUSTOM, "1.0", cache, gpu.device.Get(), &common, NVSDK_NGX_Version_API), "NGX init");
        initialized = true;

        if (count == 2) {
            NVSDK_NGX_Parameter* caps = nullptr;
            ngx_check(NVSDK_NGX_D3D12_GetCapabilityParameters(&caps), "NGX capabilities");
            unsigned max = 0;
            NVSDK_NGX_Parameter_GetUI(caps, NVSDK_NGX_DLSSG_Parameter_MultiFrameCountMax, &max);
            NVSDK_NGX_D3D12_DestroyParameters(caps);
            if (max < count) throw std::runtime_error("DLSS-G x3 unsupported");
        }
        ngx_check(NVSDK_NGX_D3D12_AllocateParameters(&params), "Allocate parameters");
        NVSDK_NGX_Parameter_SetUI(params, NVSDK_NGX_DLSSG_Parameter_ResourceAlwaysProvided_Flags,
            NVSDK_NGX_DLSSG_ResourceFlags_Backbuffer | NVSDK_NGX_DLSSG_ResourceFlags_MVecs |
            NVSDK_NGX_DLSSG_ResourceFlags_Depth | NVSDK_NGX_DLSSG_ResourceFlags_OutputInterpolated);
        NVSDK_NGX_Parameter_SetUI(params, NVSDK_NGX_DLSSG_Parameter_ResourceNeverProvided_Flags,
            NVSDK_NGX_DLSSG_ResourceFlags_HUDLess | NVSDK_NGX_DLSSG_ResourceFlags_UI |
            NVSDK_NGX_DLSSG_ResourceFlags_UIAlpha | NVSDK_NGX_DLSSG_ResourceFlags_BidirectionalDistortionField);
        NVSDK_NGX_DLSSG_Create_Params settings{};
        settings.Width = settings.RenderWidth = width;
        settings.Height = settings.RenderHeight = height;
        settings.NativeBackbufferFormat = DXGI_FORMAT_R8G8B8A8_UNORM;
        ngx_check(NGX_D3D12_CREATE_DLSSG(gpu.list.Get(), 1, 1, &handle, params, &settings), "Create DLSS-G");
        gpu.submit();
    }

    ~Ngx()
    {
        if (handle) NVSDK_NGX_D3D12_ReleaseFeature(handle);
        if (params) NVSDK_NGX_D3D12_DestroyParameters(params);
        if (initialized) NVSDK_NGX_D3D12_Shutdown1(gpu.device.Get());
    }
};

struct Generator {
    Context gpu;
    Ngx ngx{gpu};
    Texture color;
    Texture depth;
    Texture motion;
    std::array<Texture, 2> outputs;
    UINT width;
    UINT height;
    UINT count;
    UINT64 frame_id = 0;

    Generator(UINT w, UINT h, UINT generated, const wchar_t* runtime, const wchar_t* cache)
        : color(gpu, w, h, DXGI_FORMAT_R8G8B8A8_UNORM, false),
          depth(gpu, w, h, DXGI_FORMAT_R32_FLOAT, false),
          motion(gpu, w, h, DXGI_FORMAT_R16G16_FLOAT, false),
          outputs{Texture(gpu, w, h, DXGI_FORMAT_R8G8B8A8_UNORM, true),
                  Texture(gpu, w, h, DXGI_FORMAT_R8G8B8A8_UNORM, true)},
          width(w), height(h), count(generated)
    {
        ngx.start(runtime, cache, w, h, generated);
        depth.upload(gpu, [](UINT, UINT) { return 0x3f000000u; });
        motion.upload(gpu, [](UINT, UINT) { return 0u; });
        gpu.submit();
    }

    void push(const uint8_t* r, const uint8_t* g, const uint8_t* b, UINT stride, bool reset,
              uint8_t* first, uint8_t* second)
    {
        color.upload(gpu, [&](UINT x, UINT y) {
            const auto offset = static_cast<size_t>(y) * stride + x;
            return 0xff000000u | (static_cast<uint32_t>(b[offset]) << 16)
                | (static_cast<uint32_t>(g[offset]) << 8) | r[offset];
        });
        NVSDK_NGX_Parameter_SetULL(ngx.params, NVSDK_NGX_DLSSG_Parameter_BackbufferFrameID, ++frame_id);
        uint8_t* destination[]{first, second};
        for (UINT i = 0; i < count; ++i) {
            auto& output = outputs[i];
            output.transition(gpu, D3D12_RESOURCE_STATE_UNORDERED_ACCESS);
            NVSDK_NGX_D3D12_DLSSG_Eval_Params eval{};
            eval.pBackbuffer = color.texture.Get();
            eval.pDepth = depth.texture.Get();
            eval.pMVecs = motion.texture.Get();
            eval.pOutputInterpFrame = output.texture.Get();
            auto opt = options(width, height, count, i + 1, reset);
            ngx_check(NGX_D3D12_EVALUATE_DLSSG(gpu.list.Get(), ngx.handle, ngx.params, &eval, &opt), "Evaluate DLSS-G");
            if (destination[i]) {
                output.transition(gpu, D3D12_RESOURCE_STATE_COPY_SOURCE);
                output.copy(gpu, false);
            }
        }
        gpu.submit();
        for (UINT i = 0; i < count; ++i) {
            if (destination[i]) outputs[i].download(destination[i]);
        }
    }
};

static void report(const std::exception& error)
{
    OutputDebugStringA(error.what());
}

extern "C" __declspec(dllexport) void* kx_dlss_create(UINT width, UINT height, UINT generated,
                                                     const wchar_t* runtime, const wchar_t* cache)
{
    if ((generated != 1 && generated != 2) || width == 0 || height == 0 || width > 1920 || height > 1080)
        return nullptr;
    std::lock_guard lock(ngx_mutex);
    try {
        return new Generator(width, height, generated, runtime, cache);
    } catch (const std::exception& error) {
        report(error);
        return nullptr;
    }
}

extern "C" __declspec(dllexport) int kx_dlss_push(void* handle, const uint8_t* r, const uint8_t* g,
                                                 const uint8_t* b, UINT stride, int reset,
                                                 uint8_t* first, uint8_t* second)
{
    if (!handle || !r || !g || !b) return 0;
    auto& generator = *static_cast<Generator*>(handle);
    std::lock_guard lock(ngx_mutex);
    try {
        generator.push(r, g, b, stride, reset != 0, first, second);
        return 1;
    } catch (const std::exception& error) {
        report(error);
        return 0;
    }
}

extern "C" __declspec(dllexport) void kx_dlss_destroy(void* handle)
{
    std::lock_guard lock(ngx_mutex);
    delete static_cast<Generator*>(handle);
}

