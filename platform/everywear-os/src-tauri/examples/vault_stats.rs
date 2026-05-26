use anyhow::Result;
use ew_vault::{MediaFilter, SortField, VaultIndex, VaultItem};

fn main() -> Result<()> {
    std::thread::Builder::new()
        .name("vault-stats".to_string())
        .stack_size(64 * 1024 * 1024)
        .spawn(run_stats)?
        .join()
        .map_err(|_| anyhow::anyhow!("Vault stats thread panicked"))?
}

fn run_stats() -> Result<()> {
    let index = VaultIndex::open_or_create(everywear_paths::vault_index_dir())?;
    for (label, filter) in [
        ("all", MediaFilter::All),
        ("audio", MediaFilter::Audio),
        (
            "gener8_song",
            MediaFilter::AudioKind("gener8_song".to_string()),
        ),
        (
            "local_audio",
            MediaFilter::AudioKind("local_audio".to_string()),
        ),
        ("stem", MediaFilter::Stems),
        ("reference", MediaFilter::AudioKind("reference".to_string())),
        (
            "cover_source",
            MediaFilter::AudioKind("cover_source".to_string()),
        ),
        ("video", MediaFilter::Videos),
    ] {
        let total = index.search_total("", Some(filter.clone()))?;
        println!("{label}={total}");
        let items = index.search("", Some(filter), SortField::Newest, 8, 0)?;
        for item in items {
            println!("  - {} :: {}", item_title(&item), item_path(&item));
        }
    }
    Ok(())
}

fn item_path(item: &VaultItem) -> &str {
    match item {
        VaultItem::Image(doc) => &doc.file_path,
        VaultItem::Audio(doc) => &doc.file_path,
        VaultItem::Video(doc) => &doc.file_path,
    }
}

fn item_title(item: &VaultItem) -> &str {
    match item {
        VaultItem::Image(doc) => &doc.title,
        VaultItem::Audio(doc) => &doc.title,
        VaultItem::Video(doc) => &doc.title,
    }
}
