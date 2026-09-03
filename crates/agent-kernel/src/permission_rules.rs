//! 权限规则引擎 v1（方向3 P0，2026-09-03 拍板 v2）
//!
//! 规则模型：可学习白名单（Allow）+ 上锁名单（Lock，read/command/write 三维）+ 三档安全级别。
//! 优先级：`Lock（内置+用户，硬约束） > Allow（白名单，放行例外） > 档位默认策略`。
//!
//! - 内置锁（预置）：敏感目录（~/.ssh 等）与项目数据区（E1）沿既有硬判定实现，
//!   不进本表；本表为**用户可编辑**的白名单与上锁名单（持久化 JSON，app_data）。
//! - 三档：Plan（只读研究）/ Interact（默认交互确认）/ Autopilot（免逐条确认，
//!   白名单+锁兜底；名单外 Agent 自动判断为远期 P2，本版短路放行但锁仍生效）。
//!
//! 详细见 docs/details/注释/agent-kernel/permission_rules.md 与
//! docs/plans/2026-09-03-权限分级与沙箱耦合设计.md

use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard, OnceLock};

use serde::{Deserialize, Serialize};

use crate::tool_context::normalize_path;

// ─── 三档安全级别 ──────────────────────────────────────────

/// 安全档位（对齐设计 v2 三档光谱）
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SecurityLevel {
    /// 只读研究：写/命令工具一律拒绝（锁仍生效）
    Plan,
    /// 默认交互：按确认策略询问（含危险三键），拦截时可一键加入白名单
    Interact,
    /// 免逐条确认：白名单自动放行 + 锁自动拦截；名单外本轮放行（远期 Agent 判断）
    Autopilot,
}

impl Default for SecurityLevel {
    fn default() -> Self {
        SecurityLevel::Interact
    }
}

impl SecurityLevel {
    /// 按字符串解析（兼容旧档位值：off→autopilot，dangerous_only/moderate_and_dangerous→interact）
    pub fn parse(s: &str) -> Self {
        match s.to_ascii_lowercase().as_str() {
            "plan" => SecurityLevel::Plan,
            "autopilot" | "off" | "bypass" => SecurityLevel::Autopilot,
            // 默认桶：interact（dangerous_only / moderate_and_dangerous / 未知均归此）
            _ => SecurityLevel::Interact,
        }
    }

    pub fn as_str(&self) -> &'static str {
        match self {
            SecurityLevel::Plan => "plan",
            SecurityLevel::Interact => "interact",
            SecurityLevel::Autopilot => "autopilot",
        }
    }
}

// ─── 规则模型 ──────────────────────────────────────────────

/// 上锁规则：指定路径（目录或文件）的读写/命令维度可不可用
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LockRule {
    /// 归一化绝对路径（normalize_path 后）
    pub path: String,
    /// false = 不可读取
    pub read_ok: bool,
    /// false = 命令不可用（在该路径下执行命令被拦截，维度近似 command）
    pub command_ok: bool,
    /// false = 不可写（创建/修改/删除）
    pub write_ok: bool,
}

impl LockRule {
    pub fn max_lock(path: impl Into<String>) -> Self {
        Self {
            path: path.into(),
            read_ok: false,
            command_ok: false,
            write_ok: false,
        }
    }

    /// 默认锁：command/write 禁 + read 可（2026-09-03 拍板）
    pub fn default_lock(path: impl Into<String>) -> Self {
        Self {
            path: path.into(),
            read_ok: true,
            command_ok: false,
            write_ok: false,
        }
    }
}

/// 权限规则集（用户可编辑；进程级单例）
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct PermissionRules {
    /// 命令白名单（小写子串匹配，命中即放行；受锁覆盖）
    #[serde(default)]
    pub allow_commands: Vec<String>,
    /// 路径白名单（归一化绝对路径，命中即放行写入；受锁覆盖）
    #[serde(default)]
    pub allow_paths: Vec<String>,
    /// 上锁名单（用户自定义锁）
    #[serde(default)]
    pub locks: Vec<LockRule>,
}

impl PermissionRules {
    pub fn is_command_allowed(&self, cmd: &str) -> bool {
        let lower = cmd.to_ascii_lowercase();
        self.allow_commands.iter().any(|p| lower.contains(p))
    }

    /// 路径是否命中白名单（归一化后双向前缀匹配，覆盖目录/文件）
    pub fn is_path_allowed(&self, normalized: &Path) -> bool {
        self.allow_paths
            .iter()
            .any(|p| matches_path_prefix(p, normalized))
    }

    /// 返回命中用户锁（按 read/command/write 维度）的锁描述；未命中返回 None
    pub fn lock_description(&self, normalized: &Path) -> Option<String> {
        self.locks
            .iter()
            .filter(|l| matches_path_prefix(&l.path, normalized))
            .next()
            .map(|l| format!("上锁名单：{}（read={} command={} write={}）", l.path, l.read_ok, l.command_ok, l.write_ok))
    }

    /// 判断命令是否应被锁拦截（任何锁 command_ok=false 且路径命中）
    pub fn command_locked(&self, normalized_cwd: &Path) -> bool {
        self.locks
            .iter()
            .any(|l| !l.command_ok && matches_path_prefix(&l.path, normalized_cwd))
    }

    /// 判断读是否被锁拦截（read_ok=false 且命中）
    pub fn read_locked(&self, normalized: &Path) -> bool {
        self.locks
            .iter()
            .any(|l| !l.read_ok && matches_path_prefix(&l.path, normalized))
    }

    /// 判断写是否被锁拦截（write_ok=false 且命中）
    pub fn write_locked(&self, normalized: &Path) -> bool {
        self.locks
            .iter()
            .any(|l| !l.write_ok && matches_path_prefix(&l.path, normalized))
    }
}

/// 双向前缀匹配（组件级，借助 normalize_path 已归一；两向覆盖「目标在锁内」与「锁在目标内」）
fn matches_path_prefix(rule: &str, path: &Path) -> bool {
    let rule_p = Path::new(rule);
    path.starts_with(rule_p) || rule_p.starts_with(path)
}

// ─── 进程级单例与持久化 ────────────────────────────────────

static RULES: OnceLock<Mutex<PermissionRules>> = OnceLock::new();
static RULES_PATH: OnceLock<PathBuf> = OnceLock::new();

/// 初始化规则引擎（启动时调用一次；幂等——重复调用仅加载缺失文件）
pub fn init_rules(path: PathBuf) {
    let _ = RULES_PATH.set(path.clone());
    let loaded = std::fs::read_to_string(&path)
        .ok()
        .and_then(|s| serde_json::from_str::<PermissionRules>(&s).ok())
        .unwrap_or_default();
    let _ = RULES.set(Mutex::new(loaded));
}

/// 获取规则快照（匹配用；未初始化时返回空规则）
pub fn rules() -> MutexGuard<'static, PermissionRules> {
    RULES.get_or_init(|| Mutex::new(PermissionRules::default())).lock().unwrap_or_else(|e| e.into_inner())
}

/// 更新规则并落盘（命令层 CRUD 用；返回写盘错误）
pub fn update_rules<F>(f: F) -> Result<(), String>
where
    F: FnOnce(&mut PermissionRules),
{
    let mut guard = rules();
    f(&mut guard);
    save_to_disk(&guard)
}

/// 落盘（路径未初始化时静默跳过——纯内存模式，测试/未接线环境）
pub fn save_to_disk(rules: &PermissionRules) -> Result<(), String> {
    let Some(path) = RULES_PATH.get() else {
        return Ok(());
    };
    let content = serde_json::to_string_pretty(rules).map_err(|e| e.to_string())?;
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    std::fs::write(path, content).map_err(|e| e.to_string())
}

/// 导出规则（前端列表展示用）
pub fn export_rules() -> PermissionRules {
    rules().clone()
}

/// 将路径归一化为绝对路径（复用 tool_context::normalize_path；非绝对路径按原样返回）
pub fn normalize_rule_path(raw: &str, cwd_hint: Option<&Path>) -> String {
    let p = Path::new(raw);
    let abs = if p.is_absolute() {
        p.to_path_buf()
    } else if let Some(cwd) = cwd_hint {
        cwd.join(raw)
    } else {
        p.to_path_buf()
    };
    normalize_path(&abs).to_string_lossy().to_string()
}

/// 路径维度判定聚合（给 maybe_require_confirmation 用）：
/// Lock > Allow：
/// - 命中锁（按维度）→ 返回 Err(描述)
/// - 未命中锁但命中白名单 → Ok(true)（放行）
/// - 均未命中 → Ok(false)（交给档位默认）
pub fn verdict_for_path(
    rules: &PermissionRules,
    normalized: &Path,
    is_command: bool,
    is_write: bool,
    is_read: bool,
) -> Result<bool, String> {
    // 1) 锁（硬约束，优先级最高）
    for dim in [
        (is_write, rules.write_locked(normalized)),
        (is_read, rules.read_locked(normalized)),
        (is_command, rules.command_locked(normalized)),
    ] {
        if dim.0 && dim.1 {
            return Err(format!(
                "上锁名单拦截 —— 路径 `{}`（write={} read={} command={}）",
                normalized.display(),
                rules.write_locked(normalized),
                rules.read_locked(normalized),
                rules.command_locked(normalized),
            ));
        }
    }
    // 2) 白名单（放行例外）
    if rules.is_path_allowed(normalized) {
        return Ok(true);
    }
    // 3) 未覆盖
    Ok(false)
}

// ─── 测试 ──────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn wd() -> PathBuf {
        PathBuf::from("/proj")
    }

    #[test]
    fn level_parse_legacy_mapping() {
        assert_eq!(SecurityLevel::parse("plan"), SecurityLevel::Plan);
        assert_eq!(SecurityLevel::parse("interact"), SecurityLevel::Interact);
        assert_eq!(SecurityLevel::parse("autopilot"), SecurityLevel::Autopilot);
        // 旧档位兼容（v1 三档 → v2）
        assert_eq!(SecurityLevel::parse("off"), SecurityLevel::Autopilot);
        assert_eq!(SecurityLevel::parse("dangerous_only"), SecurityLevel::Interact);
        assert_eq!(SecurityLevel::parse("moderate_and_dangerous"), SecurityLevel::Interact);
        assert_eq!(SecurityLevel::parse("unknown"), SecurityLevel::Interact);
    }

    #[test]
    fn allow_command_substring() {
        let mut r = PermissionRules::default();
        r.allow_commands.push("pip install".into());
        assert!(r.is_command_allowed("pip install requests"));
        assert!(!r.is_command_allowed("npm install"));
    }

    #[test]
    fn path_lock_and_allow_priority() {
        let mut r = PermissionRules::default();
        // 锁：/proj/secret 默认锁（command/write 禁，read 可）
        r.locks.push(LockRule::default_lock("/proj/secret"));
        // 白名单 /proj/secret/tools（应被锁覆盖：锁优先）
        r.allow_paths.push("/proj/secret/tools".into());

        let locked_path = wd().join("secret/data.json");
        // 写被锁拦截（白名单也救不了）
        assert!(verdict_for_path(&r, &locked_path, false, true, false).is_err());
        // 读不锁（默认锁 read_ok=true）
        assert_eq!(verdict_for_path(&r, &locked_path, false, false, true), Ok(false));
        // 白名单路径但被锁覆盖 → 仍拦（锁 > 白名单）
        assert!(verdict_for_path(&r, &wd().join("secret/tools/x"), false, true, false).is_err());
        // 未锁未白名单 → false（交档位）
        assert_eq!(
            verdict_for_path(&r, &wd().join("out.md"), false, true, false),
            Ok(false)
        );
        // 白名单命中 → 放行
        let mut r2 = PermissionRules::default();
        r2.allow_paths.push("/proj/out".into());
        assert_eq!(
            verdict_for_path(&r2, &wd().join("out/file.md"), false, true, false),
            Ok(true)
        );
    }

    #[test]
    fn path_prefix_bidirectional() {
        assert!(Path::new("/a/b/c").starts_with(Path::new("/a/b")));
        assert!(Path::new("/a").starts_with(Path::new("/a/b/c")) == false);
    }
}