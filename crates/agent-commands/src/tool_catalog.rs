//! R 批（对话区行段渲染）· R-0 分派基座：工具目录构建
//!
//! 详细设计见 docs/plans/2026-09-21-ZCode能力内化方向探究/18-对话区行段渲染批草案.md
//! §三之二（dsh 取经）与 §5.1（三层分派）。
//!
//! 职责边界：目录只提供**类归属依据**（category / 读写语义 / MCP 归属），
//! 精确形态由前端静态表决定，内容结构由工具结果 `__meta` 决定
//! （对齐 dsh「类由客户端判、结构由服务端给」）。
//!
//! MCP 归属派生：MCP 工具的描述带 `[MCP:{server_id}]` 前缀（crates/agent-kernel/src/mcp.rs），
//! 这里从描述取 server_id——不改内核私有表、不依赖工具名反解析
//! （工具名会被清洗、超长时截断 + 指纹，反解析不可靠）。

use agent_runtime::tool::{ToolBus, ToolCatalogEntry, ToolDescriptor};

use crate::{AgentCommandService, CommandError};

/// MCP 工具描述里的服务器归属前缀（与 `mcp.rs` 的书写格式保持一处约定）
const MCP_DESC_PREFIX: &str = "[MCP:";

/// 从工具描述派生 MCP 服务器 id（非 MCP 工具 / 无前缀 → None）
fn mcp_server_of(desc: &ToolDescriptor) -> Option<String> {
    desc.description
        .strip_prefix(MCP_DESC_PREFIX)
        .and_then(|rest| rest.split(']').next())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

/// 遍历工具总线构建目录（按 name 升序——前端 diff 与覆盖断言依赖稳定顺序）
pub async fn build_tool_catalog(bus: &dyn ToolBus) -> Vec<ToolCatalogEntry> {
    let mut out = Vec::new();
    for def in bus.list_all().await {
        let Some(desc) = bus.get_descriptor(&def.name).await else {
            continue;
        };
        out.push(ToolCatalogEntry {
            name: desc.name.clone(),
            category: desc.category.clone(),
            aliases: desc.aliases.clone(),
            read_only: desc.safety.read_only,
            destructive: desc.safety.destructive,
            mcp_server: mcp_server_of(&desc),
        });
    }
    out.sort_by(|a, b| a.name.cmp(&b.name));
    out
}

impl AgentCommandService {
    /// R-0：列出指定会话的工具目录（前端行段分派基座）
    pub async fn tool_catalog(
        &self,
        session_id: &str,
    ) -> Result<Vec<ToolCatalogEntry>, CommandError> {
        let agent = self.get_agent(session_id).await?;
        let bus = agent.tool_bus();
        Ok(build_tool_catalog(&*bus).await)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use agent_runtime::tool::{SideEffectScope, SimpleToolBus, Tool, ToolError};
    use async_trait::async_trait;
    use std::sync::Arc;

    /// 最小工具桩（声明面走 descriptor 构造器，保证注册面守卫通过）
    struct Stub {
        name: &'static str,
        desc: ToolDescriptor,
    }

    #[async_trait]
    impl Tool for Stub {
        fn name(&self) -> &str {
            self.name
        }
        fn description(&self) -> &str {
            &self.desc.description
        }
        fn parameters(&self) -> serde_json::Value {
            serde_json::json!({ "type": "object" })
        }
        fn descriptor(&self) -> ToolDescriptor {
            self.desc.clone()
        }
        async fn execute(&self, _args: serde_json::Value) -> Result<serde_json::Value, ToolError> {
            Ok(serde_json::json!({}))
        }
    }

    fn stub(name: &'static str, category: &str, desc: &str, scope: SideEffectScope) -> Stub {
        Stub {
            name,
            desc: ToolDescriptor::read_only(name, category, desc, scope),
        }
    }

    #[tokio::test]
    async fn catalog_projects_descriptor_fields_and_sorts_by_name() {
        let bus = SimpleToolBus::new();
        bus.register(Arc::new(stub("write_file", "file", "写文件", SideEffectScope::Workspace))).await;
        bus.register(Arc::new(stub("read_file", "file", "读文件", SideEffectScope::Workspace))).await;

        let catalog = build_tool_catalog(&bus).await;
        assert_eq!(
            catalog.iter().map(|e| e.name.as_str()).collect::<Vec<_>>(),
            vec!["read_file", "write_file"],
            "目录须按 name 升序（前端 diff 稳定）"
        );
        let read = &catalog[0];
        assert_eq!(read.category, "file");
        assert!(read.read_only);
        assert!(!read.destructive);
        assert_eq!(read.mcp_server, None);
    }

    #[tokio::test]
    async fn catalog_derives_mcp_server_from_description_prefix() {
        let bus = SimpleToolBus::new();
        bus.register(Arc::new(stub(
            "mcp__filesystem__read_file",
            "mcp",
            "[MCP:filesystem] Read a file",
            SideEffectScope::Network,
        )))
        .await;

        let catalog = build_tool_catalog(&bus).await;
        assert_eq!(catalog.len(), 1);
        assert_eq!(catalog[0].mcp_server.as_deref(), Some("filesystem"));
    }

    #[tokio::test]
    async fn catalog_without_mcp_prefix_or_with_empty_server_is_none() {
        let bus = SimpleToolBus::new();
        bus.register(Arc::new(stub("web_search", "search", "联网搜索", SideEffectScope::Network))).await;
        bus.register(Arc::new(stub("odd_tool", "dev", "[MCP:] 空归属", SideEffectScope::Session))).await;

        let catalog = build_tool_catalog(&bus).await;
        assert!(catalog.iter().all(|e| e.mcp_server.is_none()));
    }
}
