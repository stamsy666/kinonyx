#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>
#include <d3d12.h>
#include <dxgi1_6.h>
#include <wrl/client.h>
#include "nvsdk_ngx_helpers_dlssg_d3d.h"
#include <chrono>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <filesystem>
#include <cwchar>

using Microsoft::WRL::ComPtr;
constexpr UINT width = 1920;
constexpr UINT height = 1080;

static void check(HRESULT value, const char* operation)
{
    if (FAILED(value)) {
        std::fprintf(stderr, "%s: HRESULT 0x%08lx\n", operation, static_cast<unsigned long>(value));
        std::exit(1);
    }
}

static void ngx_check(NVSDK_NGX_Result value, const char* operation)
{
    if (NVSDK_NGX_FAILED(value)) {
        std::fprintf(stderr, "%s: NGX 0x%08x\n", operation, static_cast<unsigned>(value));
        std::exit(2);
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
            std::wprintf(L"GPU: %ls\n", desc.Description);
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

    Texture(Context& gpu, DXGI_FORMAT format, bool output)
        : state(output ? D3D12_RESOURCE_STATE_UNORDERED_ACCESS : D3D12_RESOURCE_STATE_COPY_DEST)
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

    double centroid()
    {
        void* data = nullptr;
        check(transfer->Map(0,nullptr,&data),"Map readback");
        auto rows = static_cast<const uint8_t*>(data)+layout.Offset;
        uint64_t weighted=0, total=0;
        for (UINT y=0; y<height; ++y) {
            auto row = rows+y*layout.Footprint.RowPitch;
            for (UINT x=0; x<width; ++x) {
                if (row[x*4]>175) {
                    weighted += x;
                    ++total;
                }
            }
        }
        D3D12_RANGE empty{};
        transfer->Unmap(0,&empty);
        return total ? static_cast<double>(weighted)/total : -1;
    }
};

static NVSDK_NGX_DLSSG_Opt_Eval_Params options(UINT count, UINT index, bool reset)
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

int wmain(int argc, wchar_t** argv)
{
    if (argc != 3) {
        std::fwprintf(stderr, L"Usage: probe.exe <directory containing nvngx_dlssg.dll> <1 or 2 generated frames>\n");
        return 4;
    }
    UINT count = static_cast<UINT>(std::wcstoul(argv[2],nullptr,10));
    if (count < 1 || count > 2) return 4;
    Context gpu;
    const wchar_t* dll_dir[]{argv[1]};
    auto cache = std::filesystem::current_path() / L"ngx-cache";
    std::filesystem::create_directories(cache);
    NVSDK_NGX_FeatureCommonInfo common{};
    common.PathListInfo.Path = dll_dir;
    common.PathListInfo.Length = 1;
    ngx_check(NVSDK_NGX_D3D12_Init_with_ProjectID("a491bb67-2854-40ba-992e-0662405ddc94",NVSDK_NGX_ENGINE_TYPE_CUSTOM,
        "1.0",cache.c_str(),gpu.device.Get(),&common,NVSDK_NGX_Version_API),"NGX init");

    NVSDK_NGX_Parameter* caps = nullptr;
    ngx_check(NVSDK_NGX_D3D12_GetCapabilityParameters(&caps),"NGX capabilities");
    unsigned max = 0;
    auto result = NVSDK_NGX_Parameter_GetUI(caps,NVSDK_NGX_DLSSG_Parameter_MultiFrameCountMax,&max);
    std::printf("Reported maximum generated frames: %u (status 0x%x)\n",max,static_cast<unsigned>(result));
    NVSDK_NGX_D3D12_DestroyParameters(caps);
    NVSDK_NGX_Parameter* params = nullptr;
    ngx_check(NVSDK_NGX_D3D12_AllocateParameters(&params),"Allocate parameters");
    NVSDK_NGX_Parameter_SetUI(params,NVSDK_NGX_DLSSG_Parameter_ResourceAlwaysProvided_Flags,
        NVSDK_NGX_DLSSG_ResourceFlags_Backbuffer | NVSDK_NGX_DLSSG_ResourceFlags_MVecs |
        NVSDK_NGX_DLSSG_ResourceFlags_Depth | NVSDK_NGX_DLSSG_ResourceFlags_OutputInterpolated);
    NVSDK_NGX_Parameter_SetUI(params,NVSDK_NGX_DLSSG_Parameter_ResourceNeverProvided_Flags,
        NVSDK_NGX_DLSSG_ResourceFlags_HUDLess | NVSDK_NGX_DLSSG_ResourceFlags_UI |
        NVSDK_NGX_DLSSG_ResourceFlags_UIAlpha | NVSDK_NGX_DLSSG_ResourceFlags_BidirectionalDistortionField);
    NVSDK_NGX_DLSSG_Create_Params create{};
    create.Width = create.RenderWidth = width;
    create.Height = create.RenderHeight = height;
    create.NativeBackbufferFormat = DXGI_FORMAT_R8G8B8A8_UNORM;
    NVSDK_NGX_Handle* handle = nullptr;
    ngx_check(NGX_D3D12_CREATE_DLSSG(gpu.list.Get(),1,1,&handle,params,&create),"Create DLSS-G");
    gpu.submit();
    if (auto module = GetModuleHandleW(L"nvngx_dlssg.dll")) {
        wchar_t path[32768]{};
        if (GetModuleFileNameW(module, path, ARRAYSIZE(path))) std::wprintf(L"DLSS provider: %ls\n", path);
    }
    Texture color(gpu,DXGI_FORMAT_R8G8B8A8_UNORM,false);
    Texture depth(gpu,DXGI_FORMAT_R32_FLOAT,false);
    Texture motion(gpu,DXGI_FORMAT_R16G16_FLOAT,false);
    Texture output1(gpu,DXGI_FORMAT_R8G8B8A8_UNORM,true);
    Texture output2(gpu,DXGI_FORMAT_R8G8B8A8_UNORM,true);
    Texture* outputs[]{&output1,&output2};
    depth.upload(gpu,[](UINT,UINT){return 0x3f000000u;});
    bool correct = true;
    for (UINT frame = 0; frame < 6; ++frame) {
        const auto start = std::chrono::steady_clock::now();
        UINT left = 100 + frame*8;
        motion.upload(gpu,[=](UINT x,UINT y){
            return frame && x>=left && x<left+96 && y>=125 && y<230 ? 0xc800u : 0u;
        });
        color.upload(gpu,[=](UINT x, UINT y) {
            return x>=left && x<left+96 && y>=125 && y<230 ? 0xffeeeeeeu : 0xff202020u;
        });
        NVSDK_NGX_Parameter_SetULL(params,NVSDK_NGX_DLSSG_Parameter_BackbufferFrameID,frame+1);
        for (UINT i=0;i<count;++i) {
            Texture& output = *outputs[i];
            output.transition(gpu,D3D12_RESOURCE_STATE_UNORDERED_ACCESS);
            NVSDK_NGX_D3D12_DLSSG_Eval_Params eval{};
            eval.pBackbuffer = color.texture.Get();
            eval.pDepth = depth.texture.Get();
            eval.pMVecs = motion.texture.Get();
            eval.pOutputInterpFrame = output.texture.Get();
            auto opt = options(count,i+1,frame==0);
            ngx_check(NGX_D3D12_EVALUATE_DLSSG(gpu.list.Get(),handle,params,&eval,&opt),"Evaluate DLSS-G");
            output.transition(gpu,D3D12_RESOURCE_STATE_COPY_SOURCE);
            output.copy(gpu,false);
        }
        gpu.submit();
        const double elapsed = std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - start).count();
        const double current_center = left + 47.5;
        double last_center = current_center - 8;
        for (UINT i = 0; i < count; ++i) {
            const double center = outputs[i]->centroid();
            std::printf("Source %u / synthesized %u: center %.2f (source %.2f), %.1f ms incl. upload/readback\n",
                frame, i + 1, center, current_center, elapsed);
            if (frame >= 2 && !(last_center < center && center < current_center)) correct = false;
            last_center = center;
        }
    }
    NVSDK_NGX_D3D12_ReleaseFeature(handle);
    NVSDK_NGX_D3D12_DestroyParameters(params);
    NVSDK_NGX_D3D12_Shutdown1(gpu.device.Get());
    std::printf("Expected intermediate motion: %s\n", correct ? "PASS" : "FAIL");
    return correct ? 0 : 3;
}
