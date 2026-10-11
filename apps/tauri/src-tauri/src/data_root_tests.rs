// E1 搬迁内核测试（临时目录夹具；不依赖真实主目录）。

use super::*;

fn fixture(name: &str) -> PathBuf {
    let base = std::env::temp_dir().join(format!("worldsea-data-root-{}-{name}", std::process::id()));
    let _ = std::fs::remove_dir_all(&base);
    std::fs::create_dir_all(&base).expect("建夹具根");
    base
}

#[test]
fn migrate_copies_missing_subdirs_and_keeps_source() {
    let base = fixture("copy");
    let root = base.join("WorldSea");
    let legacy = base.join(".WorldSea");
    std::fs::create_dir_all(legacy.join("worlddata/entities")).unwrap();
    std::fs::write(legacy.join("worlddata/entities/a.json"), "{\"k\":1}").unwrap();
    std::fs::create_dir_all(legacy.join("rules")).unwrap();
    std::fs::write(legacy.join("rules/global.md"), "规则").unwrap();
    // 一个不该被迁的目录
    std::fs::create_dir_all(legacy.join("other")).unwrap();

    let migrated = migrate_under(&root, &legacy).expect("搬迁应成功");

    assert_eq!(migrated, vec!["worlddata".to_string(), "rules".to_string()]);
    assert_eq!(
        std::fs::read_to_string(root.join("worlddata/entities/a.json")).unwrap(),
        "{\"k\":1}"
    );
    assert!(root.join("rules/global.md").exists());
    assert!(!root.join("other").exists(), "非白名单子目录不迁");
    assert!(legacy.join("worlddata/entities/a.json").exists(), "只拷不删");
    let _ = std::fs::remove_dir_all(&base);
}

#[test]
fn migrate_skips_existing_targets_and_is_idempotent() {
    let base = fixture("skip");
    let root = base.join("WorldSea");
    let legacy = base.join(".WorldSea");
    std::fs::create_dir_all(legacy.join("skills")).unwrap();
    std::fs::write(legacy.join("skills/old.md"), "旧").unwrap();
    std::fs::create_dir_all(root.join("skills")).unwrap();
    std::fs::write(root.join("skills/new.md"), "新").unwrap();

    let first = migrate_under(&root, &legacy).expect("搬迁应成功");
    assert!(first.is_empty(), "目标已存在 → 不拷（以新根为准）");
    assert!(!root.join("skills/old.md").exists());
    assert_eq!(std::fs::read_to_string(root.join("skills/new.md")).unwrap(), "新");

    // 幂等：再跑一次仍为空
    assert!(migrate_under(&root, &legacy).expect("再跑应成功").is_empty());
    let _ = std::fs::remove_dir_all(&base);
}

#[test]
fn migrate_is_noop_when_legacy_absent() {
    let base = fixture("absent");
    let root = base.join("WorldSea");
    let legacy = base.join(".WorldSea"); // 不存在
    assert!(migrate_under(&root, &legacy).expect("无旧根应成功").is_empty());
    let _ = std::fs::remove_dir_all(&base);
}

#[test]
fn root_paths_are_composed_under_the_visible_root() {
    let base = fixture("paths");
    assert_eq!(base.join(ROOT_DIR_NAME), base.join("WorldSea"));
    assert_eq!(LEGACY_DIR_NAME, ".WorldSea");
    let _ = std::fs::remove_dir_all(&base);
}
