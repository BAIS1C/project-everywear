# Context Budget Tiers

Reference table for sizing modules across different agent capabilities.

## Agent Context Windows (Realistic Usable)

| Agent                  | Raw Context | System/Overhead | Usable for Code+Wiki+Tests |
|------------------------|-------------|-----------------|----------------------------|
| Kasai Q8 9B (16GB)     | 32k         | ~8k             | ~24k                       |
| Kasai Q4 35B (32GB)    | 65k         | ~10k            | ~55k                       |
| Claude Sonnet 4.6      | 200k        | ~15k            | ~185k                      |
| Claude Opus 4.7        | 200k        | ~15k            | ~185k                      |
| Codex Max              | 200k+       | ~20k            | ~180k                      |

## Canonical Budget: 65k

The canonical budget targets the Kasai Q4 35B tier. This ensures:

- Every module is maintainable by the local orchestrator agent
- Cloud agents have massive headroom (can load multiple modules simultaneously)
- The constraint forces good separation of concerns regardless of agent capability

## Token Estimation Rules

For quick estimation without a tokenizer:

- **Rust**: ~3.5 tokens per line (verbose syntax, type annotations)
- **TypeScript/TSX**: ~3.5 tokens per line (JSX, type annotations)
- **Python**: ~3.0 tokens per line (concise syntax)
- **Markdown**: ~2.5 tokens per line (natural language, less punctuation)

Conservative rule of thumb: **4 tokens per line** covers all languages with margin.

## Size Thresholds

| Lines    | Est. Tokens | Status                                    |
|----------|-------------|-------------------------------------------|
| < 500    | < 2k        | Comfortable. Room for wiki + tests + conv  |
| 500-1000 | 2-4k        | Normal. Standard module size               |
| 1000-2000| 4-8k        | Watch. Approaching split consideration     |
| 2000-4000| 8-16k       | Split candidate. Review boundaries         |
| 4000+    | 16k+        | Hard split. Exceeds code budget slot       |

## VRAM Impact on KV-Cache

Local model context is constrained by VRAM allocated to KV-cache. The model weights consume
a fixed amount; remaining VRAM determines max context:

| VRAM  | Model          | Weights | KV-Cache Available | Practical Context |
|-------|----------------|---------|--------------------|--------------------|
| 8GB   | Q4 9B          | ~5GB    | ~3GB               | ~16k tokens        |
| 12GB  | Q8 9B          | ~9GB    | ~3GB               | ~24k tokens        |
| 16GB  | Q4 35B         | ~14GB   | ~2GB               | ~28k tokens        |
| 24GB  | Q8 9B + Q4 35B | ~23GB   | varies             | 32-48k tokens      |
| 32GB  | Q4 35B         | ~14GB   | ~18GB              | ~65k tokens        |

These numbers are approximate and depend on quantization, batch size, and whether other
processes (ComfyUI, LTX) are consuming VRAM simultaneously.
