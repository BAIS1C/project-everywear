//! MAIT: trait-shard personality engine.
//!
//! Manages composable personality traits for AI agents within
//! the Everywear ecosystem. Each agent (Kasai, game NPCs, etc.)
//! is defined by a set of trait shards that control tone, knowledge
//! domain, response style, and behavioural boundaries.
//!
//! Trait shards are JSON-serializable, versionable, and composable.

pub mod agent;
pub mod shard;

pub use agent::AgentIdentity;
pub use shard::{
    deserialize_strands_avatar_v1, AestheticShard, MaitManifest, MaitStore, ManifestSource,
    STRANDS_AVATAR_V1,
};
