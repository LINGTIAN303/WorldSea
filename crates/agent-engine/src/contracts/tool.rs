//! 工具元数据契约（C2 · ToolDescriptor）——「工具的单一事实源声明」。
//!
//! 依据：[06-工具元数据契约草案](../../../docs/plans/2026-09-21-ZCode能力内化方向探究/06-工具元数据契约草案.md)（**ZD3×5 全按建议**：字段一次到位 /
//! TS 声明 → Rust 生成物 / 209 清算挂账 / artifact 32KB / concurrent_safe 工具级布尔）·
//! [07-§二 工具契约](../../../docs/plans/2026-09-21-ZCode能力内化方向探究/07-内核契约冻结.md)（冻结：全字段单源 / executor 二态 / 注册面铁律 / 元数据消费方）·
//! [13-工具元数据族施工计划](../../../docs/plans/2026-09-21-ZCode能力内化方向探究/13-工具元数据族施工计划.md)。
//!
//! 分组对齐 06 §二 表（身份 / Schema / 安全 / 限制 / 控制 / 执行）；**安全组无隐式默认**
//! （Q1 拍板：`Tool::descriptor()` 必填、不设保守默认——默认值即猜测源）。
//!
//! 判定读法（映射既有位次，语义不变——B7 回归底线）：
//! - `safety.always_ask` → 位次 5（不可被模式绕过；替代 S4-b 静态四类名单）
//! - `safety.needs_approval` → 位次 12（按档位策略；对齐现状「Moderate 按策略」）
//! - `safety.requires_user_interaction` → 工具自身承载人工交互（提问类）→ 免执行前确认
//! - `safety.risk_level = Dangerous` ⟹ `always_ask = true`（校验器强制，对齐 S4-b「破坏性」类）
//!
//! 详细注释见 docs/details/注释/agent-runtime/tool.md。

use serde::{Deserialize, Serialize};

/// 风险等级（三级；对齐现状 `ToolPermission` 与 TS `PermissionLevel`）
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RiskLevel {
    /// 安全：常规读 / 查询
    Safe,
    /// 中等：写操作 / 命令执行（命令的危险模式由判定层动态升级）
    Moderate,
    /// 危险：破坏性 / 不可逆（⟹ always_ask，校验器强制）
    Dangerous,
}

/// 副作用范围（声明面；本族仅登记与审计，不驱动放行——权限由安全组与判定顺序裁决）
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SideEffectScope {
    /// 无副作用（纯计算 / 只读查询）
    None,
    /// 工作区文件
    Workspace,
    /// Git 仓库状态
    Git,
    /// 网络出口
    Network,
    /// 系统（进程 / 环境 / 全局配置）
    System,
    /// 会话态（记忆 / 定时器 / 会话内状态）
    Session,
}

/// 执行器二态（双执行栈正式化：客户端工具一等身份）
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Executor {
    /// 内核内执行（文件 / 终端 / 记忆 / MCP …）
    Local,
    /// 前端经桥执行（`agent:tool_call` → `ALL_TOOLS_MAP` → 结果回传）
    Client,
}

/// 安全组（权限系统**读声明**，不做调用点猜测）——字段全部必填
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ToolSafety {
    /// 只读（无写面）
    pub read_only: bool,
    /// 破坏性 / 不可逆
    pub destructive: bool,
    /// 并发安全（调度读取面；本族只读登记，不改串并行行为——Q2 拍板）
    pub concurrent_safe: bool,
    /// 工具自身承载人工交互（提问 / 审批面板类）→ 免执行前确认
    pub requires_user_interaction: bool,
    /// 不可被模式绕过的确认（位次 5；替代 S4-b 静态名单）
    pub always_ask: bool,
    /// 默认需确认（按档位策略；位次 12）
    pub needs_approval: bool,
    /// 风险等级
    pub risk_level: RiskLevel,
    /// 副作用范围
    pub side_effect_scope: SideEffectScope,
}

/// 限制组（元数据驱动，取代调用点硬编码）——`None` = 回落全局配置 / 常量
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ToolLimits {
    /// 单次执行超时毫秒（None = 回落全局 `tool_timeout`，现状默认不限时）
    #[serde(default)]
    pub timeout_ms: Option<u64>,
    /// 输出字节上限（None = 回落全局阈值，现状 12KB）
    #[serde(default)]
    pub max_output_bytes: Option<usize>,
}

/// 控制组
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ToolControl {
    /// 成功即结束本轮（如提问后无需继续）
    pub stop_turn_on_success: bool,
    /// 是否喂给模型（false = 仅系统用）
    pub provider_visible: bool,
}

/// 工具描述符（全字段单源；桥工具与原生工具同享）
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ToolDescriptor {
    // 身份
    /// 工具名（唯一标识；派发 action 名必须等于桥注册键——注册面铁律）
    pub name: String,
    /// 旧工具名别名
    pub aliases: Vec<String>,
    /// 分类（对齐 TS `ToolCategoryId`：entity / search / memory / file / dev …）
    pub category: String,
    /// 描述（喂模型；由运行时 schema render——零漂移哲学）
    pub description: String,
    // Schema
    /// 入参 JSON Schema
    pub input_schema: serde_json::Value,
    /// 出参 JSON Schema（可选）
    #[serde(default)]
    pub output_schema: Option<serde_json::Value>,
    /// 严格 schema（校验不通过即拒绝执行）
    #[serde(default)]
    pub strict: bool,
    // 安全 / 限制 / 控制
    /// 安全组（必填——六类声明一次到位）
    pub safety: ToolSafety,
    /// 限制组（缺省 = 回落全局）
    #[serde(default)]
    pub limits: ToolLimits,
    /// 控制组
    pub control: ToolControl,
    // 执行
    /// 执行器（local = 内核内 / client = 前端桥）
    pub executor: Executor,
}

impl ToolDescriptor {
    /// 只读工具（查询类；`side_effect_scope` 显式声明）
    pub fn read_only(name: &str, category: &str, description: &str, scope: SideEffectScope) -> Self {
        Self::new(
            name,
            category,
            description,
            ToolSafety {
                read_only: true,
                destructive: false,
                concurrent_safe: true,
                requires_user_interaction: false,
                always_ask: false,
                needs_approval: false,
                risk_level: RiskLevel::Safe,
                side_effect_scope: scope,
            },
        )
    }

    /// 写工具（工作区 / 会话写；按档位策略确认——对齐现状 Moderate）
    pub fn writes(name: &str, category: &str, description: &str, scope: SideEffectScope) -> Self {
        Self::new(
            name,
            category,
            description,
            ToolSafety {
                read_only: false,
                destructive: false,
                concurrent_safe: false,
                requires_user_interaction: false,
                always_ask: false,
                needs_approval: true,
                risk_level: RiskLevel::Moderate,
                side_effect_scope: scope,
            },
        )
    }

    /// 不可绕过确认的工具（进程执行 / 未预批外发 / 破坏性——位次 5）
    pub fn guarded(
        name: &str,
        category: &str,
        description: &str,
        scope: SideEffectScope,
        risk: RiskLevel,
    ) -> Self {
        Self::new(
            name,
            category,
            description,
            ToolSafety {
                read_only: false,
                destructive: risk == RiskLevel::Dangerous,
                concurrent_safe: false,
                requires_user_interaction: false,
                always_ask: true,
                needs_approval: false,
                risk_level: risk,
                side_effect_scope: scope,
            },
        )
    }

    /// 自身承载人工交互的工具（提问类；免执行前确认）
    pub fn interactive(name: &str, category: &str, description: &str) -> Self {
        Self::new(
            name,
            category,
            description,
            ToolSafety {
                read_only: true,
                destructive: false,
                concurrent_safe: false,
                requires_user_interaction: true,
                always_ask: false,
                needs_approval: false,
                risk_level: RiskLevel::Safe,
                side_effect_scope: SideEffectScope::None,
            },
        )
    }

    /// 基础构造：身份 + Schema + 安全组（限制 / 控制取「回落全局」的保守装配）
    ///
    /// 限制组缺省 = `None`（回落全局配置）；控制组 = 不截断本轮、喂模型。
    /// **安全组必须显式给出**（无默认——见模块头）。
    pub fn new(name: &str, category: &str, description: &str, safety: ToolSafety) -> Self {
        Self {
            name: name.to_string(),
            aliases: Vec::new(),
            category: category.to_string(),
            description: description.to_string(),
            input_schema: serde_json::json!({ "type": "object", "properties": {} }),
            output_schema: None,
            strict: false,
            safety,
            limits: ToolLimits::default(),
            control: ToolControl {
                stop_turn_on_success: false,
                provider_visible: true,
            },
            executor: Executor::Local,
        }
    }

    /// 链式：设置入参 schema
    pub fn with_input_schema(mut self, schema: serde_json::Value) -> Self {
        self.input_schema = schema;
        self
    }

    /// 链式：别名
    pub fn with_aliases(mut self, aliases: &[&str]) -> Self {
        self.aliases = aliases.iter().map(|s| (*s).to_string()).collect();
        self
    }

    /// 链式：限制组
    pub fn with_limits(mut self, limits: ToolLimits) -> Self {
        self.limits = limits;
        self
    }

    /// 链式：执行器
    pub fn with_executor(mut self, executor: Executor) -> Self {
        self.executor = executor;
        self
    }

    /// 声明一致性（校验器与注册面共用）：
    /// ① `risk_level = Dangerous` ⟹ `always_ask`（对齐 S4-b「破坏性」类）；
    /// ② `read_only` ⟹ 不得 `destructive`。
    pub fn validate(&self) -> Result<(), String> {
        if self.safety.risk_level == RiskLevel::Dangerous && !self.safety.always_ask {
            return Err(format!(
                "工具 {} 声明不一致：risk_level=dangerous 必须 always_ask（不可绕过的确认）",
                self.name
            ));
        }
        if self.safety.read_only && self.safety.destructive {
            return Err(format!(
                "工具 {} 声明不一致：read_only 与 destructive 互斥",
                self.name
            ));
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_safety() -> ToolSafety {
        ToolSafety {
            read_only: false,
            destructive: false,
            concurrent_safe: false,
            requires_user_interaction: false,
            always_ask: true,
            needs_approval: false,
            risk_level: RiskLevel::Moderate,
            side_effect_scope: SideEffectScope::System,
        }
    }

    #[test]
    fn descriptor_roundtrip_snake_case_and_required_fields() {
        let d = ToolDescriptor::new("execute_command", "dev", "执行命令", sample_safety())
            .with_input_schema(serde_json::json!({ "type": "object" }))
            .with_executor(Executor::Client);
        let v = serde_json::to_value(&d).unwrap();
        // 字段为 snake_case，分组嵌套（与生成物同形）
        assert_eq!(v["safety"]["always_ask"], true);
        assert_eq!(v["safety"]["risk_level"], "moderate");
        assert_eq!(v["safety"]["side_effect_scope"], "system");
        assert_eq!(v["executor"], "client");
        let back: ToolDescriptor = serde_json::from_value(v).unwrap();
        assert_eq!(back, d);
    }

    #[test]
    fn missing_safety_field_fails_loud() {
        // 反证①：声明缺 side_effect_scope → 解析失败（fail loud，不静默补默认）
        let raw = serde_json::json!({
            "name": "x", "aliases": [], "category": "dev", "description": "d",
            "input_schema": { "type": "object" },
            "safety": {
                "read_only": false, "destructive": false, "concurrent_safe": false,
                "requires_user_interaction": false, "always_ask": false, "needs_approval": false,
                "risk_level": "moderate"
            },
            "control": { "stop_turn_on_success": false, "provider_visible": true },
            "executor": "local"
        });
        let err = serde_json::from_value::<ToolDescriptor>(raw).unwrap_err();
        assert!(err.to_string().contains("side_effect_scope"), "{err}");
    }

    #[test]
    fn unknown_field_fails_loud() {
        // deny_unknown_fields：生成物与契约漂移（多字段）即启动失败
        let mut v = serde_json::to_value(ToolDescriptor::read_only(
            "list_directory",
            "file",
            "列目录",
            SideEffectScope::Workspace,
        ))
        .unwrap();
        v.as_object_mut().unwrap().insert("legacy_field".into(), serde_json::json!(1));
        assert!(serde_json::from_value::<ToolDescriptor>(v).is_err());
    }

    #[test]
    fn validate_enforces_dangerous_implies_always_ask() {
        let mut d = ToolDescriptor::read_only("list_directory", "file", "列目录", SideEffectScope::Workspace);
        assert!(d.validate().is_ok());
        d.safety.risk_level = RiskLevel::Dangerous;
        let err = d.validate().unwrap_err();
        assert!(err.contains("always_ask"), "{err}");
        // read_only 与 destructive 互斥
        d.safety.risk_level = RiskLevel::Safe;
        d.safety.read_only = true;
        d.safety.destructive = true;
        assert!(d.validate().is_err());
    }
}
