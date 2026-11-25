from ctypes import CDLL, c_int, c_uint, c_void_p, c_wchar_p, create_string_buffer, memmove, addressof
from fractions import Fraction
import math
from pathlib import Path
import tempfile
from threading import Lock
import warnings

import vapoursynth as vs


class DlssFrames:
    def __init__(self, width, height, factor):
        self.handle = None
        self.width, self.height = width, height
        self.plane_size = width * height
        self.outputs = [create_string_buffer(3 * self.plane_size) for _ in range(factor - 1)]
        self.last_pair = None
        self.failed = False
        self.lock = Lock()
        self.runtime = Path(__file__).resolve().parent / "runtime"
        self.api = None

    def start(self):
        api = CDLL(str(self.runtime / "kx-dlss.dll"))
        api.kx_dlss_create.argtypes = [c_uint, c_uint, c_uint, c_wchar_p, c_wchar_p]
        api.kx_dlss_create.restype = c_void_p
        api.kx_dlss_push.argtypes = [c_void_p, c_void_p, c_void_p, c_void_p, c_uint, c_int, c_void_p, c_void_p]
        api.kx_dlss_push.restype = c_int
        api.kx_dlss_destroy.argtypes = [c_void_p]
        api.kx_dlss_destroy.restype = None
        cache = Path(tempfile.gettempdir()) / "kinonyx-dlss-cache"
        cache.mkdir(exist_ok=True)
        self.handle = api.kx_dlss_create(self.width, self.height, len(self.outputs), str(self.runtime), str(cache))
        self.api = api
        if not self.handle:
            raise RuntimeError("NVIDIA DLSS-G initialization failed")

    def __del__(self):
        if self.handle:
            self.api.kx_dlss_destroy(self.handle)

    def push(self, frame, reset, outputs):
        pointers = [frame.get_read_ptr(plane) for plane in range(3)]
        if not self.api.kx_dlss_push(self.handle, *pointers, frame.get_stride(0), reset, *outputs):
            raise RuntimeError("NVIDIA DLSS-G did not generate a frame")

    def generate(self, index, current, following, phase, color_profile):
        with self.lock:
            if self.failed:
                return current
            try:
                if not self.handle:
                    self.start()
                pair = (index, color_profile)
                if pair != self.last_pair:
                    if self.last_pair != (index - 1, color_profile):
                        self.push(current, 1, (None, None))
                    output = [addressof(buffer) for buffer in self.outputs]
                    self.push(following, 0, (output[0], output[1] if len(output) > 1 else None))
                    self.last_pair = pair
                result = current.copy()
                packed = addressof(self.outputs[phase])
                for plane in range(3):
                    straight = result.get_write_ptr(plane).value
                    stride = result.get_stride(plane)
                    source = packed + plane * self.plane_size
                    for y in range(self.height):
                        memmove(straight + y * stride, source + y * self.width, self.width)
                return result
            except (OSError, RuntimeError, ValueError) as error:
                self.failed = True
                warnings.warn(str(error))
                return current


def crosses_cut(current, following, width, height, bits):
    if current.props.get("_SceneChangeNext") or following.props.get("_SceneChangePrev"):
        return True
    # Compare a sparse luma grid before feeding the pair into the temporal model.
    luma_a, luma_b = current[0], following[0]
    delta = sum(abs(int(luma_a[y * height // 12, x * width // 16]) - int(luma_b[y * height // 12, x * width // 16]))
                for y in range(12) for x in range(16))
    return delta > (1 << bits) * 12 * 16 * 0.22


def interpolate(clip, fps, multiplier):
    if multiplier not in (2, 3) or clip.format is None or clip.format.color_family != vs.YUV:
        return clip
    if clip.format.sample_type != vs.INTEGER or clip.width > 1920 or clip.height > 1080:
        return clip
    if not math.isfinite(fps) or not 12 <= fps <= 60 or clip.num_frames < 2:
        return clip

    # mpv supplies exact durations on incoming frames. AssumeFPS is used only when
    # the clip has no nominal FPS; Interleave divides each output frame's duration.
    if not clip.fps:
        rate = Fraction(fps).limit_denominator(1001)
        original = clip
        clip = clip.std.AssumeFPS(fpsnum=rate.numerator, fpsden=rate.denominator).std.CopyFrameProps(original)
    following = clip[1:] + clip[-1:]
    generator = DlssFrames(clip.width, clip.height, multiplier)
    phases = {}

    def generated_for(profile, phase):
        key = (profile, phase)
        if key not in phases:
            matrix, color_range = profile
            rgb = clip.resize.Bicubic(format=vs.RGB24, matrix_in=matrix, range_in_s=color_range)
            next_rgb = following.resize.Bicubic(format=vs.RGB24, matrix_in=matrix, range_in_s=color_range)

            def generate(n, f):
                return generator.generate(n, *f, phase, profile)

            rgb_out = rgb.std.ModifyFrame(clips=[rgb, next_rgb], selector=generate)
            phases[key] = rgb_out.resize.Bicubic(format=clip.format.id, matrix=matrix, range_s=color_range).std.CopyFrameProps(clip)
        return phases[key]

    def select(index, frames, phase):
        current, next_frame = frames
        for frame in frames:
            if frame.props.get("_Transfer") in (16, 18) or frame.props.get("_FieldBased", 0):
                return clip
        if generator.failed or crosses_cut(current, next_frame, clip.width, clip.height, clip.format.bits_per_sample):
            return clip
        fallback = 6 if clip.height <= 576 else 1
        matrix = current.props.get("_Matrix", fallback)
        if matrix not in (1, 4, 5, 6, 7, 9):
            matrix = fallback
        color_range = current.props.get("_Range", 0)
        return generated_for((matrix, "full" if color_range == 1 else "limited"), phase)

    inserted = [clip.std.FrameEval(eval=lambda n, f, phase=i: select(n, f, phase), prop_src=[clip, following])
                for i in range(multiplier - 1)]
    return vs.core.std.Interleave([clip, *inserted], modify_duration=True)


interpolate(video_in, container_fps, int(user_data)).set_output()
