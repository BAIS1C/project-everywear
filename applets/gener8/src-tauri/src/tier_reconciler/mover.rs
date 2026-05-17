//! Filesystem mover: plans and applies moves between models/ and models/.disabled/.
//!
//! Ported unchanged from S3 Studio.

use anyhow::{Context, Result};
use std::collections::BTreeSet;
use std::path::Path;

use super::entitlement::EntitledSet;

pub const DISABLED_DIR: &str = ".disabled";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Location {
    Active,
    Disabled,
}

#[derive(Debug, Clone)]
pub struct PlanItem {
    pub rel: String,
    pub from: Location,
    pub to: Location,
}

#[derive(Debug, Clone, Default)]
pub struct ReconcilePlan {
    pub items: Vec<PlanItem>,
    pub missing: Vec<String>,
}

impl ReconcilePlan {
    pub fn is_empty(&self) -> bool {
        self.items.is_empty()
    }
}

pub fn plan(models_dir: &Path, entitled: &EntitledSet) -> Result<ReconcilePlan> {
    let mut on_disk_active: BTreeSet<String> = BTreeSet::new();
    let mut on_disk_disabled: BTreeSet<String> = BTreeSet::new();

    if models_dir.exists() {
        walk_tree(models_dir, models_dir, false, &mut on_disk_active)?;
    }
    let disabled_root = models_dir.join(DISABLED_DIR);
    if disabled_root.exists() {
        walk_tree(&disabled_root, &disabled_root, true, &mut on_disk_disabled)?;
    }

    let mut items = Vec::new();

    for rel in &on_disk_active {
        if !entitled.contains(rel) {
            items.push(PlanItem {
                rel: rel.clone(),
                from: Location::Active,
                to: Location::Disabled,
            });
        }
    }

    for rel in &on_disk_disabled {
        if entitled.contains(rel) {
            items.push(PlanItem {
                rel: rel.clone(),
                from: Location::Disabled,
                to: Location::Active,
            });
        }
    }

    let present: BTreeSet<&str> = on_disk_active
        .iter()
        .chain(on_disk_disabled.iter())
        .map(String::as_str)
        .collect();
    let missing: Vec<String> = entitled
        .iter()
        .filter(|f| !present.contains(f.as_str()))
        .cloned()
        .collect();

    Ok(ReconcilePlan { items, missing })
}

pub fn apply(models_dir: &Path, plan: &ReconcilePlan) -> Result<()> {
    let disabled_root = models_dir.join(DISABLED_DIR);
    if !plan.items.is_empty() {
        std::fs::create_dir_all(&disabled_root)
            .with_context(|| format!("mkdir {}", disabled_root.display()))?;
    }

    let mut last_err: Option<anyhow::Error> = None;
    for item in &plan.items {
        let src = match item.from {
            Location::Active => models_dir.join(&item.rel),
            Location::Disabled => disabled_root.join(&item.rel),
        };
        let dst = match item.to {
            Location::Active => models_dir.join(&item.rel),
            Location::Disabled => disabled_root.join(&item.rel),
        };
        if let Some(parent) = dst.parent() {
            if let Err(e) = std::fs::create_dir_all(parent) {
                tracing::warn!("mover: mkdir {} failed: {}", parent.display(), e);
                last_err = Some(e.into());
                continue;
            }
        }
        if let Err(e) = std::fs::rename(&src, &dst) {
            tracing::warn!(
                "mover: rename {} -> {} failed: {}",
                src.display(),
                dst.display(),
                e
            );
            last_err = Some(e.into());
        }
    }

    if let Some(e) = last_err {
        return Err(e);
    }
    Ok(())
}

pub fn sweep_disabled(models_dir: &Path) -> Result<usize> {
    let disabled_root = models_dir.join(DISABLED_DIR);
    if !disabled_root.exists() {
        return Ok(0);
    }
    let mut count = 0usize;
    for entry in std::fs::read_dir(&disabled_root)
        .with_context(|| format!("readdir {}", disabled_root.display()))?
    {
        let entry = entry?;
        let path = entry.path();
        if path.is_dir() {
            std::fs::remove_dir_all(&path)
                .with_context(|| format!("sweep rmdir {}", path.display()))?;
        } else {
            std::fs::remove_file(&path).with_context(|| format!("sweep rm {}", path.display()))?;
        }
        count += 1;
    }
    Ok(count)
}

fn walk_tree(
    root: &Path,
    cur: &Path,
    under_disabled: bool,
    out: &mut BTreeSet<String>,
) -> Result<()> {
    for entry in std::fs::read_dir(cur).with_context(|| format!("readdir {}", cur.display()))? {
        let entry = entry?;
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();

        if !under_disabled && name == DISABLED_DIR {
            continue;
        }
        if name.starts_with('.') || name == "manifest.json" {
            continue;
        }
        if name.ends_with(".part") {
            continue;
        }

        if path.is_dir() {
            walk_tree(root, &path, under_disabled, out)?;
        } else if path.is_file() {
            let rel = path
                .strip_prefix(root)
                .map(|p| p.to_string_lossy().replace('\\', "/"))
                .unwrap_or(name.clone());
            out.insert(rel);
        }
    }
    Ok(())
}
