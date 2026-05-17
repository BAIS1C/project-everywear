//! Beat detection service for the axum shim.
//!
//! Exposes `GET /api/beats?path=<abs_path>&sr=<int>&cache=<bool>` on
//! :3001, returning a BeatMap (BPM, beat positions, downbeats, sections).
//!
//! Pipeline:
//!   path -> symphonia decode -> f32 mono samples -> aubio Tempo tracker
//!        -> beats[] + bpm -> derived downbeats + sections -> BeatMap
//!
//! Ported from S3 Studio. Key migration changes:
//!   - Cache dir via everywear_paths::data_dir("gener8")/cache/beats/
//!   - Handler takes ShimState from crate::shim (not S3's ShimState)

pub mod cache;
pub mod engine;
pub mod handler;

pub use cache::BeatsCache;
pub use handler::beats_handler;
