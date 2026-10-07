"""Converts a faster-whisper (CTranslate2) Whisper model into whisper.cpp's GGML format.

Lets a machine that already has faster-whisper's large-v3-turbo reuse those exact weights
for KINONYX's local translator instead of downloading the official GGML file again.

CTranslate2 stores the same tensors as OpenAI's checkpoint, just renamed and with the
self-attention Q/K/V (and cross-attention K/V) fused into one matrix — split back here.
Runs in any Python with numpy + faster_whisper (for the mel filterbank), e.g. the venv of
the standalone translator:

    python ct2_whisper_to_ggml.py <ct2-model-dir> <out.bin>
"""
import json
import os
import struct
import sys

import numpy as np

DTYPES = {0: np.float32, 1: np.int8, 2: np.int16, 3: np.int32, 4: np.float16}


def read_ct2(path):
    tensors, aliases = {}, {}
    with open(path, "rb") as f:
        def rs():
            n = struct.unpack("H", f.read(2))[0]
            return f.read(n)[:-1].decode()

        version = struct.unpack("I", f.read(4))[0]
        if version < 5:
            raise SystemExit(f"unsupported CTranslate2 binary version {version}")
        spec = rs()
        struct.unpack("I", f.read(4))
        if spec != "WhisperSpec":
            raise SystemExit(f"not a Whisper model: {spec}")
        for _ in range(struct.unpack("I", f.read(4))[0]):
            name = rs()
            rank = struct.unpack("B", f.read(1))[0]
            shape = struct.unpack("I" * rank, f.read(4 * rank))
            dtype = DTYPES[struct.unpack("B", f.read(1))[0]]
            nbytes = struct.unpack("I", f.read(4))[0]
            tensors[name] = np.frombuffer(f.read(nbytes), dtype=dtype).reshape(shape)
        for _ in range(struct.unpack("I", f.read(4))[0]):
            alias = rs()
            aliases[alias] = rs()
    return tensors, aliases


def bytes_to_unicode():
    bs = list(range(ord("!"), ord("~") + 1)) + list(range(ord("¡"), ord("¬") + 1)) + list(range(ord("®"), ord("ÿ") + 1))
    cs = bs[:]
    n = 0
    for b in range(2**8):
        if b not in bs:
            bs.append(b)
            cs.append(2**8 + n)
            n += 1
    return dict(zip(bs, [chr(c) for c in cs]))


def main():
    src, out = sys.argv[1], sys.argv[2]
    t, _ = read_ct2(os.path.join(src, "model.bin"))
    vocab = json.load(open(os.path.join(src, "vocabulary.json"), encoding="utf-8"))

    n_audio_layer = sum(1 for k in t if k.startswith("encoder/layer_") and k.endswith("self_attention/linear_1/bias"))
    n_text_layer = sum(1 for k in t if k.startswith("decoder/layer_") and k.endswith("self_attention/linear_1/bias"))
    n_audio_ctx, n_audio_state = t["encoder/position_encodings/encodings"].shape
    n_text_ctx, n_text_state = t["decoder/position_encodings/encodings"].shape
    n_mels = t["encoder/conv1/weight"].shape[1]
    n_vocab = t["decoder/embeddings/weight"].shape[0]
    n_audio_head = int(t["encoder/num_heads"]) if "encoder/num_heads" in t else n_audio_state // 64
    n_text_head = int(t["decoder/num_heads"]) if "decoder/num_heads" in t else n_text_state // 64

    # Regular BPE tokens precede <|endoftext|>; whisper.cpp synthesizes the special ones.
    eot = vocab.index("<|endoftext|>")

    from faster_whisper.feature_extractor import FeatureExtractor

    filters = FeatureExtractor(feature_size=n_mels).mel_filters.astype(np.float32)

    tensors = []  # (name, array)

    def add(name, arr):
        tensors.append((name, np.ascontiguousarray(arr)))

    def blocks(prefix, dst, i):
        p = f"{prefix}/layer_{i}"
        q = f"{dst}.blocks.{i}"
        d = n_audio_state if prefix == "encoder" else n_text_state
        add(f"{q}.attn_ln.weight", t[f"{p}/self_attention/layer_norm/gamma"])
        add(f"{q}.attn_ln.bias", t[f"{p}/self_attention/layer_norm/beta"])
        w, b = t[f"{p}/self_attention/linear_0/weight"], t[f"{p}/self_attention/linear_0/bias"]
        add(f"{q}.attn.query.weight", w[:d]); add(f"{q}.attn.query.bias", b[:d])
        add(f"{q}.attn.key.weight", w[d:2 * d])  # OpenAI's key projection has no bias
        add(f"{q}.attn.value.weight", w[2 * d:]); add(f"{q}.attn.value.bias", b[2 * d:])
        add(f"{q}.attn.out.weight", t[f"{p}/self_attention/linear_1/weight"])
        add(f"{q}.attn.out.bias", t[f"{p}/self_attention/linear_1/bias"])
        if prefix == "decoder":
            add(f"{q}.cross_attn_ln.weight", t[f"{p}/attention/layer_norm/gamma"])
            add(f"{q}.cross_attn_ln.bias", t[f"{p}/attention/layer_norm/beta"])
            add(f"{q}.cross_attn.query.weight", t[f"{p}/attention/linear_0/weight"])
            add(f"{q}.cross_attn.query.bias", t[f"{p}/attention/linear_0/bias"])
            w, b = t[f"{p}/attention/linear_1/weight"], t[f"{p}/attention/linear_1/bias"]
            add(f"{q}.cross_attn.key.weight", w[:d])
            add(f"{q}.cross_attn.value.weight", w[d:]); add(f"{q}.cross_attn.value.bias", b[d:])
            add(f"{q}.cross_attn.out.weight", t[f"{p}/attention/linear_2/weight"])
            add(f"{q}.cross_attn.out.bias", t[f"{p}/attention/linear_2/bias"])
        add(f"{q}.mlp_ln.weight", t[f"{p}/ffn/layer_norm/gamma"])
        add(f"{q}.mlp_ln.bias", t[f"{p}/ffn/layer_norm/beta"])
        add(f"{q}.mlp.0.weight", t[f"{p}/ffn/linear_0/weight"]); add(f"{q}.mlp.0.bias", t[f"{p}/ffn/linear_0/bias"])
        add(f"{q}.mlp.2.weight", t[f"{p}/ffn/linear_1/weight"]); add(f"{q}.mlp.2.bias", t[f"{p}/ffn/linear_1/bias"])

    add("encoder.positional_embedding", t["encoder/position_encodings/encodings"])
    add("encoder.conv1.weight", t["encoder/conv1/weight"])
    add("encoder.conv1.bias", t["encoder/conv1/bias"].reshape(-1, 1))
    add("encoder.conv2.weight", t["encoder/conv2/weight"])
    add("encoder.conv2.bias", t["encoder/conv2/bias"].reshape(-1, 1))
    for i in range(n_audio_layer):
        blocks("encoder", "encoder", i)
    add("encoder.ln_post.weight", t["encoder/layer_norm/gamma"])
    add("encoder.ln_post.bias", t["encoder/layer_norm/beta"])
    add("decoder.positional_embedding", t["decoder/position_encodings/encodings"])
    add("decoder.token_embedding.weight", t["decoder/embeddings/weight"])
    for i in range(n_text_layer):
        blocks("decoder", "decoder", i)
    add("decoder.ln.weight", t["decoder/layer_norm/gamma"])
    add("decoder.ln.bias", t["decoder/layer_norm/beta"])

    f32_names = {"encoder.conv1.bias", "encoder.conv2.bias", "encoder.positional_embedding", "decoder.positional_embedding"}
    byte_decoder = {v: k for k, v in bytes_to_unicode().items()}

    tmp = out + ".part"
    with open(tmp, "wb") as f:
        f.write(struct.pack("i", 0x67676D6C))
        for v in (n_vocab, n_audio_ctx, n_audio_state, n_audio_head, n_audio_layer,
                  n_text_ctx, n_text_state, n_text_head, n_text_layer, n_mels, 1):
            f.write(struct.pack("i", v))
        f.write(struct.pack("ii", *filters.shape))
        f.write(filters.tobytes())
        f.write(struct.pack("i", eot))
        for tok in vocab[:eot]:
            raw = bytes(byte_decoder[c] for c in tok)
            f.write(struct.pack("i", len(raw)))
            f.write(raw)
        for name, arr in tensors:
            f16 = arr.ndim >= 2 and name not in f32_names
            data = arr.astype(np.float16 if f16 else np.float32)
            enc = name.encode()
            f.write(struct.pack("iii", data.ndim, len(enc), 1 if f16 else 0))
            for dim in reversed(data.shape):
                f.write(struct.pack("i", dim))
            f.write(enc)
            f.write(data.tobytes())
    os.replace(tmp, out)
    print(f"ok: {len(tensors)} tensors, layers enc={n_audio_layer} dec={n_text_layer}, heads={n_audio_head}/{n_text_head}, "
          f"mels={n_mels}, vocab={n_vocab} (bpe {eot}) -> {out} ({os.path.getsize(out) / 1e9:.2f} GB)")


if __name__ == "__main__":
    main()
