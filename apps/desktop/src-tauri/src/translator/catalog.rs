//! What the local translator can install, where it comes from, and where it lives on disk.
//!
//! Everything sits under `%USERPROFILE%\.kinonyx\translator` (like Ollama's `~/.ollama`),
//! not AppData: several GB of models don't belong in a roaming-adjacent profile folder, and
//! a stable, documented path lets a user drop in (or hard-link) models they already have.

use std::path::PathBuf;

use serde::Serialize;

#[derive(Clone, Copy, Serialize, PartialEq, Eq, Debug)]
#[serde(rename_all = "lowercase")]
pub enum Kind {
    Engine,
    Asr,
    Mt,
    Voice,
}

pub struct Download {
    pub url: &'static str,
    pub size: u64,
    /// Zip archives are unpacked into the item's directory; everything else is saved as-is.
    pub unzip: bool,
    /// Where a plain file lands, relative to the item's directory (default: `Item::file`).
    pub name: Option<&'static str>,
}

pub struct Item {
    pub id: &'static str,
    pub kind: Kind,
    pub title: &'static str,
    pub note: &'static str,
    /// For models: the file name inside `models/`. For the engine: the directory inside
    /// `engines/` it unpacks into.
    pub file: &'static str,
    pub downloads: &'static [Download],
    /// Files that must all exist for the item to count as installed (relative to its dir).
    pub marker: &'static [&'static str],
    /// Lives in `engines/<file>` rather than `models/`.
    pub engine_dir: bool,
    /// After the downloads, set up the embedded Python (pip + PyTorch + OmniVoice); this
    /// much more is fetched from PyPI / download.pytorch.org along the way.
    pub pip: Option<u64>,
}

const fn dl(url: &'static str, size: u64, name: &'static str) -> Download {
    Download { url, size, unzip: false, name: Some(name) }
}

// Pinned revision of k2-fsa/OmniVoice on Hugging Face (Apache-2.0).
macro_rules! omnivoice {
    ($f:literal) => {
        concat!("https://huggingface.co/k2-fsa/OmniVoice/resolve/c5fdb5ccb189668d56333f77ba2629f4cd7535f4/", $f)
    };
}

/// Voiceprint model that tells speakers apart (sherpa-onnx release, 3D-Speaker CAM++).
pub const SPEAKER_MODEL: &str = "wespeaker_en_voxceleb_CAM++_LM.onnx";

// The engine is llama.cpp's official Windows CUDA 13 build (pinned release) + its CUDA
// runtime DLLs. whisper-server — built from whisper.cpp against the same CUDA major version
// and shipped in the installer — loads the runtime DLLs from this same folder.
pub const ITEMS: &[Item] = &[
    Item {
        id: "engine-cuda",
        kind: Kind::Engine,
        title: "Движок NVIDIA CUDA",
        note: "llama.cpp и библиотеки CUDA — нужны для распознавания и перевода на видеокарте NVIDIA (RTX 20xx и новее).",
        file: "llama",
        downloads: &[
            Download {
                url: "https://github.com/ggml-org/llama.cpp/releases/download/b11222/llama-b11222-bin-win-cuda-13.4-x64.zip",
                size: 153_500_000,
                unzip: true,
                name: None,
            },
            Download {
                url: "https://github.com/ggml-org/llama.cpp/releases/download/b11222/cudart-llama-bin-win-cuda-13.4-x64.zip",
                size: 423_500_000,
                unzip: true,
                name: None,
            },
        ],
        marker: &["llama-server.exe", "cudart64_13.dll", "cublas64_13.dll", "cublasLt64_13.dll"],
        engine_dir: true,
        pip: None,
    },
    Item {
        id: "whisper-large-v3-turbo",
        kind: Kind::Asr,
        title: "Whisper large-v3-turbo",
        note: "Лучшее качество распознавания речи. 1,6 ГБ, около 2 ГБ видеопамяти.",
        file: "ggml-large-v3-turbo.bin",
        downloads: &[Download {
            url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo.bin",
            size: 1_624_555_275,
            unzip: false,
            name: None,
        }],
        marker: &["ggml-large-v3-turbo.bin"],
        engine_dir: false,
        pip: None,
    },
    Item {
        id: "whisper-large-v3-turbo-q8",
        kind: Kind::Asr,
        title: "Whisper large-v3-turbo (сжатая)",
        note: "Почти то же качество, вдвое легче. 0,9 ГБ.",
        file: "ggml-large-v3-turbo-q8_0.bin",
        downloads: &[Download {
            url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo-q8_0.bin",
            size: 874_188_075,
            unzip: false,
            name: None,
        }],
        marker: &["ggml-large-v3-turbo-q8_0.bin"],
        engine_dir: false,
        pip: None,
    },
    Item {
        id: "hymt2-q8",
        kind: Kind::Mt,
        title: "Hy-MT2 1.8B",
        note: "Переводчик от Tencent, 33 языка. Лучшее качество. 1,9 ГБ.",
        file: "Hy-MT2-1.8B-Q8_0.gguf",
        downloads: &[Download {
            url: "https://huggingface.co/tencent/Hy-MT2-1.8B-GGUF/resolve/main/Hy-MT2-1.8B-Q8_0.gguf",
            size: 1_908_528_192,
            unzip: false,
            name: None,
        }],
        marker: &["Hy-MT2-1.8B-Q8_0.gguf"],
        engine_dir: false,
        pip: None,
    },
    Item {
        id: "hymt2-q4",
        kind: Kind::Mt,
        title: "Hy-MT2 1.8B (сжатая)",
        note: "Немного проще перевод, заметно легче. 1,1 ГБ.",
        file: "Hy-MT2-1.8B-Q4_K_M.gguf",
        downloads: &[Download {
            url: "https://huggingface.co/tencent/Hy-MT2-1.8B-GGUF/resolve/main/Hy-MT2-1.8B-Q4_K_M.gguf",
            size: 1_133_080_448,
            unzip: false,
            name: None,
        }],
        marker: &["Hy-MT2-1.8B-Q4_K_M.gguf"],
        engine_dir: false,
        pip: None,
    },
    Item {
        id: "voice-runtime",
        kind: Kind::Voice,
        title: "Среда озвучки",
        note: "Python и PyTorch с CUDA — на них работает клонирование голоса. Ставится с python.org, pypi.org и pytorch.org.",
        file: "voice",
        downloads: &[
            Download {
                url: "https://www.python.org/ftp/python/3.10.11/python-3.10.11-embed-amd64.zip",
                size: 8_629_277,
                unzip: true,
                name: None,
            },
            dl("https://bootstrap.pypa.io/get-pip.py", 2_230_488, "get-pip.py"),
        ],
        marker: &["python.exe", ".installed"],
        engine_dir: true,
        pip: Some(3_300_000_000),
    },
    Item {
        id: "voice-omnivoice",
        kind: Kind::Voice,
        title: "OmniVoice",
        note: "Говорит переводом голосом того, кто сказал фразу. Около 3 ГБ видеопамяти.",
        file: "omnivoice",
        downloads: &[
            dl(omnivoice!("config.json"), 2_238, "config.json"),
            dl(omnivoice!("chat_template.jinja"), 4_168, "chat_template.jinja"),
            dl(omnivoice!("tokenizer.json"), 11_423_986, "tokenizer.json"),
            dl(omnivoice!("tokenizer_config.json"), 533, "tokenizer_config.json"),
            dl(omnivoice!("model.safetensors"), 2_450_344_112, "model.safetensors"),
            dl(omnivoice!("audio_tokenizer/config.json"), 2_531, "audio_tokenizer/config.json"),
            dl(omnivoice!("audio_tokenizer/preprocessor_config.json"), 206, "audio_tokenizer/preprocessor_config.json"),
            dl(omnivoice!("audio_tokenizer/model.safetensors"), 805_665_628, "audio_tokenizer/model.safetensors"),
            dl(
                "https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-recongition-models/wespeaker_en_voxceleb_CAM++_LM.onnx",
                29_292_687,
                SPEAKER_MODEL,
            ),
        ],
        marker: &["config.json", "model.safetensors", "audio_tokenizer/model.safetensors", SPEAKER_MODEL],
        engine_dir: false,
        pip: None,
    },
];

/// Bytes to fetch for the item, including what pip downloads for the voice runtime.
pub fn total_size(item: &Item) -> u64 {
    item.downloads.iter().map(|d| d.size).sum::<u64>() + item.pip.unwrap_or(0)
}

pub fn item(id: &str) -> Option<&'static Item> {
    ITEMS.iter().find(|i| i.id == id)
}

pub fn root() -> PathBuf {
    let home = std::env::var_os("USERPROFILE").map(PathBuf::from).unwrap_or_else(std::env::temp_dir);
    home.join(".kinonyx").join("translator")
}

pub fn models_dir() -> PathBuf {
    root().join("models")
}

pub fn engine_dir() -> PathBuf {
    root().join("engines").join("llama")
}

pub fn voice_dir() -> PathBuf {
    root().join("engines").join("voice")
}

/// A directory-shaped item (an engine, or a model made of several files).
pub fn is_dir_item(item: &Item) -> bool {
    item.engine_dir || item.downloads.iter().any(|d| d.name.is_some_and(|n| n != item.file))
}

/// Directory the item's marker files (and downloads) live in.
pub fn item_dir(item: &Item) -> PathBuf {
    if item.engine_dir {
        root().join("engines").join(item.file)
    } else if is_dir_item(item) {
        models_dir().join(item.file)
    } else {
        models_dir()
    }
}

pub fn item_path(item: &Item) -> PathBuf {
    if is_dir_item(item) {
        item_dir(item)
    } else {
        models_dir().join(item.file)
    }
}

pub fn installed(item: &Item) -> bool {
    let dir = item_dir(item);
    item.marker.iter().all(|m| dir.join(m).is_file())
}
