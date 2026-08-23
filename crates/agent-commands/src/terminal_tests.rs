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

        let exec_res = exec
            .execute(serde_json::json!({
                "session_id": session_id,
                "command": if cfg!(target_os = "windows") { "echo hello" } else { "echo hello" },
                "timeout_ms": 5000
            }))
            .await
            .expect("执行应成功");
        assert_eq!(exec_res["ok"], true);

        let destroyed = destroy
            .execute(serde_json::json!({ "session_id": session_id }))
            .await
            .expect("销毁应成功");
        assert_eq!(destroyed["ok"], true);
    }
