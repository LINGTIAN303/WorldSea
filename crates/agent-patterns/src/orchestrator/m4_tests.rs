//! M4/M5 验收测试 — LayeredMemoryStore（§7）/ KernelBackendLlm（§8）

use std::sync::Arc;


use crate::orchestrator::executor::{DefaultOrchestrator, RunConfig};
use crate::orchestrator::genai_adapter::KernelBackendLlm;
use crate::orchestrator::graph::Graph;
use crate::orchestrator::error::NodeError;
use crate::orchestrator::handles::{LlmHandle, MemLayer, MemoryHandle, NoopMemory, Request};
use crate::orchestrator::memory_store::LayeredMemoryStore;
use crate::orchestrator::node::OrchestratorNode;
use crate::orchestrator::router::RouterNode;
use crate::orchestrator::types::{NodeMeta, NodeResult, Port, Usage};

// ══ M4：四层记忆（§7）════════════════════════════════════

#[tokio::test]
async fn M4_四层写入与跨层关键词召回() {
    let store = LayeredMemoryStore::new(5);
    store.put(MemLayer::Episodic, "run@1", "上午给订单服务加了幂等键");
    store.put(MemLayer::Semantic, "spec/错误码", "订单服务错误码以 4 开头");
    store.put(MemLayer::Procedural, "route/先例", "幂等键任务路由到 Plan-and-Execute");

    // 关键词召回跨层命中（设计 7.2：检索按任务相关性，不按层级隔离）
    let hits = store.recall_keyword("幂等键");
    assert_eq!(hits.len(), 2, "情景 + 程序性两处命中");
    // 无关词零召回
    assert!(store.recall_keyword("量子纠缠").is_empty());
}

#[tokio::test]
async fn M4_任务终局归档点写入情景与程序性记忆() {
    // 设计 7.3：任务终局（RunReport 产出）归档情景记忆 + 治理台账程序性记忆
    let store = Arc::new(LayeredMemoryStore::new(5));
    // 造一份 RunReport：直接经最小图跑出
    struct Intent {
        id: String,
    }
    #[async_trait::async_trait]
    impl OrchestratorNode for Intent {
        fn id(&self) -> &str {
            &self.id
        }
        fn meta(&self) -> &NodeMeta {
            static M: std::sync::OnceLock<NodeMeta> = std::sync::OnceLock::new();
            M.get_or_init(|| NodeMeta::without_llm("ingress", "入口"))
        }
        fn outputs(&self) -> &[Port] {
            static OUTS: std::sync::OnceLock<Vec<Port>> = std::sync::OnceLock::new();
            OUTS.get_or_init(|| vec![Port::Done])
        }
        async fn execute(&self, ctx: &mut crate::orchestrator::context::NodeCtx<'_>) -> Result<NodeResult, NodeError> {
            ctx.state.write("task.intent", "归档验证任务");
            ctx.state.write("result.draft", "归档验证结果");
            Ok(NodeResult { port: Port::Done, usage: Usage::of(3, 4), progress: None })
        }
    }
    let g = Graph::build(
        vec![Box::new(Intent { id: "ingress".into() })],
        vec![],
        "ingress",
    )
    .unwrap();
    let orch = DefaultOrchestrator::new(
        &g,
        Arc::new(crate::orchestrator::handles::test_support::ScriptedLlm::of_texts(&["x"])),
        store.clone() as Arc<dyn MemoryHandle>,
        RunConfig::default(),
    );
    let report = orch.run().await.unwrap();
    assert!(report.is_done());

    // 归档点：情景（链路+结果）+ 程序性（治理台账）
    store.archive_run(&report, "single_agent");
    assert_eq!(store.layer_len(MemLayer::Episodic), 1, "情景记忆归档");
    assert_eq!(store.layer_len(MemLayer::Procedural), 1, "治理台账程序性记忆");
    let hits = store.recall_keyword("归档验证结果");
    assert!(!hits.is_empty(), "归档内容可被召回——「下次遇到类似任务能想起来」");
}

#[tokio::test]
async fn M4_Router_few_shot从程序性记忆动态加载() {
    let store = Arc::new(LayeredMemoryStore::new(5));
    store.put(MemLayer::Procedural, "修个 Bug", "bug");
    store.put(MemLayer::Procedural, "加个新功能", "feature");

    let store2 = store.clone();
    let router = RouterNode::new(
        "node",
        "分类提示",
        vec!["bug".into(), "feature".into()],
        0.8,
    )
    .with_few_shot_provider(Arc::new(move || store2.procedural_few_shot(3)));
    let g = Graph::build(
        vec![Box::new(router)],
        vec![],
        "node",
    )
    .unwrap();
    // 脚本响应验证 few-shot 注入后的分类正常
    let llm = Arc::new(crate::orchestrator::handles::test_support::ScriptedLlm::of_texts(&[
        r#"{"label":"bug","confidence":0.9,"reason":"先例匹配"}"#,
    ]));
    let orch = DefaultOrchestrator::new(&g, llm, Arc::new(NoopMemory), RunConfig::default());
    let report = orch.run().await.unwrap();
    // 单节点图 Branch 无出边 → 悬空 Governed；分发正确性看端口（高置信 bug）
    assert_eq!(report.steps.last().unwrap().port, Port::Branch("bug".into()));
}

#[tokio::test]
async fn M4_记忆快照往返宿主持久化契约() {
    let store = LayeredMemoryStore::new(5);
    store.put(MemLayer::Semantic, "k", "跨会话知识");
    let snap = store.snapshot();
    let store2 = LayeredMemoryStore::new(5);
    store2.restore(snap);
    assert_eq!(store2.layer_len(MemLayer::Semantic), 1);
    assert!(!store2.recall_keyword("跨会话").is_empty());
}

// ══ M5：GenaiAdapter（§8）════════════════════════════════

/// kernel Backend 测试桩：记录 prompt 并回固定响应
struct MockKernelBackend {
    last_prompt: std::sync::Mutex<Option<String>>,
    text: String,
}

#[async_trait::async_trait]
impl agent_kernel::backend::NodeBackendAccessor for MockKernelBackend {
    async fn prompt(
        &self,
        prompt: String,
        _options: Option<agent_kernel::backend::PromptCallOptions>,
    ) -> Result<agent_kernel::backend::PromptResponse, agent_kernel::backend::BackendError> {
        *self.last_prompt.lock().unwrap() = Some(prompt);
        Ok(agent_kernel::backend::PromptResponse {
            text: self.text.clone(),
            tool_calls: vec![],
            input_tokens: Some(11),
            output_tokens: Some(22),
            stop_reason: Some("stop".into()),
            reasoning: None,
        })
    }
    async fn get_messages(&self) -> Vec<agent_kernel::types::OrchestratorMessage> {
        Vec::new()
    }
    async fn set_messages(
        &self,
        _messages: Vec<agent_kernel::types::OrchestratorMessage>,
    ) -> Result<(), agent_kernel::backend::BackendError> {
        Ok(())
    }
    async fn trim_context(&self, _up_to_index: usize) -> Result<(), agent_kernel::backend::BackendError> {
        Ok(())
    }
}

#[tokio::test]
async fn M5_KernelBackend适配complete与用量口径统一() {
    // 分层验收（设计 8.4）：换 Provider（kernel 侧）上层零改动——上层只认 LlmHandle
    let backend = Arc::new(MockKernelBackend { last_prompt: std::sync::Mutex::new(None), text: "kernel 响应".into() });
    let llm = KernelBackendLlm::new(backend.clone() as Arc<dyn agent_kernel::backend::NodeBackendAccessor>);

    let resp = llm
        .complete(&Request::new("系统提示", "用户输入"))
        .await
        .unwrap();
    assert_eq!(resp.text, "kernel 响应");
    // 用量计量口径统一（设计 8.3 职责 5）：kernel Option<u32> → Usage u64，llm_calls=1
    assert_eq!(resp.usage.input_tokens, 11);
    assert_eq!(resp.usage.output_tokens, 22);
    assert_eq!(resp.usage.llm_calls, 1);
    // system+user 拼接透传
    let last = backend.last_prompt.lock().unwrap().clone().unwrap();
    assert!(last.contains("系统提示") && last.contains("用户输入"));

    // 全链路：适配器驱动的 Single Agent 图端到端（上层零改动验证）
    struct Solve {
        id: String,
        llm: Arc<dyn LlmHandle>,
    }
    #[async_trait::async_trait]
    impl OrchestratorNode for Solve {
        fn id(&self) -> &str {
            &self.id
        }
        fn meta(&self) -> &NodeMeta {
            static M: std::sync::OnceLock<NodeMeta> = std::sync::OnceLock::new();
            M.get_or_init(|| NodeMeta::new("single_agent", "solve"))
        }
        fn outputs(&self) -> &[Port] {
            static OUTS: std::sync::OnceLock<Vec<Port>> = std::sync::OnceLock::new();
            OUTS.get_or_init(|| vec![Port::Done, Port::Fatal("llm".into())])
        }
        async fn execute(&self, ctx: &mut crate::orchestrator::context::NodeCtx<'_>) -> Result<NodeResult, NodeError> {
            let intent = ctx.state.read("task.intent").and_then(|v| v.as_str().map(|s| s.to_string())).unwrap_or_default();
            let resp = self.llm.complete(&Request::new("s", intent)).await.map_err(crate::orchestrator::error::NodeError::from)?;
            ctx.state.write("result.draft", resp.text);
            Ok(NodeResult { port: Port::Done, usage: resp.usage, progress: None })
        }
    }
    let solve = Solve { id: "solve".into(), llm: Arc::new(llm) };
    let g = Graph::build(
        vec![Box::new(solve)],
        vec![],
        "solve",
    )
    .unwrap();
    let orch = DefaultOrchestrator::new(&g, Arc::new(crate::orchestrator::handles::test_support::NullLlm), Arc::new(NoopMemory), RunConfig::default());
    let report = orch.run().await.unwrap();
    assert!(report.is_done());
    assert_eq!(report.result_text().as_deref(), Some("kernel 响应"));
}
