//! `audit_result`: Big reviews Small's tool-execution log and produces the
//! final user-facing answer.
//!
//! Ported from Kasai-Local's `kasai-inference/audit.rs`.
//!
//! The audit prompt forces Big to either:
//!   - confirm Small completed the task and synthesise an answer, or
//!   - call out specific failures and propose remediation
//! and emit a structured JSON envelope containing the user-facing summary
//! plus the audit verdict.
//!
//! Everywear adaptation notes:
//! - Replaces `LocalProvider` with direct `LoadedModel::generate()` calls
//! - Replaces `kasai_api` types with inference.rs types
//! - `raw_response` is a plain String (no MessageResponse wrapper)

use std::sync::Arc;

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use tracing::{instrument, warn};

use crate::inference::{ChatMessage, LoadedModel};
use crate::slot_manager::{ModelSpec, SmallToolLog};

// =============================================================================
// Audit outcome (returned to caller, surfaced to UI)
// =============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuditOutcome {
    /// What Big tells the user. Free-form prose.
    pub user_response: String,
    /// Big's structured judgement on Small's work.
    pub verdict: AuditVerdict,
    /// Reason text supporting the verdict, plain language.
    pub rationale: String,
    /// Big-suggested follow-up actions, if any. Surface as queued tasks.
    pub follow_ups: Vec<String>,
    /// Raw Big response text for debugging / logging to vault.
    pub raw_response: String,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AuditVerdict {
    /// Small completed the task; Big concurs.
    Pass,
    /// Small completed but result is incomplete or unclear; Big still answers
    /// but with an explicit caveat.
    PassWithCaveat,
    /// Small failed materially; Big rejects the result and explains.
    Fail,
    /// Result requires human follow-up that Big cannot resolve alone.
    Inconclusive,
}

// =============================================================================
// audit_result: the entry point used by SlotManager
// =============================================================================

#[instrument(skip(big_handle, big_spec, original_messages, big_plan, small_log))]
pub async fn audit_result(
    big_handle: &Arc<LoadedModel>,
    big_spec: &ModelSpec,
    original_messages: &[ChatMessage],
    big_plan: &str,
    small_log: &SmallToolLog,
) -> Result<AuditOutcome> {
    let messages = build_audit_messages(original_messages, big_plan, small_log);

    let result = big_handle
        .generate(messages, big_spec.max_tokens.max(1024), 0.2, None)
        .await
        .context("Audit generation failed")?;

    let raw = result.content.clone();
    let parsed = parse_audit_response(&raw).unwrap_or_else(|e| {
        warn!(error = %e, "audit response did not parse as structured JSON; falling back to text-only summary");
        AuditOutcome {
            user_response: raw.clone(),
            verdict: AuditVerdict::PassWithCaveat,
            rationale: format!("audit envelope parse failure: {e}"),
            follow_ups: Vec::new(),
            raw_response: raw.clone(),
        }
    });

    Ok(AuditOutcome {
        raw_response: raw,
        ..parsed
    })
}

// =============================================================================
// Prompt construction
// =============================================================================

fn build_audit_messages(
    original_messages: &[ChatMessage],
    big_plan: &str,
    small_log: &SmallToolLog,
) -> Vec<ChatMessage> {
    let user_request_text = original_messages
        .iter()
        .filter(|m| m.role == "user")
        .map(|m| m.content.as_str())
        .collect::<Vec<_>>()
        .join("\n");

    let invocations_summary = small_log
        .invocations
        .iter()
        .map(|inv| {
            let arg_str = serde_json::to_string(&inv.input).unwrap_or_default();
            let truncated_out = truncate(&inv.output, 800);
            format!(
                "[{}] {} (id={}) args={} {}\n  -> {}",
                inv.iteration,
                inv.name,
                inv.id,
                arg_str,
                if inv.is_error { "[ERROR]" } else { "" },
                truncated_out
            )
        })
        .collect::<Vec<_>>()
        .join("\n");

    let termination_note = if small_log.terminated_by_iteration_cap {
        "Small was halted by the iteration cap; the loop did not converge naturally."
    } else if small_log.terminated_by_small_completion {
        "Small concluded the loop on its own (no further tool calls)."
    } else {
        "Loop terminated for an unspecified reason."
    };

    let user_text = format!(
        "USER ORIGINAL REQUEST:\n{}\n\nMY (BIG) PLAN:\n{}\n\nSMALL'S TOOL EXECUTION LOG:\n{}\n\nTERMINATION:\n{}\n\n\
        Decide whether the user's request has been satisfied. Audit the tool execution. \
        Then produce the user-facing answer.\n\n\
        Output STRICT JSON, no commentary, matching this schema exactly:\n\
        {{\n  \
          \"user_response\": \"the answer the user will see, written as if speaking to them directly\",\n  \
          \"verdict\": \"pass | pass_with_caveat | fail | inconclusive\",\n  \
          \"rationale\": \"one or two sentences explaining the verdict\",\n  \
          \"follow_ups\": [\"optional list of follow-up actions to surface as tasks\"]\n\
        }}",
        user_request_text, big_plan, invocations_summary, termination_note,
    );

    vec![
        ChatMessage {
            role: "system".into(),
            content: AUDIT_SYSTEM_PROMPT.to_string(),
            tool_calls: None,
            tool_call_id: None,
        },
        ChatMessage {
            role: "user".into(),
            content: user_text,
            tool_calls: None,
            tool_call_id: None,
        },
    ]
}

const AUDIT_SYSTEM_PROMPT: &str = "You are the Auditor. The system has \
just executed a multi-step task using a smaller agent model. Your job is \
to audit the result and produce the final user-facing answer.\n\n\
Be honest. If the smaller agent failed, say so plainly. Do not paper over \
errors. Do not invent results that were not produced. If the tool log shows \
errors that the smaller agent ignored, surface them.\n\n\
Output STRICT JSON only. No prose outside the JSON envelope. No code fences. \
No preamble.";

// =============================================================================
// Parsing
// =============================================================================

fn parse_audit_response(raw: &str) -> std::result::Result<AuditOutcome, String> {
    let trimmed = raw.trim();

    // Tolerate accidental code fences.
    let json_str = if trimmed.starts_with("```") {
        trimmed
            .trim_start_matches("```json")
            .trim_start_matches("```")
            .trim_end_matches("```")
            .trim()
    } else {
        trimmed
    };

    let parsed: AuditEnvelope =
        serde_json::from_str(json_str).map_err(|e| format!("parse audit JSON: {e}"))?;

    let verdict = match parsed.verdict.as_str() {
        "pass" => AuditVerdict::Pass,
        "pass_with_caveat" => AuditVerdict::PassWithCaveat,
        "fail" => AuditVerdict::Fail,
        "inconclusive" => AuditVerdict::Inconclusive,
        other => return Err(format!("unknown verdict: {other}")),
    };

    Ok(AuditOutcome {
        user_response: parsed.user_response,
        verdict,
        rationale: parsed.rationale,
        follow_ups: parsed.follow_ups.unwrap_or_default(),
        raw_response: String::new(), // Filled in by caller
    })
}

#[derive(Debug, Deserialize)]
struct AuditEnvelope {
    user_response: String,
    verdict: String,
    rationale: String,
    follow_ups: Option<Vec<String>>,
}

// =============================================================================
// Helpers
// =============================================================================

fn truncate(s: &str, max_chars: usize) -> String {
    if s.chars().count() <= max_chars {
        s.to_string()
    } else {
        let mut out: String = s.chars().take(max_chars).collect();
        out.push_str("...[truncated]");
        out
    }
}

// =============================================================================
// Tests
// =============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_audit_envelope_clean_json() {
        let body = r#"{
            "user_response": "Filed your invoice under Strands / April.",
            "verdict": "pass",
            "rationale": "Small successfully read inbox and located the invoice email.",
            "follow_ups": []
        }"#;
        let out = parse_audit_response(body).expect("should parse");
        assert_eq!(out.verdict, AuditVerdict::Pass);
        assert!(out.user_response.contains("Strands"));
    }

    #[test]
    fn parse_audit_envelope_with_code_fence() {
        let body =
            "```json\n{\"user_response\":\"x\",\"verdict\":\"fail\",\"rationale\":\"y\"}\n```";
        let out = parse_audit_response(body).expect("should tolerate code fence");
        assert_eq!(out.verdict, AuditVerdict::Fail);
    }

    #[test]
    fn parse_unknown_verdict_errors() {
        let body = r#"{"user_response":"x","verdict":"weird","rationale":"y"}"#;
        assert!(parse_audit_response(body).is_err());
    }

    #[test]
    fn parse_missing_follow_ups_defaults_empty() {
        let body = r#"{"user_response":"done","verdict":"pass","rationale":"ok"}"#;
        let out = parse_audit_response(body).expect("should parse without follow_ups");
        assert!(out.follow_ups.is_empty());
    }
}
