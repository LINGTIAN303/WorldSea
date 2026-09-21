//! 环境变量清洗（E1 · 2026-09-18 工作区与环境对齐 dsh）
//!
//! 详见 docs/plans/2026-09-18-工作区与环境对齐dsh/02-对照与建议清单.md §3.2 E1
//!
//! # 背景
//! 子进程（命令执行 / PTY 会话 / MCP stdio）默认继承主进程全部环境变量，
//! 其中 API Key / Token 等敏感变量会被 Agent 命令或第三方进程读到。
//! 本模块提供**全仓统一判定口径**（对齐 dsh `scrubbedParentEnv()`）：
//! 键名含 `KEY` / `PASSWORD` / `SECRET` / `TOKEN` 子串（大小写不敏感）即视为敏感。
//!
//! # 约束
//! - 只按名判定、不读值；各 spawn 站点在继承环境上剔除命中键。
//! - 显式注入（工具 `env` 参数 / 调用方显式 set）在清洗**之后**执行——
//!   调用方显式传入的键不受影响（与 dsh「显式 env 清洗后合并」同语义）。
//! - 已知局限（与 dsh 同源）：`*PASSPHRASE*` 等不含四个标记的变量不在覆盖内。

/// 敏感标记：键名含任一子串（大小写不敏感）即命中
const SENSITIVE_MARKERS: [&str; 4] = ["KEY", "PASSWORD", "SECRET", "TOKEN"];

/// 判断环境变量名是否敏感（键名含 KEY / PASSWORD / SECRET / TOKEN 子串，大小写不敏感）
pub fn is_sensitive_env_key(key: &str) -> bool {
    let upper = key.to_ascii_uppercase();
    SENSITIVE_MARKERS.iter().any(|m| upper.contains(m))
}

/// 收集当前进程中应被剔除的敏感环境变量名（供各 spawn 站点遍历 `env_remove`）
///
/// 非 UTF-8 键名跳过（无法做子串判定；实际环境中极其罕见）。
pub fn sensitive_inherited_env_keys() -> Vec<String> {
    std::env::vars_os()
        .filter_map(|(k, _)| k.into_string().ok())
        .filter(|k| is_sensitive_env_key(k))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn markers_case_insensitive() {
        assert!(is_sensitive_env_key("OPENAI_API_KEY"));
        assert!(is_sensitive_env_key("openai_api_key"));
        assert!(is_sensitive_env_key("My_Password"));
        assert!(is_sensitive_env_key("db_secret"));
        assert!(is_sensitive_env_key("github_token"));
    }

    /// E1 迁移前 terminal 的 15 项显式名单——启发式必须全覆盖（回归锚点：
    /// 口径升级不得让任何原受保护变量脱保）
    #[test]
    fn legacy_explicit_list_all_covered() {
        for key in [
            "AWS_ACCESS_KEY_ID",
            "AWS_SECRET_ACCESS_KEY",
            "AWS_SESSION_TOKEN",
            "GH_TOKEN",
            "GITHUB_TOKEN",
            "OPENAI_API_KEY",
            "ANTHROPIC_API_KEY",
            "ANTHROPIC_AUTH_TOKEN",
            "DEEPSEEK_API_KEY",
            "AZURE_OPENAI_API_KEY",
            "GOOGLE_API_KEY",
            "GEMINI_API_KEY",
            "HUGGING_FACE_HUB_TOKEN",
            "HF_TOKEN",
            "REPLICATE_API_TOKEN",
        ] {
            assert!(is_sensitive_env_key(key), "{key} 应判为敏感（原名单成员）");
        }
    }

    /// 运行必需变量不得被误伤（剔除后命令/PTY 仍须可用）
    #[test]
    fn runtime_keys_not_matched() {
        for key in [
            "PATH",
            "PATHEXT",
            "SystemRoot",
            "ComSpec",
            "USERPROFILE",
            "HOME",
            "TEMP",
            "TMP",
            "SHELL",
            "SSH_AUTH_SOCK",
            "GIT_ASKPASS",
            "NODE_PATH",
            "WORLDSEA_HOME",
        ] {
            assert!(!is_sensitive_env_key(key), "{key} 不应判为敏感");
        }
    }

    #[test]
    fn empty_key_not_matched() {
        assert!(!is_sensitive_env_key(""));
    }
}