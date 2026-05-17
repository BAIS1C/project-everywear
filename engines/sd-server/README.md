# sd-server

stable-diffusion.cpp inference server, compiled as a standalone binary.

Consumed by: 1magen, 3nvizen, AI Director (S3 Studio)

The platform shell manages lifecycle (spawn, health check, graceful shutdown).
Applets never spawn sd-server directly; they request inference via the shell's
engine pool, which routes to the running sd-server instance.

For direct FFI (no sidecar), applets can link diffusion-rs instead.
See 1magen's engine.rs for the FFI pattern.

## Build

Compile from stable-diffusion.cpp source with CUDA support:

```bash
cmake -B build -DGGML_CUDA=ON -DSD_BUILD_SERVER=ON
cmake --build build --config Release
```

Binary: `build/bin/sd-server.exe` (Windows) or `build/bin/sd-server` (Linux)
