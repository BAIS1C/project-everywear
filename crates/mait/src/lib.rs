//! MAIT: trait-shard personality engine.
//!
//! Manages composable personality traits for AI agents within
//! the Everywear ecosystem. Each agent (Kasai, game NPCs, etc.)
//! is defined by a set of trait shards that control tone, knowledge
//! domain, response style, and behavioural boundaries.
//!
//! Trait shards are JSON-serializable, versionable, and composable.

pub mod shard;
pub mod agent;
