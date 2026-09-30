// G3：acl_fix 的纯函数单测——fixture 直接取自真机采样（docs/plans/2026-10-01-G3-可回滚工作区修复批计划.md §二）。

use std::path::PathBuf;

use super::*;

/// 真机一次「修复成功」运行的 stdout 尾部（2026-10-01，D:\ws-g3-test 采样，原样）。
const REAL_REPAIR_TAIL: &str = "\
BACKUP D:\\ws-g3-test -> D:\\ws-g3-test\\.acl-recovery\\acl-backup-3eeb0626990748408b4bb23220f4e279.json
ROLLBACK pwsh -NoProfile -File 'D:\\ws-g3-test\\.acl-recovery\\acl-backup-3eeb0626990748408b4bb23220f4e279.json.ps1' -Path 'D:\\ws-g3-test' -AllowRoot 'D:\\ws-g3-test' -Restore 'D:\\ws-g3-test\\.acl-recovery\\acl-backup-3eeb0626990748408b4bb23220f4e279.json'
GRANTED D:\\ws-g3-test SID=S-1-5-21-2903557706-1580976727-903161278-1001
RECAP {\"verdicts\":[{\"packageObjects\":[],\"path\":\"D:\\\\ws-g3-test\",\"verdict\":\"PRECONDITION\",\"writeDac\":true,\"writeOwner\":false}],\"changes\":[{\"path\":\"D:\\\\ws-g3-test\",\"operation\":\"grant_dacl\"}],\"verifications\":[{\"operation\":\"grant\",\"path\":\"D:\\\\ws-g3-test\",\"status\":\"verified\"}],\"refusals\":[],\"scans\":[{\"packageSources\":[],\"visited\":1,\"path\":\"D:\\\\ws-g3-test\",\"unreadable\":0,\"truncated\":false}],\"report\":\"D:\\\\ws-g3-test\\\\.acl-recovery\\\\acl-report-48c3e3d6472240b299a420ddb273f5b8.jsonl\"}
REPORT_FILE D:\\ws-g3-test\\.acl-recovery\\acl-report-48c3e3d6472240b299a420ddb273f5b8.jsonl
SUMMARY FIXED=0 GRANTED=1 REFUSED=0 RESTORED=0";

#[test]
fn parse_script_stdout_reads_the_real_tail() {
    let summary = parse_script_stdout(REAL_REPAIR_TAIL);
    assert_eq!(summary.granted, 1);
    assert_eq!(summary.fixed, 0);
    assert_eq!(summary.refused, 0);
    assert_eq!(summary.restored, 0);
    assert_eq!(summary.rollbacks.len(), 1);
    assert!(summary.rollbacks[0].starts_with("pwsh -NoProfile -File '"));
    assert!(summary.rollbacks[0].contains(" -Restore '"));
    assert_eq!(
        summary.report.as_deref(),
        Some("D:\\ws-g3-test\\.acl-recovery\\acl-report-48c3e3d6472240b299a420ddb273f5b8.jsonl")
    );
}

#[test]
fn parse_script_stdout_handles_other_count_shapes() {
    let summary = parse_script_stdout("SUMMARY FIXED=2 GRANTED=0 REFUSED=1 RESTORED=3\n");
    assert_eq!(
        (summary.fixed, summary.granted, summary.refused, summary.restored),
        (2, 0, 1, 3)
    );
    // 缺行 / 垃圾输入：全零，不 panic。
    assert_eq!(parse_script_stdout("no summary here"), ScriptSummary::default());
    assert_eq!(parse_script_stdout("SUMMARY FIXED=x GRANTED=\n").granted, 0);
}

#[test]
fn parse_recap_refusals_reads_paths_and_reasons() {
    let fixture = "\
RECAP {\"verdicts\":[],\"changes\":[],\"verifications\":[],\"refusals\":[{\"path\":\"D:\\\\A\",\"reason\":\"reparse point refused\"},{\"path\":\"D:\\\\B\",\"reason\":\"managed tree\"}],\"scans\":[],\"report\":null}";
    let refusals = parse_recap_refusals(fixture);
    assert_eq!(refusals.len(), 2);
    assert_eq!(refusals[0], "D:\\A：reparse point refused");
    assert_eq!(refusals[1], "D:\\B：managed tree");
    // 真机成功 fixture 的 refusals 为空；畸形输入不 panic。
    assert!(parse_recap_refusals(REAL_REPAIR_TAIL).is_empty());
    assert!(parse_recap_refusals("RECAP not-json").is_empty());
    assert!(parse_recap_refusals("no recap at all").is_empty());
}

#[test]
fn write_restore_commands_writes_and_reads_back() {
    let dir = std::env::temp_dir().join(format!("acl-fix-test-{}", std::process::id()));
    std::fs::create_dir_all(&dir).expect("建临时目录");
    let line = "icacls \"D:\\ws\" /remove:g \"DOMAIN\\user\"".to_string();
    let file = write_restore_commands(&dir, std::slice::from_ref(&line), None).expect("写恢复命令");
    assert_eq!(file.file_name().and_then(|n| n.to_str()), Some("restore-command.txt"));
    let text = std::fs::read_to_string(&file).expect("读回");
    assert!(text.contains(&line), "恢复命令原文应在文件里");
    assert!(text.contains("恢复命令"), "应带中文说明头");
    // 警示分支：以注释行前置，不混入命令区。
    let file = write_restore_commands(&dir, std::slice::from_ref(&line), Some("已有既存项，请核对"))
        .expect("写警示版");
    let text = std::fs::read_to_string(&file).expect("读回警示版");
    assert!(text.contains("# ⚠ 已有既存项，请核对"), "警示应以注释行呈现");
    // 空命令列表：拒绝写入（不产生空文件）。
    assert!(write_restore_commands(&dir, &[], None).is_err());
    std::fs::remove_dir_all(&dir).ok();
}

#[test]
fn icacls_remove_line_quotes_paths() {
    let line = icacls_remove_line(std::path::Path::new("D:\\ws"), "DOMAIN\\user");
    assert_eq!(line, "icacls \"D:\\ws\" /remove:g \"DOMAIN\\user\"");
}

#[test]
fn has_explicit_user_ace_distinguishes_inherited_and_explicit() {
    // 真机形态：授权后首行 = 路径 + 显式 ACE（无 (I)）——应判「有」。
    let granted = "\
D:\\ws-g3-test DESKTOP-LRGSUML\\LINGTIAN303:(OI)(CI)(F)
              BUILTIN\\Administrators:(I)(F)
              NT AUTHORITY\\Authenticated Users:(I)(M)";
    assert!(has_explicit_user_ace(granted, "DESKTOP-LRGSUML\\LINGTIAN303"));
    // 原状（仅继承项）——应判「无」。
    let inherited_only = "\
D:\\ws-g3-test BUILTIN\\Administrators:(I)(F)
              NT AUTHORITY\\Authenticated Users:(I)(M)
              BUILTIN\\Users:(I)(RX)";
    assert!(!has_explicit_user_ace(inherited_only, "DESKTOP-LRGSUML\\LINGTIAN303"));
    // 同用户的**继承**项不算显式。
    let inherited_user = "D:\\ws BUILTIN\\X:(I)(F)\n              DESKTOP-LRGSUML\\LINGTIAN303:(I)(M)";
    assert!(!has_explicit_user_ace(inherited_user, "DESKTOP-LRGSUML\\LINGTIAN303"));
    // 大小写不敏感 + 别家 trustee 不误判。
    assert!(has_explicit_user_ace(granted, "desktop-lrgsUML\\lingtian303"));
    assert!(!has_explicit_user_ace(granted, "OTHERDOMAIN\\LINGTIAN303"));
}

/// 上游脚本必须还在登记的相对路径上（追版挪位 = 红，提示更新 UPSTREAM_SCRIPT_REL）。
#[test]
fn upstream_script_exists_at_the_registered_path() {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..").join("..").join("..").join("dsh");
    let script = root.join(UPSTREAM_SCRIPT_REL);
    assert!(
        script.is_file(),
        "上游脚本不在预期路径（dsh 追版挪位？）：{}",
        script.display()
    );
}
