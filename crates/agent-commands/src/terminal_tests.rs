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
