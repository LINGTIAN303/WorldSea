// G3（2026-10-01）：可回滚的工作区修复（rc.2 形态）——从「一次性 icacls 授权」升级为
// 「先备份 → 修复 → 复核 → 留恢复命令」。
//
// 口径（用户 2026-10-01 拍板）：
// ① 主路径 = 上游 rc.2 的 `diagnose-windows-sandbox-acl` 脚本（pwsh；一次运行完成诊断 + 修复：
//    祖先链 WRITE_DAC/WRITE_OWNER 缺失一并修、显式 AppContainer 包 ACE 清理、每处改动先备份后
//    复核、失败自动回滚、产出独立恢复脚本与 ROLLBACK 命令）；pwsh 或脚本不可用时落日志并降级 ②。
// ② 兜底 = icacls 路线（裸 Windows 可用），同样升级为可回滚：/save 留「修复前 SDDL 存档」→ /grant →
//    回滚命令 `icacls /remove:g <用户>` 落盘。**为何不用 /save→/restore**：本机实测四种变体
//    （同 CWD / 盘根 CWD / 绝对路径改写 / 无扩展名文件）下 /restore 均「处理 0 个文件」不生效
//    （2026-10-01 受控实验；/remove:g 同场实测可用）——存档仍留（供人工核对），回滚以 /remove:g 为准；
//    修复前若已有该用户的显式授权项，命令文件会附警示（/remove:g 会把它们一并移除）。
// ③ 恢复产物一律 `<工作区>/.acl-recovery/`；恢复由用户执行 `restore-command.txt` 里的命令
//    （不做壳内一键回滚——对齐上游立场）。
// ④ 上游脚本真跑了就以其结论为准：失败**不**回退 icacls（它的拒绝/中止是安全判定，绕过即错）。
//
// 上游输出面（真机采样，见 docs/plans/2026-10-01-G3-可回滚工作区修复批计划.md §二）：
// 尾部为 `RECAP {json}` / `REPORT_FILE <path>` / `SUMMARY FIXED=.. GRANTED=.. REFUSED=.. RESTORED=..`；
// 每处改动逐条打印 `ROLLBACK <cmd>`，备份为 `<恢复目录>/acl-backup-<id>.json` 与其 `.ps1`。

use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use crate::workspace_probe;

/// 恢复产物目录（工作区根下；持久、用户可寻、与失败现场同位）。
pub(crate) const RECOVERY_DIR: &str = ".acl-recovery";
/// 上游脚本在 dsh 树内的相对路径（追版若挪位：启动日志会显式降级到 icacls 兜底，并有单测守卫）。
const UPSTREAM_SCRIPT_REL: &str =
    "packages/sandbox/sandbox-windows-acl/assets/diagnose-windows-sandbox-acl/scripts/diagnose-windows-sandbox-acl.ps1";
/// 上游脚本运行上限（其子树扫描自带上限 2000 目录；此处再兜一层，防挂死）。
const PWSH_TIMEOUT: Duration = Duration::from_secs(120);
const POLL_INTERVAL: Duration = Duration::from_millis(100);

/// 修复结果（命令层返回给横幅/菜单直接展示）。
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FixOutcome {
    /// `pwsh`（上游脚本）| `icacls`（兜底）。
    pub mode: &'static str,
    /// 修复后探测标签（`可供给` 等）。
    pub label: String,
    /// 恢复产物目录（绝对路径）。
    pub recovery_dir: String,
    /// 展示文案（含恢复指引；横幅与菜单透出这一段）。
    pub note: String,
}

/// 上游脚本 stdout 的解析结果（纯数据，fixture 单测）。
#[derive(Debug, Clone, Default, PartialEq)]
pub(crate) struct ScriptSummary {
    pub granted: u32,
    pub fixed: u32,
    pub refused: u32,
    pub restored: u32,
    pub rollbacks: Vec<String>,
    pub report: Option<String>,
}

/// 解析脚本 stdout 尾部的 `ROLLBACK` / `REPORT_FILE` / `SUMMARY` 行。
pub(crate) fn parse_script_stdout(stdout: &str) -> ScriptSummary {
    let mut summary = ScriptSummary::default();
    for line in stdout.lines() {
        if let Some(rest) = line.strip_prefix("ROLLBACK ") {
            summary.rollbacks.push(rest.trim().to_string());
        } else if let Some(rest) = line.strip_prefix("REPORT_FILE ") {
            summary.report = Some(rest.trim().to_string());
        } else if let Some(rest) = line.strip_prefix("SUMMARY ") {
            for pair in rest.split_whitespace() {
                let (key, value) = pair.split_once('=').unwrap_or((pair, ""));
                let value = value.parse::<u32>().unwrap_or(0);
                match key {
                    "GRANTED" => summary.granted = value,
                    "FIXED" => summary.fixed = value,
                    "REFUSED" => summary.refused = value,
                    "RESTORED" => summary.restored = value,
                    _ => {}
                }
            }
        }
    }
    summary
}

/// 从 `RECAP {json}` 行提取 refusals（修复被拒的路径与原因；失败消息用）。
pub(crate) fn parse_recap_refusals(stdout: &str) -> Vec<String> {
    let Some(line) = stdout.lines().rev().find(|line| line.starts_with("RECAP ")) else {
        return Vec::new();
    };
    let Ok(value) = serde_json::from_str::<serde_json::Value>(line["RECAP ".len()..].trim()) else {
        return Vec::new();
    };
    value
        .get("refusals")
        .and_then(|v| v.as_array())
        .map(|items| {
            items
                .iter()
                .map(|item| {
                    let path = item.get("path").and_then(|v| v.as_str()).unwrap_or("?");
                    let reason = item.get("reason").and_then(|v| v.as_str()).unwrap_or("未给出原因");
                    format!("{path}：{reason}")
                })
                .collect()
        })
        .unwrap_or_default()
}

/// 恢复命令落盘（`restore-command.txt`，每次修复覆盖——它对应的永远是「最近一次修复」）。
/// `warning` 非空时以注释行形式置于命令之前（不误当命令执行）。
pub(crate) fn write_restore_commands(
    dir: &Path,
    commands: &[String],
    warning: Option<&str>,
) -> Result<PathBuf, String> {
    if commands.is_empty() {
        return Err("没有恢复命令可写".to_string());
    }
    let file = dir.join("restore-command.txt");
    let mut text = String::from(
        "# WorldSea 工作区权限修复——恢复命令（撤销最近一次修复的权限改动；下一次修复会覆盖本文件）\n\
         # 在 PowerShell 或命令提示符中执行下面每一行（按出现顺序）：\n",
    );
    if let Some(warning) = warning {
        text.push_str("# ⚠ ");
        text.push_str(warning);
        text.push('\n');
    }
    text.push('\n');
    for command in commands {
        text.push_str(command);
        text.push_str("\r\n");
    }
    std::fs::write(&file, text).map_err(|e| format!("写入恢复命令文件失败（{}）：{e}", file.display()))?;
    Ok(file)
}

/// 兜底路径的恢复命令：撤销本次授权（移除该用户的显式授权项）。
/// **不用 icacls /restore**：本机四种变体实测均「处理 0 个文件」不生效（见文件头注与批计划）。
pub(crate) fn icacls_remove_line(workspace: &Path, user: &str) -> String {
    format!("icacls \"{}\" /remove:g \"{}\"", workspace.display(), user)
}

/// icacls 输出里是否已有该用户的**显式**授权项（决定 /remove:g 回滚是否精确、是否附警示）。
/// 判据：`<用户>:` 出现其后第一个标志不是 `(I`（继承项形如 `user:(I)(M)`；首行 ACE 前可能带目录名）。
pub(crate) fn has_explicit_user_ace(icacls_output: &str, user: &str) -> bool {
    let needle = format!("{}:", user.to_lowercase());
    icacls_output.lines().any(|line| {
        let lowered = line.to_lowercase();
        lowered.match_indices(&needle).any(|(at, _)| {
            !lowered[at + needle.len()..].starts_with("(i")
        })
    })
}

/// 上游脚本路径（dsh 树内；树未就绪或脚本挪位 → None → 降级兜底）。
fn upstream_script_path() -> Option<PathBuf> {
    let root = crate::dsh_shell::resolve_dsh_root().ok()?;
    let script = root.join(UPSTREAM_SCRIPT_REL);
    script.is_file().then_some(script)
}

/// 主路径尝试结果：Unavailable = pwsh/脚本不在（降级兜底）；Done = 脚本真跑了（其结论为准）。
enum UpstreamAttempt {
    Unavailable(String),
    Done(Result<String, String>),
}

/// G3：可回滚修复入口（横幅按钮与「设置 → 修复工作区权限…」菜单共用；只有用户显式点击才走到这里）。
pub(crate) fn fix_workspace_permissions(app: &tauri::AppHandle) -> Result<FixOutcome, String> {
    let workspace = crate::dsh_workspace::resolve_workspace(app)?;
    let recovery_dir = workspace.join(RECOVERY_DIR);
    std::fs::create_dir_all(&recovery_dir)
        .map_err(|e| format!("创建恢复产物目录失败（{}）：{e}", recovery_dir.display()))?;
    let (mode, note) = match try_upstream_script(&workspace, &recovery_dir) {
        UpstreamAttempt::Done(result) => ("pwsh", result?),
        UpstreamAttempt::Unavailable(reason) => {
            println!("[DSH-SHELL] acl-fix: 上游脚本不可用（{reason}）→ 降级 icacls 可回滚兜底");
            ("icacls", icacls_fallback(&workspace, &recovery_dir)?)
        }
    };
    let probe = workspace_probe::check(&workspace);
    println!(
        "[DSH-SHELL] acl-fix: mode={mode} recovery={} probe={}",
        recovery_dir.display(),
        probe.label()
    );
    Ok(FixOutcome {
        mode,
        label: probe.label().to_string(),
        recovery_dir: recovery_dir.display().to_string(),
        note,
    })
}

/// 主路径：跑上游脚本并组装回执（失败/超时给可读消息；成功给恢复指引）。
fn try_upstream_script(workspace: &Path, recovery_dir: &Path) -> UpstreamAttempt {
    let Some(script) = upstream_script_path() else {
        return UpstreamAttempt::Unavailable("脚本不在 dsh 树（树未就绪或追版挪位）".to_string());
    };
    let mut child = match {
        // 注意：let 绑定 Command 值本身再逐个 arg()——链式绑定会让 cmd 变成指向临时值的引用（E0716）
        let mut cmd = Command::new("pwsh");
        cmd.arg("-NoProfile")
            .arg("-NonInteractive")
            .arg("-ExecutionPolicy")
            .arg("Bypass")
            .arg("-File")
            .arg(&script)
            .arg("-Path")
            .arg(workspace)
            .arg("-AllowRoot")
            .arg(workspace)
            .arg("-Out")
            .arg(recovery_dir);
        // GUI 模式下 spawn pwsh 会闪控制台窗口
        crate::proc_quiet::hide_console(&mut cmd);
        cmd.stdout(Stdio::piped()).stderr(Stdio::piped()).spawn()
    } {
        Ok(child) => child,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return UpstreamAttempt::Unavailable("未安装 pwsh（PowerShell 7）".to_string())
        }
        Err(error) => return UpstreamAttempt::Done(Err(format!("启动 pwsh 失败：{error}"))),
    };
    let out_handle = child.stdout.take().map(|mut pipe| {
        std::thread::spawn(move || {
            let mut buffer = String::new();
            let _ = pipe.read_to_string(&mut buffer);
            buffer
        })
    });
    let err_handle = child.stderr.take().map(|mut pipe| {
        std::thread::spawn(move || {
            let mut buffer = String::new();
            let _ = pipe.read_to_string(&mut buffer);
            buffer
        })
    });
    let start = Instant::now();
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break Some(status),
            Ok(None) => {
                if start.elapsed() > PWSH_TIMEOUT {
                    let _ = child.kill();
                    let _ = child.wait();
                    break None;
                }
                std::thread::sleep(POLL_INTERVAL);
            }
            Err(error) => return UpstreamAttempt::Done(Err(format!("等待 pwsh 结束失败：{error}"))),
        }
    };
    let stdout = out_handle.map(|handle| handle.join().unwrap_or_default()).unwrap_or_default();
    let stderr = err_handle.map(|handle| handle.join().unwrap_or_default()).unwrap_or_default();
    let Some(status) = status else {
        return UpstreamAttempt::Done(Err(format!(
            "上游脚本超时（超过 {} 秒）已终止——超时前可能已完成部分修改，请查看 {} 的报告与备份",
            PWSH_TIMEOUT.as_secs(),
            recovery_dir.display()
        )));
    };
    let summary = parse_script_stdout(&stdout);
    for command in &summary.rollbacks {
        println!("[DSH-SHELL] acl-fix: rollback: {command}");
    }
    let rollback_file = write_restore_commands(recovery_dir, &summary.rollbacks, None).ok();
    if !status.success() {
        let refusals = parse_recap_refusals(&stdout);
        let mut message = format!(
            "上游脚本未完成修复（退出码 {:?}）",
            status.code()
        );
        if let Some(first) = refusals.first() {
            message += &format!("；首条拒绝：{first}");
        }
        if let Some(report) = &summary.report {
            message += &format!("；报告：{report}");
        }
        let tail = stderr.trim().lines().last().unwrap_or("").trim();
        if !tail.is_empty() {
            message += &format!("；stderr：{}", tail.chars().take(160).collect::<String>());
        }
        return UpstreamAttempt::Done(Err(message));
    }
    let mut note = if summary.granted + summary.fixed > 0 {
        format!("已备份并修复（授权 {} 处；改动 {} 处）。", summary.granted, summary.fixed)
    } else {
        "上游脚本未发现需要修复的项（授权 0 处）。".to_string()
    };
    if let Some(file) = rollback_file {
        note += &format!("恢复命令见 {}。", file.display());
    } else if !summary.rollbacks.is_empty() {
        note += &format!("恢复命令见 {}（及应用日志 [DSH-SHELL] 的 acl-fix 行）。", recovery_dir.display());
    }
    note += "若命令仍报沙箱初始化失败，请重启应用后重试；完整过程见应用日志。";
    UpstreamAttempt::Done(Ok(note))
}

/// 兜底：icacls 可回滚路径（修复前留 SDDL 存档 → 前检已有显式项 → /grant → 回滚命令 /remove:g 落盘）。
fn icacls_fallback(workspace: &Path, recovery_dir: &Path) -> Result<String, String> {
    let user = workspace_probe::current_user();
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.as_millis())
        .unwrap_or(0);
    // 修复前留档（SDDL 原文；/restore 本机不可用，此文件供人工核对与资产管理工具恢复）
    let pre_state = recovery_dir.join(format!("icacls-pre-state-{stamp}.txt"));
    let save = {
        let mut cmd = Command::new("icacls");
        cmd.arg(workspace).arg("/save").arg(&pre_state);
        crate::proc_quiet::hide_console(&mut cmd);
        cmd.output()
            .map_err(|e| format!("调用 icacls（/save）失败：{e}"))?
    };
    if !save.status.success() {
        return Err(format!(
            "icacls /save 失败（{}）：{}",
            save.status,
            String::from_utf8_lossy(&save.stderr).trim()
        ));
    }
    // 前检：已有该用户的显式授权项时，/remove:g 会连带移除它们 → 恢复命令文件附警示
    let listing = {
        let mut cmd = Command::new("icacls");
        cmd.arg(workspace);
        crate::proc_quiet::hide_console(&mut cmd);
        cmd.output()
            .map_err(|e| format!("调用 icacls（读取当前 ACL）失败：{e}"))?
    };
    let had_explicit = has_explicit_user_ace(&String::from_utf8_lossy(&listing.stdout), &user);
    let grant = {
        let mut cmd = Command::new("icacls");
        cmd.arg(workspace).arg("/grant").arg(format!("{user}:(OI)(CI)F"));
        crate::proc_quiet::hide_console(&mut cmd);
        cmd.output()
            .map_err(|e| format!("调用 icacls（/grant）失败：{e}"))?
    };
    if !grant.status.success() {
        return Err(format!(
            "icacls /grant 失败（{}）：{}",
            grant.status,
            String::from_utf8_lossy(&grant.stderr).trim()
        ));
    }
    let remove_line = icacls_remove_line(workspace, &user);
    let warning = had_explicit.then_some(
        "修复前该目录已有该用户的显式权限项——上面的 /remove:g 会把它们一并移除；\
         原状记录见同目录 icacls-pre-state 文件，请人工核对后再执行。",
    );
    let file = write_restore_commands(recovery_dir, std::slice::from_ref(&remove_line), warning)?;
    println!("[DSH-SHELL] acl-fix: rollback: {remove_line}");
    Ok(format!(
        "已备份并授权（icacls 兜底）。恢复命令见 {}（撤销本次授权；修复前状态存档在同目录 icacls-pre-state 文件）；\
         若命令仍报沙箱初始化失败，请重启应用后重试；完整过程见应用日志。",
        file.display()
    ))
}

#[cfg(test)]
#[path = "acl_fix_tests.rs"]
mod tests;
