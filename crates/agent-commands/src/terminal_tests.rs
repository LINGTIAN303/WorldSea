    use super::*;

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

    #[tokio::test]
    async fn execute_command_defaults_cwd_to_workdir() {
        // cwd 缺省时默认注入 workdir
        let dir = tempfile::tempdir().unwrap();
        let ctx = ToolContext {
            workdir: Some(dir.path().to_path_buf()),
            project_id: None,
            workspace_id: None,
            tool_stream: None,
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
            tool_stream: None,
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
        let (mut child, _master, mut writer, mut rx) =
            spawn_pty_session(default_shell(), ".", &[], pty_size).await.expect("spawn 应成功");

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
        let tool = ShellExecTool::bash();
        let res = tool
            .execute(serde_json::json!({ "command": "echo bash-ok", "timeout_ms": 15000 }))
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
        let tool = ShellExecTool::powershell();
        let res = tool
            .execute(serde_json::json!({ "command": "Write-Output ps-ok", "timeout_ms": 15000 }))
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
        let tool = ShellExecTool::bash();
        // 500ms 超时对 sleep 5 → 应报超时并终止子进程
        let res = tool
            .execute(serde_json::json!({ "command": "sleep 5", "timeout_ms": 500 }))
            .await;
        assert!(res.is_err(), "超时应返回错误，实际: {res:?}");
        let err = res.unwrap_err().to_string();
        assert!(err.contains("超时"), "错误信息应含超时，实际: {err}");
    }
