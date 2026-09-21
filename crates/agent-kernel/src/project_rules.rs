//! 项目规则（S4-c）：`{workdir}/.worldsea/permissions.json` 的解析、匹配与裁决
//!
//! 设计依据：`docs/plans/2026-09-21-ZCode能力内化方向探究/11-S4施工计划-权限模式机.md`（Q2 拍板：
//! 规则文件位于 **data zone 内**——Agent 裸写受 E1 保护，声明不可自改）。
//! 裁决结果（[`ProjectVerdict`]）作为 `permission_machine` 的 `PermissionCtx.project` 输入，
//! 对应判定位次 4（deny）/ 7（ask）/ 10（allow）——优先级 **deny > ask > allow > None**。


/// 项目规则裁决（位次 4/7/10 的输入；来源见 [`ProjectPermissionRules`]）
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub enum ProjectVerdict {
    /// 未声明 / 未命中
    #[default]
    None,
    /// 拒绝（项目硬约束——Q4-B：先于 alwaysAsk）
    Deny,
    /// 需确认
    Ask,
    /// 放行
    Allow,
}

// ─── 项目规则（S4-c；`{workdir}/.worldsea/permissions.json`）──────────

/// 项目规则文件相对路径（Q2 拍板：**data zone 内**——Agent 裸写受 E1 保护，声明不可自改）
pub const PROJECT_RULES_REL_PATH: &str = ".worldsea/permissions.json";

/// 规则文件大小上限（防误放超大文件拖慢会话装配；超限视为未声明）
pub const PROJECT_RULES_MAX_BYTES: u64 = 256 * 1024;

/// 项目规则（写作项目自描述安全面——ZD2-4）
///
/// 文件格式（deny / ask / allow 三项，条目为 `"tool"` 或 `"tool:content"`）：
/// ```json
/// { "deny": ["execute_command", "mcp__*"], "ask": ["web_fetch"], "allow": ["read_file:*entities/*"] }
/// ```
/// 匹配：工具名**无 `*` 为精确相等、含 `*` 为通配**；内容**无 `*` 为包含、含 `*` 为通配**
/// （见 [`content_matches`]；通配模式**首段锚定开头、末段锚定结尾**，故路径模式需显式 `*` 前缀——
/// 如 `*entities/*` 表示"任意路径下的 entities 子路径"）。缺文件 / 坏 JSON / 超限 → 未声明（不阻断装配）。
#[derive(Debug, Clone, Default, PartialEq, Eq, serde::Deserialize)]
#[serde(default)]
pub struct ProjectPermissionRules {
    pub deny: Vec<String>,
    pub ask: Vec<String>,
    pub allow: Vec<String>,
}

impl ProjectPermissionRules {
    /// 是否空规则（三项皆空 = 未声明）
    pub fn is_empty(&self) -> bool {
        self.deny.is_empty() && self.ask.is_empty() && self.allow.is_empty()
    }

    /// 从工作区加载（`{workdir}/.worldsea/permissions.json`）。
    ///
    /// 口径：缺文件 / 非文件 / 超限 / 坏 JSON / 空规则 → `None`（未声明；坏 JSON 记 warn——
    /// 权限声明**绝不猜测**：解析失败一律按未声明处理，不阻断会话装配）。
    pub fn load(workdir: &std::path::Path) -> Option<Self> {
        let path = workdir.join(PROJECT_RULES_REL_PATH);
        let meta = std::fs::metadata(&path).ok()?;
        if !meta.is_file() || meta.len() > PROJECT_RULES_MAX_BYTES {
            return None;
        }
        let text = std::fs::read_to_string(&path).ok()?;
        let rules: Self = match serde_json::from_str(&text) {
            Ok(rules) => rules,
            Err(e) => {
                tracing::warn!(path = %path.display(), error = %e, "项目规则解析失败：按未声明处理");
                return None;
            }
        };
        if rules.is_empty() {
            return None;
        }
        Some(rules)
    }

    /// 裁决（优先级 **deny > ask > allow > None**——fail-closed：拒绝压过其余）
    pub fn verdict(&self, tool_name: &str, subject: Option<&str>) -> ProjectVerdict {
        if self.matches(&self.deny, tool_name, subject) {
            return ProjectVerdict::Deny;
        }
        if self.matches(&self.ask, tool_name, subject) {
            return ProjectVerdict::Ask;
        }
        if self.matches(&self.allow, tool_name, subject) {
            return ProjectVerdict::Allow;
        }
        ProjectVerdict::None
    }

    fn matches(&self, entries: &[String], tool_name: &str, subject: Option<&str>) -> bool {
        entries.iter().any(|entry| {
            let (tool_pattern, content_pattern) = match entry.split_once(':') {
                Some((tool, content)) => (tool, Some(content)),
                None => (entry.as_str(), None),
            };
            if !tool_matches(tool_pattern, tool_name) {
                return false;
            }
            match content_pattern {
                None => true,
                Some(pattern) => subject.is_some_and(|s| content_matches(pattern, s)),
            }
        })
    }
}

/// 工具名匹配：无 `*` → 精确相等；含 `*` → 通配（如 `mcp__*`、`*_delete`）
pub fn tool_matches(pattern: &str, tool_name: &str) -> bool {
    if pattern.contains('*') {
        glob_match(pattern, tool_name)
    } else {
        pattern == tool_name
    }
}

/// 内容主体匹配：无 `*` → **包含**（与既有白名单「子串」口径一致）；含 `*` → 通配
pub fn content_matches(pattern: &str, subject: &str) -> bool {
    if pattern.contains('*') {
        glob_match(pattern, subject)
    } else {
        subject.contains(pattern)
    }
}

/// 简易通配（仅 `*`，分段顺序匹配；`*` 匹配任意串含分隔符）
///
/// - 无 `*` → 精确相等（调用方一般已在无星号时走包含/相等分支，此处兜底）
/// - 有 `*` → 首段锚定开头（模式不以 `*` 开头时）、末段锚定结尾（模式不以 `*` 结尾时）
fn glob_match(pattern: &str, text: &str) -> bool {
    if !pattern.contains('*') {
        return pattern == text;
    }
    let parts: Vec<&str> = pattern.split('*').collect();
    let mut rest = text;
    for (i, part) in parts.iter().enumerate() {
        if part.is_empty() {
            continue;
        }
        if i == 0 {
            let Some(stripped) = rest.strip_prefix(part) else {
                return false;
            };
            rest = stripped;
        } else {
            let Some(pos) = rest.find(part) else {
                return false;
            };
            rest = &rest[pos + part.len()..];
        }
    }
    if pattern.ends_with('*') {
        return true;
    }
    // 末段锚定结尾（循环内 find 只保证"出现过"）
    match parts.iter().rev().find(|p| !p.is_empty()) {
        Some(last) => text.ends_with(last),
        None => true,
    }
}
