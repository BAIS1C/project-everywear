mod audit;
mod inference;
mod runtime;
mod runtime_ipc;
mod slot_manager;
mod types;

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "kasai=debug,info".parse().unwrap()),
        )
        .init();

    runtime_ipc::run().await;
}
