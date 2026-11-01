// fs_drives.rs 的测试（`#[path]` 子模块，见 fs_drives.rs 尾部声明）。
use super::*;

#[test]
fn mask_maps_to_ordered_lettered_drives() {
    // C: (bit 2) + D: (bit 3) + Z: (bit 25)
    let drives = drives_from_mask(0b10_0000_0000_0000_0000_0000_1100);
    assert_eq!(drives.len(), 3);
    assert_eq!(drives[0].name, "C:");
    assert_eq!(drives[0].path, "C:/");
    assert_eq!(drives[1].name, "D:");
    assert_eq!(drives[2].name, "Z:");
}

#[test]
fn empty_mask_yields_no_drives() {
    assert!(drives_from_mask(0).is_empty());
}

#[test]
fn drive_paths_always_use_forward_slash() {
    // 前端按正斜杠拼路径（与 cmd_fs_list 输出口径一致）
    for entry in drives_from_mask(u32::MAX) {
        assert!(entry.path.ends_with('/'), "{} 应以正斜杠结尾", entry.path);
        assert!(!entry.path.contains('\\'), "{} 不该含反斜杠", entry.path);
    }
}

#[test]
fn kind_labels_cover_win32_drive_types() {
    assert_eq!(kind_of(2), "removable");
    assert_eq!(kind_of(3), "fixed");
    assert_eq!(kind_of(4), "network");
    assert_eq!(kind_of(5), "cdrom");
    assert_eq!(kind_of(6), "ram");
    assert_eq!(kind_of(0), "unknown");
    assert_eq!(kind_of(1), "unknown");
}

#[test]
fn enumerate_drives_returns_at_least_one_root() {
    // 真机枚举：任何可用环境都至少应有一个可浏览根，且条目路径非空
    let drives = enumerate_drives().expect("枚举盘符不该失败");
    assert!(!drives.is_empty());
    assert!(drives.iter().all(|d| !d.path.is_empty() && !d.name.is_empty()));
}
