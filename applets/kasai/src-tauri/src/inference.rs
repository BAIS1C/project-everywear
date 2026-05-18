//! Kasai Inference Engine (ported from Kasai-Local)
//!
//! Manages llama-cpp-2 model loading and token generation for the
//! Everywear headless runtime. Models are shell-provided (paths arrive
//! via IPC StartInference or env vars); this layer handles:
//!
//! - LlamaBackend init and model loading with Five Flags
//! - ChatML prompt building (Qwen/Nemotron compatible)
//! - Token generation loop with streaming via mpsc
//! - Tool-call extraction from <tool_call> markers
//!
//! This is Slice A of the Kasai port: raw inference. Slice B (Big/Small
//! slot swap orchestrator) layers on top of this.

use std::path::Path;
use std::sync::Arc;

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use tokio::sync::mpsc;

use llama_cpp_2::context::params::{KvCacheType, LlamaContextParams};
use llama_cpp_2::llama_backend::LlamaBackend;
use llama_cpp_2::llama_batch::LlamaBatch;
use llama_cpp_2::model::params::LlamaModelParams;
use llama_cpp_2::model::LlamaModel;
use llama_cpp_2::sampling::LlamaSampler;

use model_manager::LlamaFlags;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/// Chat message format (OpenAI/ChatML compatible).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_calls: Option<Vec<ToolCall>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_call_id: Option<String>,
}

/// Tool call within a message.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolCall {
    pub id: String,
    pub r#type: String,
    pub function: ToolCallFunction,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolCallFunction {
    pub name: String,
    pub arguments: String,
}

/// Result of a completed inference.
#[derive(Debug, Serialize, Deserialize)]
pub struct InferenceResult {
    pub content: String,
    pub tool_calls: Vec<ToolCall>,
    pub tokens_generated: u32,
    pub tokens_prompt: u32,
    pub generation_time_ms: u64,
    pub tokens_per_second: f32,
}

// ---------------------------------------------------------------------------
// Loaded Model Handle
// ---------------------------------------------------------------------------

/// A loaded model ready for inference. Owns the LlamaModel and the
/// LlamaBackend reference needed to create contexts.
pub struct LoadedModel {
    model: Arc<LlamaModel>,
    backend: Arc<LlamaBackend>,
    flags: LlamaFlags,
}

impl LoadedModel {
    /// Load a GGUF model from disk with the given Five Flags profile.
    pub fn load(path: &Path, flags: LlamaFlags) -> Result<Self> {
        // Pre-flight: verify file exists and is not tiny
        let metadata = std::fs::metadata(path)
            .with_context(|| format!("model file not found: {}", path.display()))?;
        let file_size = metadata.len();
        if file_size < 50_000_000 {
            anyhow::bail!(
                "model file too small to trust: {} ({} bytes)",
                path.display(),
                file_size
            );
        }

        tracing::info!(
            path = %path.display(),
            size_gb = format!("{:.2}", file_size as f64 / 1_073_741_824.0),
            ngl = flags.n_gpu_layers,
            "Loading GGUF model"
        );

        let backend = LlamaBackend::init().context("Failed to initialize llama.cpp backend")?;

        let mut model_params = LlamaModelParams::default();
        model_params = model_params.with_n_gpu_layers(flags.n_gpu_layers);
        if flags.no_mmap {
            model_params = model_params.with_use_mmap(false);
        }
        if flags.mlock {
            model_params = model_params.with_use_mlock(true);
        }

        let model = LlamaModel::load_from_file(&backend, path, &model_params)
            .with_context(|| format!("Failed to load model: {}", path.display()))?;

        let n_vocab = model.n_vocab();
        tracing::info!(
            vocab = n_vocab,
            size_gb = format!("{:.2}", file_size as f64 / 1_073_741_824.0),
            "Model loaded successfully"
        );

        Ok(Self {
            model: Arc::new(model),
            backend: Arc::new(backend),
            flags,
        })
    }

    /// Run inference on a sequence of chat messages.
    ///
    /// Streams tokens via `token_tx` as they are generated.
    /// Returns the complete result when generation finishes.
    pub async fn generate(
        &self,
        messages: Vec<ChatMessage>,
        max_tokens: u32,
        temperature: f32,
        token_tx: Option<mpsc::Sender<String>>,
    ) -> Result<InferenceResult> {
        let model = self.model.clone();
        let backend = self.backend.clone();
        let flags = self.flags.clone();

        tokio::task::spawn_blocking(move || {
            generate_blocking(
                &backend,
                &model,
                &messages,
                max_tokens,
                temperature,
                &flags,
                token_tx,
            )
        })
        .await
        .context("Inference task panicked")?
    }
}

// ---------------------------------------------------------------------------
// Blocking inference (runs on dedicated thread)
// ---------------------------------------------------------------------------

fn generate_blocking(
    backend: &LlamaBackend,
    model: &LlamaModel,
    messages: &[ChatMessage],
    max_tokens: u32,
    temperature: f32,
    flags: &LlamaFlags,
    token_tx: Option<mpsc::Sender<String>>,
) -> Result<InferenceResult> {
    let gen_start = std::time::Instant::now();

    // Build ChatML prompt
    let prompt = build_chat_prompt(messages);

    // Create context with Five Flags
    let mut ctx_params = LlamaContextParams::default()
        .with_n_ctx(Some(std::num::NonZeroU32::new(flags.context_size).unwrap()))
        .with_n_batch(flags.n_batch);

    // Flag 4: TurboQuant KV cache
    if let Some(kbits) = flags.turbo_quant_kv_key_bits {
        let k_type = match kbits {
            4 => KvCacheType::Q4_0,
            8 => KvCacheType::F16,
            _ => KvCacheType::F16,
        };
        ctx_params = ctx_params.with_type_k(k_type);
    }
    if let Some(vbits) = flags.turbo_quant_kv_val_bits {
        let v_type = match vbits {
            3 | 4 => KvCacheType::Q4_0,
            8 => KvCacheType::F16,
            _ => KvCacheType::F16,
        };
        ctx_params = ctx_params.with_type_v(v_type);
    }

    if flags.flash_attention {
        ctx_params = ctx_params.with_flash_attention_policy(1);
    }

    if let Some(threads) = flags.n_threads {
        ctx_params = ctx_params.with_n_threads(threads as i32);
    }

    let mut ctx = model
        .new_context(backend, ctx_params)
        .context("Failed to create inference context")?;

    // Tokenize
    let tokens = model
        .str_to_token(&prompt, llama_cpp_2::model::AddBos::Always)
        .context("Failed to tokenize prompt")?;

    let n_prompt_tokens = tokens.len() as u32;
    tracing::debug!(prompt_tokens = n_prompt_tokens, prompt_chars = prompt.len());

    // Process prompt tokens in batch
    let mut batch = LlamaBatch::new(flags.n_batch as usize, 1);
    let last_idx = tokens.len() - 1;
    for (i, &token) in tokens.iter().enumerate() {
        let is_last = i == last_idx;
        batch.add(token, i as i32, &[0], is_last)?;

        if batch.n_tokens() as u32 >= flags.n_batch || is_last {
            ctx.decode(&mut batch)
                .context("Failed to decode prompt batch")?;
            batch.clear();
        }
    }

    // Set up sampler
    let mut sampler =
        LlamaSampler::chain_simple([LlamaSampler::temp(temperature), LlamaSampler::dist(42)]);

    // Token generation loop
    let mut generated_content = String::new();
    let mut n_generated: u32 = 0;
    let mut decoder = encoding_rs::UTF_8.new_decoder();

    let eos_token = model.token_eos();
    let mut decode_pos = tokens.len() as i32;

    loop {
        if n_generated >= max_tokens {
            break;
        }

        let cur_token = sampler.sample(&ctx, -1);

        if cur_token == eos_token {
            break;
        }

        let piece = model.token_to_piece(cur_token, &mut decoder, false, None)?;

        // Stream token to caller if channel provided
        if let Some(ref tx) = token_tx {
            let _ = tx.blocking_send(piece.clone());
        }

        generated_content.push_str(&piece);
        n_generated += 1;

        // Prepare batch for next token
        batch.clear();
        batch.add(cur_token, decode_pos, &[0], true)?;
        decode_pos += 1;

        ctx.decode(&mut batch)
            .context("Failed to decode generation batch")?;
    }

    let gen_time = gen_start.elapsed().as_millis() as u64;
    let tps = if gen_time > 0 {
        (n_generated as f32 / gen_time as f32) * 1000.0
    } else {
        0.0
    };

    tracing::info!(
        tokens = n_generated,
        ms = gen_time,
        tps = format!("{:.1}", tps),
        "Generation complete"
    );

    // Parse tool calls from generated content
    let (content, tool_calls) = extract_tool_calls(&generated_content);

    Ok(InferenceResult {
        content,
        tool_calls,
        tokens_generated: n_generated,
        tokens_prompt: n_prompt_tokens,
        generation_time_ms: gen_time,
        tokens_per_second: tps,
    })
}

// ---------------------------------------------------------------------------
// ChatML prompt builder
// ---------------------------------------------------------------------------

/// Build a ChatML-formatted prompt from messages.
///
/// Uses the Qwen/Nemotron-compatible format:
///   <|im_start|>system\n{content}<|im_end|>\n
///   <|im_start|>user\n{content}<|im_end|>\n
///   <|im_start|>assistant\n
fn build_chat_prompt(messages: &[ChatMessage]) -> String {
    let mut prompt = String::new();

    for msg in messages {
        if msg.role == "tool" {
            if let Some(ref tool_call_id) = msg.tool_call_id {
                prompt.push_str(&format!(
                    "<|im_start|>tool\n[tool_call_id: {}]\n{}<|im_end|>\n",
                    tool_call_id, msg.content
                ));
            } else {
                prompt.push_str(&format!("<|im_start|>tool\n{}<|im_end|>\n", msg.content));
            }
        } else if msg.role == "assistant" {
            if let Some(ref tool_calls) = msg.tool_calls {
                let mut block = msg.content.clone();
                for tc in tool_calls {
                    block.push_str(&format!(
                        "\n<tool_call>{{\"name\": \"{}\", \"arguments\": {}}}</tool_call>",
                        tc.function.name, tc.function.arguments
                    ));
                }
                prompt.push_str(&format!("<|im_start|>assistant\n{}<|im_end|>\n", block));
            } else {
                prompt.push_str(&format!(
                    "<|im_start|>assistant\n{}<|im_end|>\n",
                    msg.content
                ));
            }
        } else {
            prompt.push_str(&format!(
                "<|im_start|>{}\n{}<|im_end|>\n",
                msg.role, msg.content
            ));
        }
    }

    // Open the assistant turn for the model to fill
    prompt.push_str("<|im_start|>assistant\n");
    prompt
}

// ---------------------------------------------------------------------------
// Tool-call extraction
// ---------------------------------------------------------------------------

/// Extract tool calls from generated text.
///
/// Looks for `<tool_call>{"name": "...", "arguments": {...}}</tool_call>` blocks.
/// Returns clean text (markers removed) and parsed tool calls.
pub fn extract_tool_calls(content: &str) -> (String, Vec<ToolCall>) {
    let mut tool_calls = Vec::new();
    let mut clean_content = content.to_string();

    while let Some(start) = clean_content.find("<tool_call>") {
        if let Some(end) = clean_content.find("</tool_call>") {
            let block = &clean_content[start + 11..end];
            if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(block) {
                let name = parsed
                    .get("name")
                    .and_then(|v| v.as_str())
                    .unwrap_or("unknown")
                    .to_string();
                let arguments = parsed
                    .get("arguments")
                    .map(|v| v.to_string())
                    .unwrap_or_else(|| "{}".to_string());

                tool_calls.push(ToolCall {
                    id: format!("call_{}", uuid::Uuid::new_v4()),
                    r#type: "function".into(),
                    function: ToolCallFunction { name, arguments },
                });
            }
            clean_content = format!("{}{}", &clean_content[..start], &clean_content[end + 12..]);
        } else {
            break;
        }
    }

    (clean_content.trim().to_string(), tool_calls)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn chat_prompt_basic() {
        let messages = vec![
            ChatMessage {
                role: "system".into(),
                content: "You are a helpful assistant.".into(),
                tool_calls: None,
                tool_call_id: None,
            },
            ChatMessage {
                role: "user".into(),
                content: "Hello!".into(),
                tool_calls: None,
                tool_call_id: None,
            },
        ];
        let prompt = build_chat_prompt(&messages);
        assert!(prompt.contains("<|im_start|>system"));
        assert!(prompt.contains("<|im_start|>user"));
        assert!(prompt.ends_with("<|im_start|>assistant\n"));
    }

    #[test]
    fn extract_no_tool_call() {
        let (text, calls) = extract_tool_calls("just plain text");
        assert_eq!(text, "just plain text");
        assert!(calls.is_empty());
    }

    #[test]
    fn extract_single_tool_call() {
        let raw = r#"sure, calling it
<tool_call>
{"name":"read_file","arguments":{"path":"/tmp/x"}}
</tool_call>
done"#;
        let (text, calls) = extract_tool_calls(raw);
        assert!(text.contains("sure, calling it"));
        assert!(text.contains("done"));
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].function.name, "read_file");
    }

    #[test]
    fn extract_malformed_json_preserved() {
        let raw = "<tool_call>not json</tool_call>";
        let (text, calls) = extract_tool_calls(raw);
        assert_eq!(calls.len(), 0);
        // Malformed block is removed from clean_content
        assert!(text.is_empty() || !text.contains("<tool_call>"));
    }

    #[test]
    fn chat_prompt_with_tool_calls() {
        let messages = vec![ChatMessage {
            role: "assistant".into(),
            content: "Let me check.".into(),
            tool_calls: Some(vec![ToolCall {
                id: "tc_1".into(),
                r#type: "function".into(),
                function: ToolCallFunction {
                    name: "read_file".into(),
                    arguments: r#"{"path":"/tmp/x"}"#.into(),
                },
            }]),
            tool_call_id: None,
        }];
        let prompt = build_chat_prompt(&messages);
        assert!(prompt.contains("<tool_call>"));
        assert!(prompt.contains("read_file"));
    }
}
