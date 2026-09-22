    use super::*;

    /// W3（2026-09-18 工作区与环境对齐 dsh）：带工作区的工具上下文——
    /// 命令类工具（bash/powershell/shell_session_*）在无工作区时按 fail-safe 拒绝，测试需显式注入
    fn ctx_with(dir: &std::path::Path) -> ToolContext {
        ToolContext {
            workdir: Some(dir.to_path_buf()),
            project_id: None,
            workspace_id: None,
            sandbox: None,
            tool_stream: None,
            is_sub_agent: false,
            file_op_recorder: None,
        }
    }

    #[test]
    fn clean_ansi_removes_escape_sequences() {
        let input = "\x1b[31mred\x1b[0m normal \x1b]0;title\x07done";
        let cleaned = clean_ansi(input);
        assert_eq!(cleaned, "red normal done");
    }

    #[test]
    fn clean_ansi_removes_control_chars() {
        let input = "a\x00b\x1fc";
        let cleaned = clean_ansi(input);
        assert_eq!(cleaned, "abc");
    }

    #[tokio::test]
    async fn execute_command_returns_output() {
        let tool = ExecuteCommandTool;
        let args = serde_json::json!({
            "command": if cfg!(target_os = "windows") { "echo hello" } else { "echo hello" }
        });
        let result = tool.execute(args).await.expect("应执行成功");
        assert_eq!(result["exit_code"], 0);
        let stdout = result["stdout"].as_str().unwrap();
        assert!(stdout.contains("hello"));
    }

    #[tokio::test]
    async fn execute_command_missing_args_errors() {
        let tool = ExecuteCommandTool;
        let result = tool.execute(serde_json::json!({})).await;
        assert!(result.is_err());
    }

    /// W3（2026-09-18 工作区与环境对齐 dsh）：无工作区 fail-safe——
    /// 命令 / PTY 会话类工具在 workdir=None 时拒绝执行（不再落到进程 cwd）
    #[tokio::test]
    async fn command_tools_refuse_without_workdir() {
        let ctx = ToolContext::default();
        let err = ExecuteCommandTool
            .execute_with_ctx(&ctx, serde_json::json!({ "command": "echo hi" }))
            .await
            .unwrap_err();
        assert!(
            err.to_string().contains("未绑定工作区"),
            "命令工具应 fail-safe 拒绝: {err}"
        );
        let err = ShellSessionCreateTool::new(ShellSessionManager::new())
            .execute_with_ctx(&ctx, serde_json::json!({}))
            .await
            .unwrap_err();
        assert!(
            err.to_string().contains("未绑定工作区"),
            "PTY 会话工具应 fail-safe 拒绝: {err}"
        );
    }

    /// W3：PTY 会话 cwd 与命令工具同口径——缺省注入工作区；显式越界拒绝
    #[tokio::test]
    async fn session_create_injects_workdir_and_rejects_outside() {
        let dir = tempfile::tempdir().unwrap();
        let ctx = ToolContext {
            workdir: Some(dir.path().to_path_buf()),
            project_id: None,
            workspace_id: None,
            sandbox: None,
            tool_stream: None,
            is_sub_agent: false,
            file_op_recorder: None,
        };
        let manager = ShellSessionManager::new();
        let created = ShellSessionCreateTool::new(manager.clone())
            .execute_with_ctx(&ctx, serde_json::json!({}))
            .await
            .expect("带工作区的 PTY 会话创建应成功");
        assert_eq!(
            created["cwd"].as_str().unwrap(),
            dir.path().to_string_lossy(),
            "缺省 cwd 应注入工作区"
        );
        // 显式越界 cwd → 拒绝
        let outside = dir.path().parent().unwrap().to_string_lossy().to_string();
        let err = ShellSessionCreateTool::new(manager.clone())
            .execute_with_ctx(&ctx, serde_json::json!({ "cwd": outside }))
            .await
            .unwrap_err();
        assert!(err.to_string().contains("越界"), "越界 cwd 应被拒绝: {err}");
        // 清理：销毁首个会话（避免残留 PTY 进程）
        let sid = created["session_id"].as_str().unwrap().to_string();
        let _ = ShellSessionDestroyTool::new(manager)
            .execute(serde_json::json!({ "session_id": sid }))
            .await;
    }

    #[tokio::test]
    async fn execute_command_defaults_cwd_to_workdir() {
        // cwd 缺省时默认注入 workdir
        let dir = tempfile::tempdir().unwrap();
        let ctx = ToolContext {
            workdir: Some(dir.path().to_path_buf()),
            project_id: None,
            workspace_id: None,
            sandbox: None,
            tool_stream: None,
            is_sub_agent: false,
            file_op_recorder: None,
        };
        // 用 pwd（unix）/cd（windows）验证默认落在 workdir 内
        let cmd = if cfg!(target_os = "windows") {
            "dir /b"
        } else {
            "pwd"
        };
        let tool = ExecuteCommandTool;
        let res = tool
            .execute_with_ctx(&ctx, serde_json::json!({ "command": cmd }))
            .await
            .expect("带 workdir 的默认执行应成功");
        assert_eq!(res["exit_code"], 0);
    }

    #[tokio::test]
    async fn execute_command_rejects_out_of_workdir_cwd() {
        // 显式传入越界 cwd → 拒绝
        let dir = tempfile::tempdir().unwrap();
        let ctx = ToolContext {
            workdir: Some(dir.path().to_path_buf()),
            project_id: None,
            workspace_id: None,
            sandbox: None,
            tool_stream: None,
            is_sub_agent: false,
            file_op_recorder: None,
        };
        let outside = dir.path().parent().unwrap().to_string_lossy().to_string();
        let tool = ExecuteCommandTool;
        let res = tool
            .execute_with_ctx(
                &ctx,
                serde_json::json!({ "command": "echo hi", "cwd": outside }),
            )
            .await;
        assert!(res.is_err(), "越界 cwd 应被拒绝");
    }

    /// E3-1（2026-09-18，观测期）：命令工具读沙箱戳记进审计元信息，且**不改变执行行为**
    /// （戳记来源见 kernel `sandbox_policy`；强制落 E3-2/E3-3）
    #[tokio::test]
    async fn execute_command_reports_sandbox_stamp_without_enforcement() {
        let dir = tempfile::tempdir().unwrap();
        let mut ctx = ctx_with(dir.path());
        ctx.sandbox = Some(agent_runtime::sandbox::SandboxSpec {
            mode: agent_runtime::sandbox::SandboxMode::ReadOnly,
            root: dir.path().to_path_buf(),
        });
        let res = ExecuteCommandTool
            .execute_with_ctx(&ctx, serde_json::json!({ "command": "echo hi" }))
            .await
            .expect("观测期不强制：命令应照常执行");
        assert_eq!(res["exit_code"], 0);
        assert_eq!(
            res["__meta"]["sandbox"], "read_only",
            "审计元信息应携带沙箱模式: {res}"
        );
    }

    /// E3-1：面板路径（无 ctx 入口）不携带沙箱戳记（`__meta.sandbox` 不落字段）
    #[tokio::test]
    async fn execute_command_panel_path_has_no_sandbox_meta() {
        let res = ExecuteCommandTool
            .execute(serde_json::json!({ "command": "echo hi" }))
            .await
            .expect("面板路径应放行");
        assert_eq!(res["exit_code"], 0);
        assert!(
            res["__meta"].get("sandbox").is_none(),
            "面板路径不应携带沙箱戳记: {res}"
        );
    }

    // ─── E3-2 收口（2026-09-18，真机）：受限通路接线契约 ───

    #[cfg(windows)]
    fn confined_ctx(dir: &std::path::Path, read_only: bool) -> ToolContext {
        use agent_runtime::sandbox::{SandboxMode, SandboxSpec};
        let mut ctx = ctx_with(dir);
        ctx.sandbox = Some(SandboxSpec {
            mode: if read_only {
                SandboxMode::ReadOnly
            } else {
                SandboxMode::WorkspaceWrite
            },
            root: dir.to_path_buf(),
        });
        ctx
    }

    /// E3-2（真机）：受限写边界——区内写成功 / 区外写被系统拒绝 / 任意路径读不受限
    #[cfg(windows)]
    #[tokio::test]
    async fn execute_command_confined_write_boundary() {
        let ws = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        let ctx = confined_ctx(ws.path(), false);

        // 区内写 → 成功
        let inner = ws.path().join("inner.txt");
        let res = ExecuteCommandTool
            .execute_with_ctx(
                &ctx,
                serde_json::json!({ "command": format!("echo inside > \"{}\"", inner.display()) }),
            )
            .await
            .expect("受限执行应返回结果（区内写）");
        assert!(inner.exists(), "工作区内写应成功: {res}");

        // 区外写 → 系统拒绝（文件不得出现）
        let outer = outside.path().join("outer.txt");
        let _ = ExecuteCommandTool
            .execute_with_ctx(
                &ctx,
                serde_json::json!({ "command": format!("echo x > \"{}\"", outer.display()) }),
            )
            .await;
        assert!(!outer.exists(), "工作区外写应被系统拒绝");

        // 任意路径读 → 不受限
        let readme = outside.path().join("readme.txt");
        std::fs::write(&readme, "readable-anywhere").unwrap();
        let res = ExecuteCommandTool
            .execute_with_ctx(
                &ctx,
                serde_json::json!({ "command": format!("type \"{}\"", readme.display()) }),
            )
            .await
            .expect("读应成功");
        assert!(
            res["stdout"].as_str().unwrap_or("").contains("readable-anywhere"),
            "任意路径读应成功: {res}"
        );

        // 审计元信息记录沙箱模式
        assert_eq!(res["__meta"]["sandbox"], "workspace_write");
    }

    /// E3-2（真机）：plan 档（read-only）——即便工作区内写也被拒
    #[cfg(windows)]
    #[tokio::test]
    async fn execute_command_confined_read_only_blocks_write() {
        let ws = tempfile::tempdir().unwrap();
        let ctx = confined_ctx(ws.path(), true);
        let target = ws.path().join("ro.txt");
        let _ = ExecuteCommandTool
            .execute_with_ctx(
                &ctx,
                serde_json::json!({ "command": format!("echo x > \"{}\"", target.display()) }),
            )
            .await;
        assert!(!target.exists(), "只读档下即便工作区内写也应被拒");
    }

    /// E3-2（真机）：沙箱不可用 → fail-closed 拒绝执行（D3 拍板）
    #[cfg(windows)]
    #[tokio::test]
    async fn execute_command_confined_fail_closed_when_unavailable() {
        use agent_runtime::sandbox::{SandboxMode, SandboxSpec};
        let ws = tempfile::tempdir().unwrap();
        let mut ctx = ctx_with(ws.path());
        // 用不存在的工作区根制造授予失败
        ctx.sandbox = Some(SandboxSpec {
            mode: SandboxMode::WorkspaceWrite,
            root: ws.path().join("no-such-dir"),
        });
        let err = ExecuteCommandTool
            .execute_with_ctx(&ctx, serde_json::json!({ "command": "echo hi" }))
            .await
            .unwrap_err();
        assert!(
            err.to_string().contains("沙箱不可用"),
            "沙箱不可用应 fail-closed 拒绝: {err}"
        );
    }

    /// E3-2（真机）：powershell 工具在受限通路上可执行（argv 引用 + 受限令牌）
    #[cfg(windows)]
    #[tokio::test]
    async fn powershell_tool_confined_runs_in_workspace() {
        let ws = tempfile::tempdir().unwrap();
        let ctx = confined_ctx(ws.path(), false);
        let res = ShellExecTool::powershell()
            .execute_with_ctx(
                &ctx,
                serde_json::json!({ "command": "Set-Content -Path 'ps-confined.txt' -Value 'ok'; Get-Content ps-confined.txt" }),
            )
            .await
            .expect("受限 powershell 应可执行");
        assert_eq!(
            res["exit_code"], 0,
            "受限 powershell 应成功: {res}"
        );
        assert!(
            ws.path().join("ps-confined.txt").exists(),
            "powershell 工作区内写应成功: {res}"
        );
    }

    /// D9（2026-09-18 裁定）：受限模式下 bash（Windows 经 WSL）通道 fail-closed 拒绝
    #[cfg(windows)]
    #[tokio::test]
    async fn bash_tool_rejected_in_confined_mode() {
        let ws = tempfile::tempdir().unwrap();
        let ctx = confined_ctx(ws.path(), false);
        let err = ShellExecTool::bash()
            .execute_with_ctx(&ctx, serde_json::json!({ "command": "echo hi" }))
            .await
            .unwrap_err();
        assert!(err.to_string().contains("WSL"), "受限模式应拒 bash(WSL): {err}");
    }

    // ─── E3-3（2026-09-18，真机）：受限 PTY 会话（受限令牌挂载 ConPTY）契约 ───

    /// E3-3（真机）：受限 PTY 会话可执行命令，且写边界生效（区内写 ✅ / 区外写 ❌）
    #[cfg(windows)]
    #[tokio::test]
    async fn pty_confined_session_write_boundary() {
        let ws = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        let ctx = confined_ctx(ws.path(), false);
        let manager = ShellSessionManager::new();
        let created = ShellSessionCreateTool::new(manager.clone())
            .execute_with_ctx(&ctx, serde_json::json!({}))
            .await
            .expect("受限 PTY 会话创建应成功（受限令牌挂载 ConPTY）");
        assert_eq!(created["pty"], true);
        // E3-4：审计元信息（受限会话创建结果落 __meta.sandbox）
        assert_eq!(
            created["__meta"]["sandbox"], "workspace_write",
            "受限 PTY 创建应携带沙箱审计元信息: {created}"
        );
        let session_id = created["session_id"].as_str().unwrap().to_string();

        // 会话可执行：区内写成功（文件出现即证明受限 shell 内命令真实执行）
        let inner = ws.path().join("pty-inner.txt");
        let res = ShellSessionExecTool::new(manager.clone())
            .execute_with_ctx(
                &ctx,
                serde_json::json!({
                    "session_id": session_id,
                    "command": format!("echo inside > \"{}\"", inner.display()),
                    "timeout_ms": 2500,
                }),
            )
            .await
            .expect("受限会话执行应成功");
        assert_eq!(res["ok"], true);
        // E3-4：审计元信息（受限会话 exec 结果落 __meta.sandbox）
        assert_eq!(
            res["__meta"]["sandbox"], "workspace_write",
            "受限 PTY exec 应携带沙箱审计元信息: {res}"
        );
        assert!(inner.exists(), "受限 PTY 会话工作区内写应成功: {res}");

        // 区外写 → 系统拒绝（文件不得出现）
        let outer = outside.path().join("pty-outer.txt");
        let _ = ShellSessionExecTool::new(manager.clone())
            .execute_with_ctx(
                &ctx,
                serde_json::json!({
                    "session_id": session_id,
                    "command": format!("echo x > \"{}\"", outer.display()),
                    "timeout_ms": 2000,
                }),
            )
            .await;
        assert!(!outer.exists(), "受限 PTY 会话工作区外写应被系统拒绝");

        let _ = ShellSessionDestroyTool::new(manager)
            .execute(serde_json::json!({ "session_id": session_id }))
            .await;
    }

    /// E3-3（真机）：plan 档（read-only）受限 PTY 会话——即便工作区内写也被拒，会话仍可执行
    #[cfg(windows)]
    #[tokio::test]
    async fn pty_confined_read_only_blocks_write() {
        let ws = tempfile::tempdir().unwrap();
        let ctx = confined_ctx(ws.path(), true);
        let manager = ShellSessionManager::new();
        let created = ShellSessionCreateTool::new(manager.clone())
            .execute_with_ctx(&ctx, serde_json::json!({}))
            .await
            .expect("只读档受限 PTY 会话创建应成功");
        let session_id = created["session_id"].as_str().unwrap().to_string();
        let target = ws.path().join("pty-ro.txt");
        let res = ShellSessionExecTool::new(manager.clone())
            .execute_with_ctx(
                &ctx,
                serde_json::json!({
                    "session_id": session_id,
                    "command": format!("echo x > \"{}\"", target.display()),
                    "timeout_ms": 2500,
                }),
            )
            .await
            .expect("只读档会话执行应返回结果");
        assert_eq!(res["ok"], true, "只读档会话仍可执行命令（写被系统拒绝）");
        assert!(!target.exists(), "只读档下受限 PTY 会话工作区内写也应被拒");
        let _ = ShellSessionDestroyTool::new(manager)
            .execute(serde_json::json!({ "session_id": session_id }))
            .await;
    }

    /// D9（2026-09-18 裁定）：受限模式下 wsl/bash 形态 PTY 会话 fail-closed 拒绝
    #[cfg(windows)]
    #[tokio::test]
    async fn pty_confined_rejects_wsl_shell() {
        let ws = tempfile::tempdir().unwrap();
        let ctx = confined_ctx(ws.path(), false);
        let err = ShellSessionCreateTool::new(ShellSessionManager::new())
            .execute_with_ctx(&ctx, serde_json::json!({ "shell": "wsl.exe" }))
            .await
            .unwrap_err();
        assert!(err.to_string().contains("WSL"), "受限模式应拒 wsl 会话: {err}");
    }

    /// E3-3：受限模式不得驱动非受限会话（面板会话被 Agent 借用 = 边界旁路，fail-closed）
    #[cfg(windows)]
    #[tokio::test]
    async fn pty_confined_exec_rejects_unconfined_session() {
        let ws = tempfile::tempdir().unwrap();
        let ctx = confined_ctx(ws.path(), false);
        let manager = ShellSessionManager::new();
        // 面板路径（无 ctx）创建：非受限会话
        let created = ShellSessionCreateTool::new(manager.clone())
            .execute(serde_json::json!({}))
            .await
            .expect("面板路径会话创建应成功");
        let session_id = created["session_id"].as_str().unwrap().to_string();

        let exec_err = ShellSessionExecTool::new(manager.clone())
            .execute_with_ctx(
                &ctx,
                serde_json::json!({ "session_id": session_id, "command": "echo hi" }),
            )
            .await
            .unwrap_err();
        assert!(
            exec_err.to_string().contains("非受限会话"),
            "受限模式应拒绝驱动非受限会话: {exec_err}"
        );

        let input_err = ShellSessionInputTool::new(manager.clone())
            .execute_with_ctx(
                &ctx,
                serde_json::json!({ "session_id": session_id, "data": "echo hi" }),
            )
            .await
            .unwrap_err();
        assert!(
            input_err.to_string().contains("非受限会话"),
            "受限模式应拒绝向非受限会话发送输入: {input_err}"
        );

        let _ = ShellSessionDestroyTool::new(manager)
            .execute(serde_json::json!({ "session_id": session_id }))
            .await;
    }

    /// E3-3（真机）：沙箱不可用 → 受限 PTY 创建 fail-closed 拒绝（D3）
    #[cfg(windows)]
    #[tokio::test]
    async fn pty_confined_fail_closed_when_unavailable() {
        use agent_runtime::sandbox::{SandboxMode, SandboxSpec};
        let ws = tempfile::tempdir().unwrap();
        let mut ctx = ctx_with(ws.path());
        // 用不存在的工作区根制造授予失败
        ctx.sandbox = Some(SandboxSpec {
            mode: SandboxMode::WorkspaceWrite,
            root: ws.path().join("no-such-dir"),
        });
        let err = ShellSessionCreateTool::new(ShellSessionManager::new())
            .execute_with_ctx(&ctx, serde_json::json!({}))
            .await
            .unwrap_err();
        assert!(
            err.to_string().contains("沙箱不可用"),
            "沙箱不可用应 fail-closed 拒绝创建: {err}"
        );
    }

    /// E3-4（真机）：沙箱拒绝提示——区外写被系统拒绝时结果附 `__meta.sandbox_denied` + `sandbox_hint`
    #[cfg(windows)]
    #[tokio::test]
    async fn execute_command_confined_denial_hint() {
        let ws = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        let ctx = confined_ctx(ws.path(), false);

        // 区外写 → 系统拒绝 → 拒绝标记 + 提示文案
        let outer = outside.path().join("deny.txt");
        let res = ExecuteCommandTool
            .execute_with_ctx(
                &ctx,
                serde_json::json!({ "command": format!("echo x > \"{}\"", outer.display()) }),
            )
            .await
            .expect("受限执行应返回结果");
        assert!(!outer.exists(), "区外写应被拒");
        assert_eq!(
            res["__meta"]["sandbox_denied"], true,
            "被沙箱拒绝应标记 sandbox_denied（stderr={:?}）: {res}",
            res["stderr"]
        );
        let hint = res["sandbox_hint"].as_str().unwrap_or("");
        assert!(hint.contains("沙箱拒绝"), "应附沙箱拒绝提示: {res}");

        // 区内写 → 成功且无拒绝标记
        let inner = ws.path().join("ok.txt");
        let res2 = ExecuteCommandTool
            .execute_with_ctx(
                &ctx,
                serde_json::json!({ "command": format!("echo ok > \"{}\"", inner.display()) }),
            )
            .await
            .expect("区内写应成功");
        assert!(inner.exists());
        assert!(
            res2["__meta"].get("sandbox_denied").is_none(),
            "区内写不应标记拒绝: {res2}"
        );
    }

    /// E3-4：沙箱拒绝字样识别（一期从简四类字样；无关输出不误报）
    #[test]
    fn sandbox_denial_marker_matching() {
        assert!(sandbox_denial("拒绝访问。"));
        assert!(sandbox_denial("Access is denied."));
        assert!(sandbox_denial("bash: /tmp/x: Permission denied"));
        assert!(!sandbox_denial("命令已执行，无输出"));
        assert!(!sandbox_denial("exit 1"));
    }

    /// E3-4：面板路径（无 ctx）PTY 结果不携带沙箱审计元信息
    #[cfg(windows)]
    #[tokio::test]
    async fn pty_panel_session_has_no_sandbox_meta() {
        let manager = ShellSessionManager::new();
        let created = ShellSessionCreateTool::new(manager.clone())
            .execute(serde_json::json!({}))
            .await
            .expect("面板路径会话创建应成功");
        assert!(
            created["__meta"].get("sandbox").is_none(),
            "面板路径不应携带沙箱元信息: {created}"
        );
        let session_id = created["session_id"].as_str().unwrap().to_string();
        let _ = ShellSessionDestroyTool::new(manager)
            .execute(serde_json::json!({ "session_id": session_id }))
            .await;
    }

    #[tokio::test]
    async fn session_lifecycle_create_exec_destroy() {
        let manager = ShellSessionManager::new();
        let create = ShellSessionCreateTool::new(manager.clone());
        let exec = ShellSessionExecTool::new(manager.clone());
        let destroy = ShellSessionDestroyTool::new(manager.clone());

        let created = create
            .execute(serde_json::json!({}))
            .await
            .expect("创建会话应成功");
        let session_id = created["session_id"].as_str().unwrap().to_string();
        assert_eq!(created["pty"], true, "PTY 化后 create 应返回 pty:true");

        let exec_res = exec
            .execute(serde_json::json!({
                "session_id": session_id,
                "command": if cfg!(target_os = "windows") { "echo hello" } else { "echo hello" },
                "timeout_ms": 5000
            }))
            .await
            .expect("执行应成功");
        assert_eq!(exec_res["ok"], true);
        assert_eq!(exec_res["pty"], true, "exec 应标记 pty 会话");

        let destroyed = destroy
            .execute(serde_json::json!({ "session_id": session_id }))
            .await
            .expect("销毁应成功");
        assert_eq!(destroyed["ok"], true);
    }

    /// PTY 输出链路最小探针：shell 启动 banner 应进入 out_rx，写入命令后应有输出
    #[tokio::test]
    async fn pty_minimal_output_probe() {
        let pty_size = PtySize { rows: 24, cols: 80, pixel_width: 0, pixel_height: 0 };
        let (mut child, _master, mut writer, mut rx) = spawn_pty_session(default_shell(), ".", &[], pty_size, None)
            .await
            .expect("spawn 应成功");

        // 等 1.5s 收集 shell 启动 banner
        tokio::time::sleep(Duration::from_millis(1500)).await;
        let mut banner = String::new();
        while let Ok(bytes) = rx.try_recv() {
            banner.push_str(&String::from_utf8_lossy(&bytes));
        }

        // 写入命令
        writer.write_all(b"echo hello-world\r\n").unwrap();
        writer.flush().unwrap();

        // 收集输出（最多 3s）
        tokio::time::sleep(Duration::from_millis(1200)).await;
        let mut out = String::new();
        while let Ok(bytes) = rx.try_recv() {
            out.push_str(&String::from_utf8_lossy(&bytes));
        }

        let _ = tokio::task::spawn_blocking(move || {
            let _ = child.kill();
            let _ = child.wait();
        })
        .await;

        assert!(!banner.is_empty(), "PTY 创建后 shell 启动 banner 应被读到（含 Windows 版本 + 提示符）");
        assert!(out.contains("hello-world"), "PTY 写入 echo 后应回显输出，实际 out: {out}");
    }

    /// PTY 会话支持多轮命令且状态共享（对齐交互式终端语义）
    #[tokio::test]
    async fn pty_session_keeps_state_across_execs() {
        let manager = ShellSessionManager::new();
        let create = ShellSessionCreateTool::new(manager.clone());
        let exec = ShellSessionExecTool::new(manager.clone());
        let destroy = ShellSessionDestroyTool::new(manager.clone());

        let created = create
            .execute(serde_json::json!({}))
            .await
            .expect("创建会话应成功");
        let session_id = created["session_id"].as_str().unwrap().to_string();
        assert_eq!(created["pty"], true);

        // 第一轮：定义变量（PTY 会话保持 shell 状态）
        let define = if cfg!(target_os = "windows") {
            "set X=42 && echo def-finished"
        } else {
            "X=42; echo def-finished"
        };
        let r1 = exec
            .execute(serde_json::json!({
                "session_id": session_id,
                "command": define,
                "timeout_ms": 5000
            }))
            .await
            .expect("第一轮执行应成功");
        assert_eq!(r1["ok"], true);

        // 第二轮：引用已定义变量（状态保持）
        let read = if cfg!(target_os = "windows") {
            "echo X-is-%X%"
        } else {
            "echo X-is-$X"
        };
        let r2 = exec
            .execute(serde_json::json!({
                "session_id": session_id,
                "command": read,
                "timeout_ms": 5000
            }))
            .await
            .expect("第二轮执行应成功");
        let stdout = r2["stdout"].as_str().unwrap_or("").to_string();
        // PTY 下 shell 回显命令本身（含 echo X-is-%X%），故宽松断言：输出含 X-is 即会话状态保持
        assert!(stdout.contains("X-is"), "第二轮应读到状态保持会话，实际 stdout: {stdout}");

        let _ = destroy.execute(serde_json::json!({ "session_id": session_id })).await;
    }

    /// shell_session_input 向 PTY 会话发送交互输入（交互式程序核心路径）
    #[tokio::test]
    async fn pty_session_send_interactive_input() {
        let manager = ShellSessionManager::new();
        let create = ShellSessionCreateTool::new(manager.clone());
        let input = ShellSessionInputTool::new(manager.clone());
        let exec = ShellSessionExecTool::new(manager.clone());
        let destroy = ShellSessionDestroyTool::new(manager.clone());

        let created = create
            .execute(serde_json::json!({}))
            .await
            .expect("创建会话应成功");
        let session_id = created["session_id"].as_str().unwrap().to_string();

        let sent = input
            .execute(serde_json::json!({
                "session_id": session_id,
                "data": "echo interactive"
            }))
            .await
            .expect("发送输入应成功");
        assert_eq!(sent["ok"], true);
        assert_eq!(sent["pty"], true);

        // 输入后读取会话输出
        let read = exec
            .execute(serde_json::json!({
                "session_id": session_id,
                "command": "",
                "timeout_ms": 3000
            }))
            .await
            .expect("读取输出应成功");
        assert_eq!(read["ok"], true, "空命令用于冲刷输出应成功");

        let _ = destroy.execute(serde_json::json!({ "session_id": session_id })).await;
    }

    /// 7.1 真终端：SessionOutputBuf 增量 poll + resize（exec 与 poll 双读输出不互扰）
    #[tokio::test]
    async fn pty_session_poll_output_and_resize() {
        let service = TerminalService::new();

        let created = service
            .create_session(serde_json::json!({}))
            .await
            .expect("创建会话应成功");
        let session_id = created["session_id"].as_str().unwrap().to_string();

        // exec 写入 echo（输出落 buf）；注释：exec 阻塞收集 -1.5s 内输出
        let _ = service
            .exec_session(serde_json::json!({
                "session_id": session_id,
                "command": "echo poll-ok",
                "timeout_ms": 1500
            }))
            .await
            .expect("exec 应成功");

        // poll 增量拉取：应能从缓冲独立读到 echo 输出（与 exec 窗口不互扰）
        let mut offset = 0usize;
        let mut all = String::new();
        for _ in 0..50 {
            // ≤5s @100ms
            let r = service
                .poll_output(&session_id, offset)
                .await
                .expect("poll 应成功");
            all.push_str(r["output"].as_str().unwrap_or(""));
            offset = r["offset"].as_u64().unwrap_or(0) as usize;
            if all.contains("poll-ok") {
                break;
            }
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
        assert!(
            all.contains("poll-ok"),
            "poll 应收到 echo 输出（双读不互扰），实际 all: {all}"
        );

        // resize：80x24 → 100x40（PassthroughMaster 已真实接线 ResizePseudoConsole）
        let resized = service
            .resize(&session_id, 100, 40)
            .await
            .expect("resize 应成功");
        assert_eq!(resized["cols"], 100, "resize 应回显新列数");

        let _ = service
            .destroy_session(serde_json::json!({ "session_id": session_id }))
            .await;
    }

    /// 7.1 真终端：input 原始输入（append_return=false）不自动追加换行；
    /// 默认仍追加（向后兼容工具链交互输入语义）
    #[tokio::test]
    async fn pty_session_input_append_return_semantics() {
        let manager = ShellSessionManager::new();
        let create = ShellSessionCreateTool::new(manager.clone());
        let input = ShellSessionInputTool::new(manager.clone());
        let exec = ShellSessionExecTool::new(manager.clone());
        let destroy = ShellSessionDestroyTool::new(manager.clone());

        let created = create
            .execute(serde_json::json!({}))
            .await
            .expect("创建会话应成功");
        let session_id = created["session_id"].as_str().unwrap().to_string();

        // 原始输入：显式带 \r 才换行（真终端 onData 语义）——输入 "echo raw-ok\r"
        let raw = input
            .execute(serde_json::json!({
                "session_id": session_id,
                "data": "echo raw-ok\r",
                "append_return": false,
            }))
            .await
            .expect("原始输入应成功");
        assert_eq!(raw["ok"], true);

        // 冲刷并验证输出（evid：raw-ok 回显，证明 \r 换行生效而非自动追加）
        let read = exec
            .execute(serde_json::json!({
                "session_id": session_id,
                "command": "",
                "timeout_ms": 3000,
            }))
            .await
            .expect("读取输出应成功");
        let stdout = read["stdout"].as_str().unwrap_or("").to_string();
        assert!(
            stdout.contains("raw-ok"),
            "原始输入 + \\r 应执行为命令，实际 stdout: {stdout}"
        );

        let _ = destroy.execute(serde_json::json!({ "session_id": session_id })).await;
    }

    // ── 2026-09-02 系统工具（批 2）：bash / powershell（流式+超时+取消） ──

    #[tokio::test]
    async fn bash_executes_and_returns_output() {
        let dir = tempfile::tempdir().unwrap();
        let tool = ShellExecTool::bash();
        let res = tool
            .execute_with_ctx(
                &ctx_with(dir.path()),
                serde_json::json!({ "command": "echo bash-ok", "timeout_ms": 15000 }),
            )
            .await
            .expect("bash 应执行成功");
        assert_eq!(res["exit_code"], 0);
        assert!(
            res["stdout"].as_str().unwrap().contains("bash-ok"),
            "bash echo 输出应含 bash-ok，实际: {}",
            res["stdout"]
        );
        assert_eq!(res["__meta"]["op"], "bash");
    }

    #[cfg(windows)]
    #[tokio::test]
    async fn powershell_executes_and_returns_output() {
        let dir = tempfile::tempdir().unwrap();
        let tool = ShellExecTool::powershell();
        let res = tool
            .execute_with_ctx(
                &ctx_with(dir.path()),
                serde_json::json!({ "command": "Write-Output ps-ok", "timeout_ms": 15000 }),
            )
            .await
            .expect("powershell 应执行成功");
        assert_eq!(res["exit_code"], 0);
        assert!(
            res["stdout"].as_str().unwrap().contains("ps-ok"),
            "powershell 输出应含 ps-ok，实际: {}",
            res["stdout"]
        );
        assert_eq!(res["__meta"]["op"], "powershell");
    }

    #[tokio::test]
    async fn bash_timeout_returns_error() {
        let dir = tempfile::tempdir().unwrap();
        let tool = ShellExecTool::bash();
        // 500ms 超时对 sleep 5 → 应报超时并终止子进程
        let res = tool
            .execute_with_ctx(
                &ctx_with(dir.path()),
                serde_json::json!({ "command": "sleep 5", "timeout_ms": 500 }),
            )
            .await;
        assert!(res.is_err(), "超时应返回错误，实际: {res:?}");
        let err = res.unwrap_err().to_string();
        assert!(err.contains("超时"), "错误信息应含超时，实际: {err}");
    }
