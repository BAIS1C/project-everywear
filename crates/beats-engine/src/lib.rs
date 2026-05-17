//! Beat detection engine extracted from Gener8.
//!
//! This crate is UI-agnostic: callers use `analyse` directly and decide
//! whether to expose it through Tauri, HTTP, or another transport.

pub mod cache;
pub mod engine;

pub use cache::BeatsCache;
pub use engine::{analyse, BeatMap};
