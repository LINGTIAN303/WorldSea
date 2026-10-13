# acl_fix — 可回滚的工作区权限修复

> 源文件：`apps/tauri/src-tauri/src/acl_fix.rs`

## 口径（用户 2026-10-01 拍板）

① 主路径 = 上游 rc.2 的 `diagnose-windows-sandbox-acl` 脚本（pwsh；一次运行完成诊断 + 修复：
祖先链 WRITE_DAC/WRITE_OWNER 缺失一并修、显式 AppContainer 包 ACE 清理、每处改动先备份后
复核、失败自动回滚、产出独立恢复脚本与 ROLLBACK 命令）；pwsh 或脚本不可用时落日志并降级 ②。

② 兜底 = icacls 路线（裸 Windows 可用），同样升级为可回滚：/save 留「修复前 SDDL 存档」→ /grant →
回滚命令 `icacls /remove:g <用户>` 落盘。**为何不用 /save→/restore**：本机实测四种变体
（同 CWD / 盘根 CWD / 绝对路径改写 / 无扩展名文件）下 /restore 均「处理 0 个文件」不生效
（2026-10-01 受控实验；/remove:g 同场实测可用）——存档仍留（供人工核对），回滚以 /remove:g 为准；
修复前若已有该用户的显式授权项，命令文件会附警示（/remove:g 会把它们一并移除）。

③ 恢复产物一律 `<工作区>/.acl-recovery/`；恢复由用户执行 `restore-command.txt` 里的命令
（不做壳内一键回滚——对齐上游立场）。

④ 上游脚本真跑了就以其结论为准：失败**不**回退 icacls（它的拒绝/中止是安全判定，绕过即错）。

## 上游输出面（真机采样，见 docs/plans/2026-10-01-G3-可回滚工作区修复批计划.md §二）

尾部为 `RECAP {json}` / `REPORT_FILE <path>` / `SUMMARY FIXED=.. GRANTED=.. REFUSED=.. RESTORED=..`；
每处改动逐条打印 `ROLLBACK <cmd>`，备份为 `<恢复目录>/acl-backup-<id>.json` 与其 `.ps1`。
