mod runtime_ipc;

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "threenvizen=debug,info".parse().unwrap()),
        )
        .init();

    runtime_ipc::run().await;
}
