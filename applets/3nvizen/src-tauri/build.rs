fn main() {
    println!("cargo:rerun-if-changed=sidecar/ltx-runtime");

    // CODEX_NEEDED: 3nvizen sidecar packaging strategy.
    // Dev recommendation: ship the Python source and launch with uv from
    // sidecar/ltx-runtime, matching Gener8's uv-managed runtime direction.
    // Production recommendation: freeze server.py with PyInstaller once the
    // concrete LTX Desktop pipeline environment is pinned.
}
