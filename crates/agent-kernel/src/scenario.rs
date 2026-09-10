//! Agent Runtime — 场景插件体系（B1 多场景插件，MVP）
//!
//! 借鉴 OpenWorld `ScenarioPlugin`（场景 = 身份 prompt + 专用工具 + 内置技能 + 可选消息钩子），
//! 适配 WorldSea 本地世界构建上下文。MVP 阶段只实现链路与 `worldbuilding` 场景。
//!
//! 设计原则：
//! - Scenario trait 定义场景契约，将「场景能力」从 AgentLoop 通用执行逻辑中解耦
//! - 场景通过 `ScenarioRegistry` 注册/查找，AgentLoop 按场景动态构建 system prompt + 裁剪工具
//! - 工具裁剪复用 `WhitelistToolBus`（见 `crate::tool`），MVP 语义 = 系统基础工具 ∪ 场景 tool_ids
//! - `build_system_prompt` 默认只做身份 prompt；项目/实体上下文注入留待后续（需实体库访问器）

use std::sync::{Arc, RwLock};

use async_trait::async_trait;

// 场景确认策略引用 unification：ConfirmationPolicy 位于 confirmation 模块
use crate::confirmation::ConfirmationPolicy;

// ─── 场景上下文 ──────────────────────────────────────────

/// 场景上下文（传递给 trait 方法的运行时参数）
///
/// 承载运行时标识 + 项目实体摘要（实体上下文注入）。实体摘要由 AgentLoop 在
/// `build_prompt_options` 中经 `ScenarioEntityProvider` 拉取后填入，供场景
/// `build_system_prompt` 拼入 system prompt。
#[derive(Debug, Clone, Default)]
pub struct ScenarioContext {
    /// 当前项目 ID（WorldSea 本地单用户，无归属校验需求）
    pub project_id: Option<String>,
    /// 当前用户消息文本（供 on_message / prompt 参考）
    pub query_text: Option<String>,
    /// 项目实体摘要（由 `ScenarioEntityProvider.entity_summary` 生成，注入 system prompt）
    pub entity_summary: Option<String>,
    /// 会话绑定的 Workspace 实体 id（场景工作区隔离消费；None=旧数据缺省）
    pub workspace_id: Option<String>,
}

impl ScenarioContext {
    pub fn new(
        project_id: Option<String>,
        query_text: Option<String>,
        entity_summary: Option<String>,
    ) -> Self {
        Self {
            project_id,
            query_text,
            entity_summary,
            workspace_id: None,
        }
    }

    /// 链式注入 workspace_id（严格隔离：场景会话的工作区由命令层按场景根派生）
    pub fn with_workspace_id(mut self, workspace_id: Option<String>) -> Self {
        self.workspace_id = workspace_id;
        self
    }
}

// ─── 场景实体访问器 ──────────────────────────────────────

/// 场景实体访问器（把项目实体摘要注入场景 system prompt）
///
/// 抽象在 agent-runtime（公共层），实现由 Tauri 层（`EntityDb` SQLite 兜底库 /
/// 未来 per-project FileStorageBackend）提供，避免公共层反向依赖具体存储实现。
/// AgentLoop 在 `build_prompt_options` 中按需调用，把返回的摘要填入 `ScenarioContext`。
#[async_trait]
pub trait ScenarioEntityProvider: Send + Sync + std::fmt::Debug {
    /// 按实体类型查询并生成紧凑摘要（供场景注入 system prompt）
    ///
    /// - `types`：需要纳入摘要的实体类型（如 character/region/...）
    /// - `per_type_limit`：每类型最多纳入的条数
    /// 返回空串表示无实体可注入（调用方应跳过摘要段落）。
    async fn entity_summary(&self, types: &[&str], per_type_limit: usize) -> String;
}

// ─── 场景记忆策略 ──────────────────────────────────────

/// 场景记忆策略（数据意图；MVP 供 AgentLoop 记忆注入与前端「记忆强度」展示参考）
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum ScenarioMemoryPolicy {
    /// 通用记忆（缺省）：标准记忆策略
    #[default]
    Standard,
    /// 强项目/实体记忆（如 worldbuilding：会话上下文充分感知已有设定）
    EntityRich,
    /// 轻记忆（如 coding：避免知识沉淀稀释代码上下文）
    Light,
}

/// 场景确认策略：危险操作确认强度按场景调（缺省 = 全局 dangerous_only）
///
/// 供命令层在 `new_agent` 时按场景注入 `AgentLoopConfig.confirmation_policy`。
fn scenario_confirmation_policy() -> ConfirmationPolicy {
    ConfirmationPolicy::dangerous_only()
}

// ─── 场景插件 trait ──────────────────────────────────────

/// 场景插件 trait
///
/// 实现方：worldbuilding 等场景
/// 调用方：AgentLoop 在 `build_prompt_options`（prompt 注入）与工具视图构建（工具裁剪）时调用
#[async_trait]
pub trait Scenario: Send + Sync + std::fmt::Debug {
    /// 场景唯一标识（如 "world"）
    fn id(&self) -> &str;

    /// 显示名（如 "世界构建"）
    fn display_name(&self) -> &str;

    /// 构建场景专用 system prompt 片段（身份 + 可选上下文注入）
    ///
    /// MVP：仅返回身份 prompt 文本，由 AgentLoop 拼入 `system_prompt_override`。
    /// 未来可在此注入项目实体摘要（角色/区域/世界观）。
    async fn build_system_prompt(&self, ctx: &ScenarioContext) -> String;

    /// 场景专用工具名（供 WhitelistToolBus 裁剪）
    ///
    /// 语义：白名单 = 系统基础工具 ∪ 本列表。返回场景专属工具名（如 entity_* 等）；
    /// 系统基础工具（terminal / subagent 等）由 AgentLoop 侧单独提供，不需在此列出。
    fn tool_ids(&self) -> Vec<String>;

    /// 场景默认激活的技能 ID 列表（与 TS 技能体系联动）
    ///
    /// MVP：仅登记意图，实际技能加载在 TS 侧 `packages/agent-runtime/skills`。
    fn builtin_skills(&self) -> Vec<String>;

    /// 场景默认工作区根名（严格隔离：会话 workdir 强制落在 `workspaces.root/<hint>`）
    ///
    /// `None` = 使用全局默认工作区根（一般场景给独立根，通用/缺省可 None）。
    /// 2026-09-09 场景底座：用户拍板「场景工作区严格隔离 + 会话不互通」。
    fn workspace_hint(&self) -> Option<&str> {
        None
    }

    /// 场景记忆策略（生成记忆/上下文注入强度的数据意图）
    fn memory_policy(&self) -> ScenarioMemoryPolicy {
        ScenarioMemoryPolicy::Standard
    }

    /// 场景确认策略（危险操作确认强度；缺省 = 全局 dangerous_only）
    fn confirmation_policy(&self) -> ConfirmationPolicy {
        scenario_confirmation_policy()
    }

    /// 场景附加 system prompt 段（插件钩子：场景可注入额外上下文块/约束）
    ///
    /// 默认空；调用方（AgentLoop）在 `build_prompt_options` 中把返回块依次拼到
    /// `build_system_prompt` 之后。场景级扩展（如 coding 场景注入工程规范）由此承载。
    fn extra_system_prompt_blocks(&self, _ctx: &ScenarioContext) -> Vec<String> {
        Vec::new()
    }

    /// 可选：消息钩子（每条用户消息处理前调用，可做预处理）
    async fn on_message(&self, _msg: &str, _ctx: &ScenarioContext) {}
}

// ─── 场景插件注册中心 ───────────────────────────────────

/// 场景插件注册中心
///
/// 注册 / 查找 / 默认场景。用 `std::sync::RwLock`（短临界读，无 async，不新增依赖）。
pub struct ScenarioRegistry {
    plugins: RwLock<Vec<Arc<dyn Scenario>>>,
}

impl ScenarioRegistry {
    pub fn new() -> Self {
        Self {
            plugins: RwLock::new(Vec::new()),
        }
    }

    /// 注册场景插件
    pub fn register(&self, plugin: Arc<dyn Scenario>) {
        self.plugins.write().unwrap().push(plugin);
    }

    /// 获取所有场景插件
    pub fn list(&self) -> Vec<Arc<dyn Scenario>> {
        self.plugins.read().unwrap().clone()
    }

    /// 按 id 查找场景插件
    pub fn find(&self, id: &str) -> Option<Arc<dyn Scenario>> {
        self.plugins
            .read()
            .unwrap()
            .iter()
            .find(|p| p.id() == id)
            .cloned()
    }

    /// 获取默认场景（第一个注册，缺省为 world）
    pub fn default_plugin(&self) -> Option<Arc<dyn Scenario>> {
        self.plugins.read().unwrap().first().cloned()
    }
}

impl Default for ScenarioRegistry {
    fn default() -> Self {
        Self::new()
    }
}

// ─── worldbuilding 场景（MVP 首发） ─────────────────────—

/// 世界构建场景插件
///
/// 面向 WorldSea 核心领域（世界构建）：实体/角色/区域/图谱/记忆/知识库。
/// MVP：身份 prompt + 工具意图 + 技能意图；实体上下文注入留待后续。
#[derive(Debug)]
pub struct WorldbuildingScenario;

impl WorldbuildingScenario {
    pub fn new() -> Self {
        Self
    }
}

impl Default for WorldbuildingScenario {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl Scenario for WorldbuildingScenario {
    fn id(&self) -> &str {
        "world"
    }

    fn display_name(&self) -> &str {
        "世界构建"
    }

    /// 世界构建场景独立工作区根（scenes_root/worldbuilding）
    ///
    /// 2026-09-10 场景 id 改名 worldbuilding→world 后 hint 保持不变：场景根目录名
    /// 不漂移，既有会话工作区（workspace_id→root 映射）与磁盘数据自然延续。
    fn workspace_hint(&self) -> Option<&str> {
        Some("worldbuilding")
    }

    /// 世界构建强项目/实体记忆：会话上下文充分感知已有设定
    fn memory_policy(&self) -> ScenarioMemoryPolicy {
        ScenarioMemoryPolicy::EntityRich
    }

    /// 世界构建身份 prompt（含可选实体上下文注入）
    async fn build_system_prompt(&self, ctx: &ScenarioContext) -> String {
        let mut prompt = String::from(
            "你是 WorldSea 的世界构建Agent。旨在帮助用户构建完整、自洽的虚构世界：\
             塑造角色、规划地理区域与势力、设计魔法系统、整理概念与冲突、梳理时间线与文化。\
             你可以调用工具读写项目中的实体数据（如角色/区域/世界观/图谱等）。",
        );
        if let Some(pid) = &ctx.project_id {
            prompt.push_str(&format!("\n\n当前项目 ID：{pid}"));
        }
        // 实体上下文注入：把当前项目的角色/区域等实体概览拼入 system prompt，
        // 让 Agent 在首轮即感知项目已有设定，避免脱离既有世界观空谈。
        if let Some(es) = &ctx.entity_summary {
            if !es.trim().is_empty() {
                prompt.push_str(&format!("\n\n【当前项目已有设定】\n{es}"));
            }
        }
        prompt
    }

    /// 世界构建场景专用工具意图（entity/relation/content/memory/kb）
    ///
    /// 注：Rust `tool_bus` 当前通过 `new_agent` 仅注册 terminal + subagent 工具，
    /// 此处工具名多为 TS 侧（`ALL_TOOLS_MAP`）桥接工具的表达意图。未来 TS 工具
    /// 注册进 Rust `ToolBus` 后，本列表将决定 worldbuilding 场景的可用工具扩充。
    fn tool_ids(&self) -> Vec<String> {
        vec![
            // 实体 CRUD
            "entity_get".into(),
            "entity_list".into(),
            "entity_create".into(),
            "entity_update".into(),
            "entity_delete".into(),
            "entity_get_context".into(),
            // 关系
            "relation_list".into(),
            "relation_create".into(),
            // 内容检索
            "content_search".into(),
            // 记忆
            "memory_recall".into(),
            "memory_store".into(),
            // 知识库
            "kb_read".into(),
            "kb_search".into(),
            "kb_write".into(),
            // B3 联网搜索（原生 web_search 工具，降级链保证可用）
            "web_search".into(),
        ]
    }

    /// 世界构建场景默认激活的技能意图（与 TS 技能体系联动）
    fn builtin_skills(&self) -> Vec<String> {
        vec![
            "worldbuild".into(),
            "character".into(),
            "geography".into(),
            "magic".into(),
            "combat".into(),
            "language".into(),
        ]
    }
}

// ─── 小说场景（novel） ──────────────────────────────────

/// 小说创作场景：叙事作者身份，内容/知识/记忆为主（worldbuilding 的子集 + 写作偏向）
#[derive(Debug)]
pub struct NovelScenario;

impl NovelScenario {
    pub fn new() -> Self {
        Self
    }
}

impl Default for NovelScenario {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl Scenario for NovelScenario {
    fn id(&self) -> &str {
        "novel"
    }

    fn display_name(&self) -> &str {
        "小说"
    }

    fn workspace_hint(&self) -> Option<&str> {
        Some("novel")
    }

    fn memory_policy(&self) -> ScenarioMemoryPolicy {
        ScenarioMemoryPolicy::EntityRich
    }

    async fn build_system_prompt(&self, ctx: &ScenarioContext) -> String {
        let mut prompt = String::from(
            "你是 WorldSea 的小说创作Agent。擅长人物弧光、情节结构、场景描写与文风打磨。\
             作为Agent，可以调用工具读写项目中的角色/章节/设定数据，保持叙事与已有世界观的连贯。\
             用户或已创作了一个世界观，可先考虑查看项目中的实体目录详情，依据已有信息进行任务。",
        );
        if let Some(pid) = &ctx.project_id {
            prompt.push_str(&format!("\n\n当前项目 ID：{pid}"));
        }
        if let Some(es) = &ctx.entity_summary {
            if !es.trim().is_empty() {
                prompt.push_str(&format!("\n\n【当前项目已有设定】\n{es}"));
            }
        }
        prompt
    }

    fn tool_ids(&self) -> Vec<String> {
        vec![
            "entity_get".into(),
            "entity_list".into(),
            "entity_create".into(),
            "entity_update".into(),
            "relation_list".into(),
            "relation_create".into(),
            "content_search".into(),
            "memory_recall".into(),
            "memory_store".into(),
            "kb_read".into(),
            "kb_search".into(),
            "kb_write".into(),
            "web_search".into(),
        ]
    }

    fn builtin_skills(&self) -> Vec<String> {
        vec!["novel".into(), "story".into()]
    }
}

// ─── 通用场景（general） ─────────────────────────────────

/// 通用场景：轻装通用助手（无领域专精；基础工具 + 记忆 + 搜索）
#[derive(Debug)]
pub struct GeneralScenario;

impl GeneralScenario {
    pub fn new() -> Self {
        Self
    }
}

impl Default for GeneralScenario {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl Scenario for GeneralScenario {
    fn id(&self) -> &str {
        "general"
    }

    fn display_name(&self) -> &str {
        "通用"
    }

    fn workspace_hint(&self) -> Option<&str> {
        Some("general")
    }

    async fn build_system_prompt(&self, ctx: &ScenarioContext) -> String {
        let mut prompt = String::from(
            "你是 WorldSea 的通用任务Agent。回答问题、整理资料、完成任务；\
             无领域专精，按需调用可用工具。",
        );
        if let Some(pid) = &ctx.project_id {
            prompt.push_str(&format!("\n\n当前项目 ID：{pid}"));
        }
        prompt
    }

    fn tool_ids(&self) -> Vec<String> {
        vec![
            "content_search".into(),
            "memory_recall".into(),
            "memory_store".into(),
            "kb_read".into(),
            "kb_search".into(),
            "web_search".into(),
        ]
    }

    fn builtin_skills(&self) -> Vec<String> {
        Vec::new()
    }
}

// ─── 编程场景（coding） ─────────────────────────────────

/// 编程场景：工程师身份，命令/文件/搜索能力为主（轻记忆，避免稀释代码上下文）
#[derive(Debug)]
pub struct CodingScenario;

impl CodingScenario {
    pub fn new() -> Self {
        Self
    }
}

impl Default for CodingScenario {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl Scenario for CodingScenario {
    fn id(&self) -> &str {
        "coding"
    }

    fn display_name(&self) -> &str {
        "编程"
    }

    fn workspace_hint(&self) -> Option<&str> {
        Some("coding")
    }

    fn memory_policy(&self) -> ScenarioMemoryPolicy {
        ScenarioMemoryPolicy::Light
    }

    async fn build_system_prompt(&self, ctx: &ScenarioContext) -> String {
        let mut prompt = String::from(
            "你是 WorldSea 的编程Agent。擅长读代码、写代码、调试、重构与工程方案设计；\
             使用终端/文件工具/可选工具完成任务，输出可运行的实现。",
        );
        if let Some(pid) = &ctx.project_id {
            prompt.push_str(&format!("\n\n当前项目 ID：{pid}"));
        }
        if let Some(ws) = &ctx.workspace_id {
            prompt.push_str(&format!("\n\n工作区 ID：{ws}（文件工具相对路径基于该工作区根）"));
        }
        prompt
    }

    fn tool_ids(&self) -> Vec<String> {
        vec![
            "read_file".into(),
            "write_file".into(),
            "edit_file".into(),
            "list_directory".into(),
            "search_files".into(),
            "content_search".into(),
            "kb_read".into(),
            "kb_search".into(),
            "memory_recall".into(),
            "web_search".into(),
        ]
    }

    fn builtin_skills(&self) -> Vec<String> {
        vec!["coding".into(), "refactor".into()]
    }
}

// ─── 设计场景（design） ─────────────────────────────────

/// 设计场景：设计师身份，内容/知识/记忆为主（设定草稿、规范、概念设计）
#[derive(Debug)]
pub struct DesignScenario;

impl DesignScenario {
    pub fn new() -> Self {
        Self
    }
}

impl Default for DesignScenario {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl Scenario for DesignScenario {
    fn id(&self) -> &str {
        "design"
    }

    fn display_name(&self) -> &str {
        "设计"
    }

    fn workspace_hint(&self) -> Option<&str> {
        Some("design")
    }

    async fn build_system_prompt(&self, ctx: &ScenarioContext) -> String {
        let mut prompt = String::from(
            "你是 WorldSea 的设计Agent。擅长概念设计、规范撰写、结构布局与创意提案；\
             使用内容/知识工具/可选工具沉淀设计文档与规范。",
        );
        if let Some(pid) = &ctx.project_id {
            prompt.push_str(&format!("\n\n当前项目 ID：{pid}"));
        }
        prompt
    }

    fn tool_ids(&self) -> Vec<String> {
        vec![
            "entity_get".into(),
            "entity_list".into(),
            "entity_create".into(),
            "entity_update".into(),
            "content_search".into(),
            "memory_recall".into(),
            "memory_store".into(),
            "kb_read".into(),
            "kb_search".into(),
            "kb_write".into(),
            "web_search".into(),
        ]
    }

    fn builtin_skills(&self) -> Vec<String> {
        vec!["design".into()]
    }
}

// ─── 测试 ─────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn five_scenarios_declare_workspace_and_policies() {
        let scenarios: Vec<Arc<dyn Scenario>> = vec![
            Arc::new(WorldbuildingScenario::new()),
            Arc::new(NovelScenario::new()),
            Arc::new(GeneralScenario::new()),
            Arc::new(CodingScenario::new()),
            Arc::new(DesignScenario::new()),
        ];
        let ctx = ScenarioContext::new(None, None, None);
        for sc in &scenarios {
            assert!(!sc.tool_ids().is_empty(), "{} 至少声明一个工具意图", sc.id());
            assert!(!sc.build_system_prompt(&ctx).await.trim().is_empty(), "{} 有身份 prompt", sc.id());
            // 场景确认策略缺省 = 全局 dangerous_only（默认不确认 Moderate 级）
            assert!(!sc.confirmation_policy().confirm_moderate, "{} 确认策略异常", sc.id());
            // 插件钩子默认空
            assert!(sc.extra_system_prompt_blocks(&ctx).is_empty(), "{} 额外 prompt 段默认空", sc.id());
        }
        // 严格隔离：5 场景均有独立工作区根（id ↔ hint 一一映射，互不共享）
        let hints: std::collections::HashSet<String> = scenarios
            .iter()
            .map(|s| s.workspace_hint().unwrap_or_default().to_string())
            .collect();
        assert_eq!(hints.len(), 5, "5 场景工作区根必须互不共享（严格隔离）");
    }

    #[tokio::test]
    async fn worldbuilding_prompt_contains_identity() {
        let sc = WorldbuildingScenario::new();
        let ctx = ScenarioContext::new(Some("p1".into()), None, None);
        let prompt = sc.build_system_prompt(&ctx).await;
        assert!(prompt.contains("世界构建Agent"));
        assert!(prompt.contains("p1"));
    }

    #[tokio::test]
    async fn worldbuilding_prompt_injects_entity_summary() {
        let sc = WorldbuildingScenario::new();
        let ctx = ScenarioContext::new(
            Some("p1".into()),
            None,
            Some("- 墓潇：天界的女剑修\n- 龙脊山脉：北境天险".into()),
        );
        let prompt = sc.build_system_prompt(&ctx).await;
        assert!(prompt.contains("当前项目已有设定"));
        assert!(prompt.contains("墓潇"));
        // 空摘要不应插入段落
        let empty_ctx = ScenarioContext::new(Some("p1".into()), None, Some(String::new()));
        let empty_prompt = sc.build_system_prompt(&empty_ctx).await;
        assert!(!empty_prompt.contains("当前项目已有设定"));
    }

    #[tokio::test]
    async fn worldbuilding_declares_tools_and_skills() {
        let sc = WorldbuildingScenario::new();
        assert_eq!(sc.id(), "world");
        assert!(sc.tool_ids().contains(&"entity_get".to_string()));
        assert!(sc.builtin_skills().contains(&"worldbuild".to_string()));
    }

    #[tokio::test]
    async fn registry_register_find_default() {
        let registry = ScenarioRegistry::new();
        let sc: Arc<dyn Scenario> = Arc::new(WorldbuildingScenario::new());
        registry.register(sc.clone());
        assert_eq!(registry.list().len(), 1);
        assert!(registry.find("world").is_some());
        assert!(registry.find("nonexistent").is_none());
        assert_eq!(registry.default_plugin().unwrap().id(), "world");
    }
}