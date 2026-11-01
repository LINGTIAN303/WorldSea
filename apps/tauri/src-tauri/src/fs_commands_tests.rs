// fs_commands.rs 的测试（`#[path]` 子模块，见 fs_commands.rs 尾部声明）。
// 只覆盖 cmd_fs_list 的 limit 截断语义——其它命令的路径守卫另有前端契约测试。
use super::*;

use std::fs;

/// 建临时目录并写入 n 个文件，返回目录路径（调用方负责清理）
fn seed_dir(tag: &str, n: usize) -> std::path::PathBuf {
    let dir = std::env::temp_dir().join(format!("worldsea_fs_list_test_{tag}_{}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).expect("建临时目录");
    for i in 0..n {
        fs::write(dir.join(format!("f{i}.txt")), b"x").expect("写文件");
    }
    dir
}

#[test]
fn list_without_limit_returns_everything() {
    let dir = seed_dir("all", 7);
    let entries = list_dir_inner(&dir.to_string_lossy(), false, None).expect("列目录");
    assert_eq!(entries.len(), 7);
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn list_with_limit_truncates_at_collection_time() {
    let dir = seed_dir("limit", 7);
    let entries = list_dir_inner(&dir.to_string_lossy(), false, Some(3)).expect("列目录");
    assert_eq!(entries.len(), 3, "应只返回 limit 条");
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn limit_larger_than_dir_returns_all() {
    let dir = seed_dir("big_limit", 4);
    let entries = list_dir_inner(&dir.to_string_lossy(), false, Some(100)).expect("列目录");
    assert_eq!(entries.len(), 4);
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn limit_zero_returns_empty() {
    let dir = seed_dir("zero", 5);
    let entries = list_dir_inner(&dir.to_string_lossy(), false, Some(0)).expect("列目录");
    assert!(entries.is_empty(), "limit=0 应返回空列表");
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn recursive_list_respects_limit() {
    let dir = seed_dir("recursive", 2);
    let sub = dir.join("sub");
    fs::create_dir_all(&sub).expect("建子目录");
    for i in 0..3 {
        fs::write(sub.join(format!("g{i}.txt")), b"y").expect("写子目录文件");
    }
    let all = list_dir_inner(&dir.to_string_lossy(), true, None).expect("递归列目录");
    assert_eq!(all.len(), 6, "2 顶文件 + 1 子目录条目 + 3 子文件");
    let capped = list_dir_inner(&dir.to_string_lossy(), true, Some(2)).expect("递归列目录");
    assert_eq!(capped.len(), 2);
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn missing_dir_errors_regardless_of_limit() {
    let ghost = std::env::temp_dir().join("worldsea_fs_list_test_definitely_absent_dir");
    let _ = fs::remove_dir_all(&ghost);
    assert!(list_dir_inner(&ghost.to_string_lossy(), false, Some(10)).is_err());
}
