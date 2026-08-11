//! 音视频转录（语音转文字）命令：`transcribe_media`
//!
//! 流程：前端传入 base64 音频/视频 → 写临时文件（保留扩展名）→
//! symphonia 解码为 16kHz 单声道 f32 PCM → candle-whisper（tiny 档位）推理 →
//! 返回拼接后的转录文本。
//!
//! 依赖栈：candle-transformers 0.9.2 的 whisper 实现（CPU）+ hf-hub 0.3
//! 下载 openai/whisper-tiny 模型到 `app.data_dir()/whisper-models/`（首次自动下载）。
//!
//! 说明：candle 0.9.2 的 whisper API 与官方示例略有差异——模型用 `Whisper::load`
//! 而非 `Whisper::new`；`audio::pcm_to_mel` 需要外部传入 mel 滤波器并返回扁平 `Vec`。
//! 本文件据此适配实际 crate 导出的接口（mel 滤波器在此处用 Slaney 公式现算）。

use std::path::Path;
use std::sync::{Mutex, MutexGuard, OnceLock};

use base64::Engine;
use candle_core::{Device, IndexOp, Tensor};
use candle_nn::{ops::softmax, VarBuilder};
use candle_transformers::models::whisper::{self as m, audio, model::Whisper, Config};
use symphonia::core::audio::SampleBuffer;
use symphonia::core::codecs::DecoderOptions;
use symphonia::core::errors::Error as SymphoniaError;
use symphonia::core::formats::FormatOptions;
use symphonia::core::io::MediaSourceStream;
use symphonia::core::meta::MetadataOptions;
use symphonia::core::probe::Hint;
use tauri::Manager;
use tokenizers::Tokenizer;

/// whisper 要求的采样率（16kHz）
const TARGET_SAMPLE_RATE: usize = 16_000;
/// 使用的模型仓库（multilingual，tiny 档位约 75MB）
const MODEL_REPO_ID: &str = "openai/whisper-tiny";

/// Tauri 命令：把上传的音频/视频文件转录成文字
///
/// - `data`：文件内容的 base64 字符串
/// - `name`：文件名（用于推断扩展名，供 symphonia 识别容器/编码）
#[tauri::command]
pub async fn transcribe_media(
    app: tauri::AppHandle,
    data: String,
    name: String,
) -> Result<String, String> {
    let model_dir = {
        let dir = app
            .path()
            .app_data_dir()
            .map_err(|e| format!("获取应用数据目录失败: {e}"))?
            .join("whisper-models");
        std::fs::create_dir_all(&dir).map_err(|e| format!("创建模型目录失败: {e}"))?;
        dir
    };
    // 音频解码 + whisper 推理均为 CPU 密集阻塞操作，放入 spawn_blocking 避免阻塞 UI 线程
    tauri::async_runtime::spawn_blocking(move || run_transcription(&data, &name, &model_dir))
        .await
        .map_err(|e| format!("转录线程异常: {e}"))?
}

/// 阻塞式转录主流程（在 spawn_blocking 线程中执行）
fn run_transcription(data: &str, name: &str, model_dir: &Path) -> Result<String, String> {
    // 1) base64 解码
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(data.trim())
        .map_err(|e| format!("base64 解码失败: {e}"))?;
    if bytes.is_empty() {
        return Err("输入内容为空".to_string());
    }

    // 2) 写临时文件（保留扩展名，供 symphonia 识别容器/编码）
    let ext = Path::new(name)
        .extension()
        .and_then(|e| e.to_str())
        .filter(|e| !e.is_empty())
        .unwrap_or("wav");
    let unique = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let temp_path = std::env::temp_dir().join(format!(
        "ws_transcribe_{}_{}.{ext}",
        std::process::id(),
        unique
    ));
    if let Err(e) = std::fs::write(&temp_path, &bytes) {
        return Err(format!("写入临时文件失败: {e}"));
    }
    // 解码 + 推理；无论成败都清理临时文件
    let result = decode_and_transcribe(&temp_path, model_dir);
    let _ = std::fs::remove_file(&temp_path);
    result
}

/// 解码临时媒体文件为 PCM 后，加载模型并推理
fn decode_and_transcribe(temp_path: &Path, model_dir: &Path) -> Result<String, String> {
    let pcm = decode_audio_to_pcm(temp_path)?;
    if pcm.is_empty() {
        return Err("音频解码结果为空".to_string());
    }

    // 复用进程级模型缓存（首次加载，后续转录不再重读 151MB）
    let mut guard = load_cache(model_dir)?;
    whisper_infer(guard.as_mut().unwrap(), &pcm)
}

/// 已加载的 whisper 模型资产（进程级缓存，避免每次重读 safetensors + 重解析）
struct WhisperCache {
    config: Config,
    tokenizer: Tokenizer,
    whisper: Whisper,
    filters: Vec<f32>,
}

static MODEL_CACHE: OnceLock<Mutex<Option<WhisperCache>>> = OnceLock::new();

fn cache_lock() -> &'static Mutex<Option<WhisperCache>> {
    MODEL_CACHE.get_or_init(|| Mutex::new(None))
}

/// 获取模型缓存（None 时首次加载：下载 + 读权重 + Whisper::load）。
/// 返回 `MutexGuard<Option<WhisperCache>>`，调用方经 `as_mut().unwrap()` 取 `&mut WhisperCache`。
/// 锁在推理全程持有——转录串行化，避免多个请求并发操作同一个 &mut Whisper。
fn load_cache(model_dir: &Path) -> Result<MutexGuard<'static, Option<WhisperCache>>, String> {
    let mtx = cache_lock();
    let mut guard = mtx.lock().map_err(|_| "模型缓存锁被污染".to_string())?;
    if guard.is_none() {
        let (config, tokenizer, model_bytes, filters) = load_model_assets(model_dir)?;
        let device = Device::Cpu;
        let vb = VarBuilder::from_buffered_safetensors(
            model_bytes,
            candle_core::DType::F32,
            &device,
        )
        .map_err(|e| format!("加载模型权重失败: {e}"))?;
        let whisper = Whisper::load(&vb, config.clone())
            .map_err(|e| format!("构建 whisper 模型失败: {e}"))?;
        *guard = Some(WhisperCache {
            config,
            tokenizer,
            whisper,
            filters,
        });
    }
    Ok(guard)
}

/// 推理主函数：复用缓存，计算 mel → 贪心解码 → 返回文本
fn whisper_infer(cache: &mut WhisperCache, pcm: &[f32]) -> Result<String, String> {
    let device = Device::Cpu;

    // pcm → mel 频谱图（返回 [n_mel * n_frames] 扁平向量）
    let mel_vec = audio::pcm_to_mel(&cache.config, pcm, &cache.filters);
    let n_frames = mel_vec.len() / cache.config.num_mel_bins;
    if n_frames == 0 {
        return Err("mel 频谱为空".to_string());
    }
    let mel = Tensor::from_vec(mel_vec, (1, cache.config.num_mel_bins, n_frames), &device)
        .map_err(|e| format!("构造 mel 张量失败: {e}"))?;

    // 语言固定为中文（提升本场景识别准度）
    let language_token = Some(token_id(&cache.tokenizer, "<|zh|>")?);
    let mut decoder = GreedyDecoder::new(&mut cache.whisper, &cache.tokenizer, &device, language_token)?;
    decoder.run(&mel)
}

/// 用 symphonia 解码媒体文件为 16kHz 单声道 f32 PCM
fn decode_audio_to_pcm(path: &Path) -> Result<Vec<f32>, String> {
    let file = std::fs::File::open(path).map_err(|e| format!("打开媒体文件失败: {e}"))?;
    let mss = MediaSourceStream::new(Box::new(file), Default::default());
    let probed = symphonia::default::get_probe()
        .format(
            &Hint::new(),
            mss,
            &FormatOptions::default(),
            &MetadataOptions::default(),
        )
        .map_err(|e| format!("解析媒体格式失败: {e}"))?;
    let mut format = probed.format;
    let track = format
        .default_track()
        .ok_or_else(|| "媒体无音轨".to_string())?;
    let track_id = track.id;
    let mut decoder = symphonia::default::get_codecs()
        .make(&track.codec_params, &DecoderOptions::default())
        .map_err(|e| format!("创建解码器失败: {e}"))?;

    let mut pcm: Vec<f32> = Vec::new();
    loop {
        let packet = match format.next_packet() {
            Ok(p) => p,
            Err(SymphoniaError::IoError(_)) => break, // EOF
            Err(_) => break,                          // 忽略其余错误，用已解码部分
        };
        if packet.track_id() != track_id {
            continue;
        }
        match decoder.decode(&packet) {
            Ok(decoded) => {
                // 把当前解码块转单声道并重采样到 16kHz
                pcm.extend(downmix_resample(&decoded)?);
            }
            Err(SymphoniaError::DecodeError(_)) => continue,
            Err(e) => return Err(format!("解码音频失败: {e}")),
        }
    }
    Ok(pcm)
}

/// 单声道（取多声道均值）+ 线性插值重采样到 16kHz
fn downmix_resample(decoded: &symphonia::core::audio::AudioBufferRef) -> Result<Vec<f32>, String> {
    let spec = *decoded.spec();
    let sample_rate = spec.rate as usize;
    let channels = spec.channels.count();
    let mut buffer = SampleBuffer::<f32>::new(decoded.capacity() as u64, spec);
    buffer.copy_interleaved_ref(decoded.clone());
    let samples = buffer.samples();

    // 多声道 → 单声道（逐帧取均值）
    let mono: Vec<f32> = if channels > 1 {
        samples
            .chunks(channels)
            .map(|frame| frame.iter().sum::<f32>() / channels as f32)
            .collect()
    } else {
        samples.to_vec()
    };

    if sample_rate == TARGET_SAMPLE_RATE {
        Ok(mono)
    } else {
        Ok(resample_linear(&mono, sample_rate, TARGET_SAMPLE_RATE))
    }
}

/// 简单线性插值重采样
fn resample_linear(input: &[f32], in_rate: usize, out_rate: usize) -> Vec<f32> {
    if input.is_empty() {
        return Vec::new();
    }
    let in_len = input.len() as f64;
    let out_len = (in_len * out_rate as f64 / in_rate as f64).ceil() as usize;
    let ratio = in_rate as f64 / out_rate as f64;
    let mut out = Vec::with_capacity(out_len);
    for i in 0..out_len {
        let src = i as f64 * ratio;
        let idx = src.floor() as usize;
        let frac = (src - idx as f64) as f32;
        let a = input[idx.min(input.len() - 1)];
        let b = input[(idx + 1).min(input.len() - 1)];
        out.push(a + (b - a) * frac);
    }
    out
}

/// 下载（缓存命中直接复用）并加载模型资产到 `model_dir`
fn load_model_assets(
    model_dir: &Path,
) -> Result<(Config, Tokenizer, Vec<u8>, Vec<f32>), String> {
    // 下载端点：默认 huggingface.co，可用 HF_ENDPOINT 环境变量切镜像（如 hf-mirror.com）
    let endpoint =
        std::env::var("HF_ENDPOINT").unwrap_or_else(|_| "https://huggingface.co".to_string());
    let base = format!("{endpoint}/{MODEL_REPO_ID}/resolve/main");

    let config_path = ensure_downloaded(model_dir, &format!("{base}/config.json"))?;
    let tokenizer_path = ensure_downloaded(model_dir, &format!("{base}/tokenizer.json"))?;
    let model_path = ensure_downloaded(model_dir, &format!("{base}/model.safetensors"))?;

    let config: Config = serde_json::from_slice(
        &std::fs::read(&config_path).map_err(|e| format!("读取 config.json 失败: {e}"))?,
    )
    .map_err(|e| format!("解析 config.json 失败: {e}"))?;
    let tokenizer = Tokenizer::from_file(&tokenizer_path)
        .map_err(|e| format!("加载 tokenizer.json 失败: {e}"))?;
    let model_bytes = std::fs::read(&model_path)
        .map_err(|e| format!("读取 model.safetensors 失败: {e}"))?;

    // 现算 whisper 的 Slaney mel 滤波器组（[n_mels, n_fft/2+1]）
    let filters = mel_filters(config.num_mel_bins, m::N_FFT, TARGET_SAMPLE_RATE);

    Ok((config, tokenizer, model_bytes, filters))
}

/// 从 URL 下载文件到 `model_dir/<文件名>`（已存在则复用缓存）。
/// 用 ureq 默认客户端跟随重定向——hf 的 resolve 会返回相对 Location 重定向，
/// hf-hub 0.3.x 的 no_redirect 客户端无法解析（RelativeUrlWithoutBase），故直连。
fn ensure_downloaded(model_dir: &Path, url: &str) -> Result<std::path::PathBuf, String> {
    let name = url.rsplit('/').next().unwrap_or("file").to_string();
    let dest = model_dir.join(&name);
    if dest.exists() {
        return Ok(dest);
    }
    std::fs::create_dir_all(model_dir).map_err(|e| format!("创建模型目录失败: {e}"))?;
    let tmp = model_dir.join(format!("{name}.part"));
    let resp = ureq::get(url)
        .call()
        .map_err(|e| format!("下载 {name} 失败: {e}"))?;
    let mut reader = resp.into_reader();
    let mut out = std::fs::File::create(&tmp).map_err(|e| format!("创建临时文件失败: {e}"))?;
    std::io::copy(&mut reader, &mut out).map_err(|e| format!("写入 {name} 失败: {e}"))?;
    std::fs::rename(&tmp, &dest).map_err(|e| format!("完成 {name} 失败: {e}"))?;
    Ok(dest)
}

/// 贪心解码器：参照 candle 官方 whisper 示例，仅实现 temperature=0 的 argmax 解码。
/// 固定任务为 transcribe、关闭时间戳、语言强制中文，返回拼接文本。
struct GreedyDecoder<'a> {
    model: &'a mut Whisper,
    tokenizer: &'a Tokenizer,
    language_token: Option<u32>,
    sot_token: u32,
    transcribe_token: u32,
    eot_token: u32,
    no_speech_token: u32,
    no_timestamps_token: u32,
    suppress_tokens: Tensor,
}

impl<'a> GreedyDecoder<'a> {
    fn new(
        model: &'a mut Whisper,
        tokenizer: &'a Tokenizer,
        device: &Device,
        language_token: Option<u32>,
    ) -> Result<Self, String> {
        let no_timestamps_token = token_id(tokenizer, m::NO_TIMESTAMPS_TOKEN)?;
        // 抑制特殊 token（以及关闭时间戳时抑制 notimestamps 之外的……参照官方：抑制 suppress_tokens 集合）
        let suppress_tokens: Vec<f32> = (0..model.config.vocab_size as u32)
            .map(|i| {
                if model.config.suppress_tokens.contains(&i) || i == no_timestamps_token {
                    f32::NEG_INFINITY
                } else {
                    0.0
                }
            })
            .collect();
        let suppress_tokens = Tensor::new(suppress_tokens.as_slice(), device)
            .map_err(|e| format!("构造抑制掩码失败: {e}"))?;
        let sot_token = token_id(tokenizer, m::SOT_TOKEN)?;
        let transcribe_token = token_id(tokenizer, m::TRANSCRIBE_TOKEN)?;
        let eot_token = token_id(tokenizer, m::EOT_TOKEN)?;
        let no_speech_token = m::NO_SPEECH_TOKENS
            .iter()
            .find_map(|t| token_id(tokenizer, t).ok())
            .ok_or_else(|| "tokenizer 中缺少 no-speech token".to_string())?;
        Ok(Self {
            model,
            tokenizer,
            language_token,
            sot_token,
            transcribe_token,
            eot_token,
            no_speech_token,
            no_timestamps_token,
            suppress_tokens,
        })
    }

    /// 解码单个 mel 片段，返回 (文本, no_speech_prob)
    fn decode_segment(&mut self, mel: &Tensor) -> Result<(String, f64), String> {
        let audio_features = self
            .model
            .encoder
            .forward(mel, true)
            .map_err(|e| format!("编码器前向失败: {e}"))?;
        let sample_len = self.model.config.max_target_positions / 2;

        let mut tokens = vec![self.sot_token];
        if let Some(language_token) = self.language_token {
            tokens.push(language_token);
        }
        tokens.push(self.transcribe_token);
        tokens.push(self.no_timestamps_token);

        let mut no_speech_prob = f64::NAN;
        for i in 0..sample_len {
            let tokens_t = Tensor::new(tokens.as_slice(), mel.device())
                .map_err(|e| format!("构造 token 张量失败: {e}"))?
                .unsqueeze(0)
                .map_err(|e| format!("扩展 token 维度失败: {e}"))?;
            let ys = self
                .model
                .decoder
                .forward(&tokens_t, &audio_features, i == 0)
                .map_err(|e| format!("解码器前向失败: {e}"))?;

            // 首步提取 no-speech 概率
            if i == 0 {
                let logits = self
                    .model
                    .decoder
                    .final_linear(&ys.i(..1).map_err(|e| e.to_string())?)
                    .map_err(|e| format!("线性投影失败: {e}"))?
                    .i(0)
                    .map_err(|e| e.to_string())?
                    .i(0)
                    .map_err(|e| e.to_string())?;
                no_speech_prob = softmax(&logits, 0)
                    .map_err(|e| e.to_string())?
                    .i(self.no_speech_token as usize)
                    .map_err(|e| e.to_string())?
                    .to_scalar::<f32>()
                    .map_err(|e| e.to_string())? as f64;
            }

            let (_, seq_len, _) = ys.dims3().map_err(|e| e.to_string())?;
            let logits = self
                .model
                .decoder
                .final_linear(&ys.i((..1, seq_len - 1..)).map_err(|e| e.to_string())?)
                .map_err(|e| format!("线性投影失败: {e}"))?
                .i(0)
                .map_err(|e| e.to_string())?
                .i(0)
                .map_err(|e| e.to_string())?;
            let logits = logits
                .broadcast_add(&self.suppress_tokens)
                .map_err(|e| format!("施加抑制掩码失败: {e}"))?;

            // greedy：取 logits 最大的 token（temperature = 0）
            let next_token = {
                let logits_v: Vec<f32> = logits
                    .to_vec1()
                    .map_err(|e| format!("logits 转一维失败: {e}"))?;
                logits_v
                    .iter()
                    .enumerate()
                    .max_by(|(_, u), (_, v)| u.total_cmp(v))
                    .map(|(i, _)| i as u32)
                    .unwrap_or(self.eot_token)
            };
            tokens.push(next_token);
            if next_token == self.eot_token
                || tokens.len() > self.model.config.max_target_positions
            {
                break;
            }
        }

        let text = self
            .tokenizer
            .decode(&tokens, true)
            .map_err(|e| format!("tokenizer 解码失败: {e}"))?;
        Ok((text, no_speech_prob))
    }

    /// 按 30s 窗口分段解码并拼接全部片段文本
    fn run(&mut self, mel: &Tensor) -> Result<String, String> {
        let (_, _, content_frames) = mel.dims3().map_err(|e| e.to_string())?;
        let mut seek = 0usize;
        let mut out = String::new();
        while seek < content_frames {
            let segment_size = usize::min(content_frames - seek, m::N_FRAMES);
            let mel_segment = mel
                .narrow(2, seek, segment_size)
                .map_err(|e| format!("切分 mel 片段失败: {e}"))?;
            let (text, no_speech_prob) = self.decode_segment(&mel_segment)?;
            seek += segment_size;
            // 跳过无声片段
            if no_speech_prob > m::NO_SPEECH_THRESHOLD {
                continue;
            }
            let trimmed = text.trim();
            if !trimmed.is_empty() {
                out.push_str(trimmed);
                out.push(' ');
            }
        }
        Ok(out.trim().to_string())
    }
}

/// 查询 tokenizer 中特殊 token 的 id
fn token_id(tokenizer: &Tokenizer, token: &str) -> Result<u32, String> {
    tokenizer
        .token_to_id(token)
        .ok_or_else(|| format!("tokenizer 中缺少特殊 token: {token}"))
}

/// 生成 whisper 的 Slaney 风格 mel 滤波器组，返回 `[n_mels * (n_fft/2 + 1)]` 扁平数组
/// （与 librosa/whisper 的 mel_filters.npz 一致，保证 mel 频谱与官方一致）
fn mel_filters(n_mels: usize, n_fft: usize, sample_rate: usize) -> Vec<f32> {
    let fmin = 0.0f32;
    let fmax = sample_rate as f32 / 2.0;

    // Slaney 公式（htk = false）
    fn hz_to_mel(hz: f32) -> f32 {
        let f_min = 0.0f32;
        let f_sp = 200.0 / 3.0;
        let min_log_hz = 1000.0f32;
        let min_log_mel = (min_log_hz - f_min) / f_sp;
        let logstep = (6.4f32).ln() / 27.0;
        if hz >= min_log_hz {
            min_log_mel + (hz / min_log_hz).ln() / logstep
        } else {
            (hz - f_min) / f_sp
        }
    }
    fn mel_to_hz(mel: f32) -> f32 {
        let f_min = 0.0f32;
        let f_sp = 200.0 / 3.0;
        let min_log_hz = 1000.0f32;
        let min_log_mel = (min_log_hz - f_min) / f_sp;
        let logstep = (6.4f32).ln() / 27.0;
        if mel >= min_log_mel {
            min_log_hz * (logstep * (mel - min_log_mel)).exp()
        } else {
            f_min + f_sp * mel
        }
    }

    let n_fft_bins = n_fft / 2 + 1; // 201
    // FFT bin 中心频率
    let fftfreqs: Vec<f32> = (0..n_fft_bins)
        .map(|i| i as f32 * sample_rate as f32 / n_fft as f32)
        .collect();
    // mel 频带中心频率（n_mels + 2 个点）
    let mel_low = hz_to_mel(fmin);
    let mel_high = hz_to_mel(fmax);
    let mel_f: Vec<f32> = (0..n_mels + 2)
        .map(|i| mel_to_hz(mel_low + (mel_high - mel_low) * i as f32 / (n_mels + 1) as f32))
        .collect();
    let fdiff: Vec<f32> = mel_f.windows(2).map(|w| w[1] - w[0]).collect();

    let mut filters = vec![0.0f32; n_mels * n_fft_bins];
    for i in 0..n_mels {
        for (j, &ff) in fftfreqs.iter().enumerate() {
            let lower = -(mel_f[i] - ff) / fdiff[i];
            let upper = (mel_f[i + 2] - ff) / fdiff[i + 1];
            filters[i * n_fft_bins + j] = lower.min(upper).max(0.0);
        }
    }
    // Slaney 归一化（近似等能量/通道）
    for i in 0..n_mels {
        let enorm = 2.0 / (mel_f[i + 2] - mel_f[i]);
        for j in 0..n_fft_bins {
            filters[i * n_fft_bins + j] *= enorm;
        }
    }
    filters
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 端到端验证：首次下载 whisper-tiny 模型（风险点3，需联网约 75MB）
    /// + 转录语音样本（风险点1，CPU 推理较慢）。
    /// 语音样本由 `gen_speech.ps1`（Windows SAPI）生成到 %TEMP%/ws_sample_speech.wav。
    /// 标记 #[ignore]：真实推理 + 需联网，避免常规 cargo test 误触发。
    #[test]
    #[ignore = "e2e 真实 whisper 推理 + 需联网下载模型"]
    fn transcribe_sample_speech() {
        let wav = std::env::temp_dir().join("ws_sample_speech.wav");
        if !wav.exists() {
            eprintln!("缺少语音样本，请先运行 gen_speech.ps1 生成后重试");
            return;
        }
        let bytes = std::fs::read(&wav).expect("读取语音样本失败");
        let data = base64::engine::general_purpose::STANDARD.encode(&bytes);
        let model_dir = std::env::temp_dir().join("ws_whisper_test_models");
        let out = run_transcription(&data, "ws_sample_speech.wav", &model_dir);
        match &out {
            Ok(t) => eprintln!("转录成功: {t:?}"),
            Err(e) => eprintln!("转录失败: {e}"),
        }
        assert!(out.is_ok(), "转录失败: {:?}", out);
    }
}

