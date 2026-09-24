// workspace_probe 的测试：纯函数（标签/修复命令/说明）+ 真机 live 探测（默认 ignore，见下）。

use super::*;

#[test]
fn label_distinguishes_every_outcome() {
    let labels = [
        WorkspaceProbe::Ready.label(),
        WorkspaceProbe::Missing.label(),
        WorkspaceProbe::NoWriteOwner.label(),
        WorkspaceProbe::Failed("x".into()).label(),
    ];
    assert_eq!(labels[0], "可供给");
    assert!(labels[1..].iter().all(|label| *label != labels[0]));
}

#[test]
fn fix_command_is_an_icacls_grant_of_full_control() {
    let command = fix_command(std::path::Path::new(r"D:\A"));
    assert!(command.starts_with("icacls \"D:\\A\" /grant \""), "{command}");
    assert!(command.ends_with(":(OI)(CI)F\""), "{command}");
}

#[test]
fn no_write_owner_description_carries_the_fix_command() {
    let dir = std::path::Path::new(r"D:\A");
    let text = WorkspaceProbe::NoWriteOwner.describe(dir);
    assert!(text.contains("WRITE_OWNER"), "{text}");
    assert!(text.contains(&fix_command(dir)), "{text}");
    assert!(text.contains("Low 完整性标签"), "{text}");
}

#[test]
fn missing_directory_is_not_ready() {
    assert!(!WorkspaceProbe::Missing.is_ready());
    assert!(WorkspaceProbe::Ready.is_ready());
    assert!(!check(std::path::Path::new(r"Z:\worldsea-definitely-missing")).is_ready());
}

/// 真机 live 探测（反证式验收用）：
/// `WORLDSEA_PROBE_GOOD` = 期望可供给的目录（如 `%USERPROFILE%`），
/// `WORLDSEA_PROBE_BAD` = 期望不可供给的目录（如 `D:\A`、`D:\WorldSea\dsh`）。
/// 复跑：`cargo test --lib -- --ignored probe_live_dirs`（单线程，避免既有 WAL flake）。
#[test]
#[ignore]
fn probe_live_dirs() {
    let good = std::env::var("WORLDSEA_PROBE_GOOD").expect("需要 WORLDSEA_PROBE_GOOD");
    let bad = std::env::var("WORLDSEA_PROBE_BAD").expect("需要 WORLDSEA_PROBE_BAD");
    let good = check(std::path::Path::new(&good));
    let bad = check(std::path::Path::new(&bad));
    println!("good => {} ({})", good.label(), good.describe(std::path::Path::new("good")));
    println!("bad  => {} ({})", bad.label(), bad.describe(std::path::Path::new("bad")));
    assert_eq!(good, WorkspaceProbe::Ready, "期望可供给却报 {good:?}");
    assert_eq!(bad, WorkspaceProbe::NoWriteOwner, "期望不可供给却报 {bad:?}");
}
