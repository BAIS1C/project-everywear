# llama-server

llama.cpp inference server for LLM tasks.

Consumed by: Kasai (local AI agent)

For direct FFI (no sidecar), Kasai links llama-cpp-2 crate instead.
See Kasai-Local's engine modules for the FFI pattern.

The platform shell can run llama-server as a shared daemon when multiple
applets need LLM inference simultaneously (e.g., Kasai + Mymories).
