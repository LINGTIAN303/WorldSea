//! 事件总线（A1 提取融合 · 第二步：换签名 + key 注册 + 三模式分发）
//!
//! 详细见 docs/plans/2026-09-16-deepseek-harness-方向探究/06-事件总线设计草案.md。
//! 第一步（`EventBroadcaster` 内嵌等价形态）零行为变更；本步引入：
//! - [`Listener`]：替代 `EventListener`，带模式化返回值（[`Listener::call`] + [`Listener::call_waterfall`]）
//! - key 注册：[`EventBus::on`]（精确）/ [`EventBus::on_any`]（全量）
//! - 三模式分发：`emit` / `bail` / `waterfall`（同步 `Next` 环绕）
//!
//! serial / parallel 分发与可逆注销（Disposer）待有场景时补（06-§四；施工纪律"无立项理由不做"）。

use std::sync::atomic::{AtomicU8, Ordering};
use std::sync::Arc;

use crate::event::{EventKey, OrchestratorEvent};

/// 事件分发模式（S3-b：类型定义迁至 agent-engine::contracts——单一定义处，此处只读引用）
///
/// 模式声明见 [`crate::event::mode_of`]；`Serial` / `Parallel` 分发方法待有场景时补，声明层先保留。
pub use agent_engine::contracts::DispatchMode;

/// 分发递归深度上限（重入防护；06 草案 U5 裁定为常量，不做配置项）
pub const MAX_DISPATCH_DEPTH: u8 = 8;

/// 监听器（替代 `EventListener`；06 草案 §3.3）
///
/// - [`Listener::call`]：普通模式入口（emit / bail 分发时调用），返回是否否决
/// - [`Listener::call_waterfall`]：waterfall 专用入口，末参 `next` 为链下游；
///   调用 `next.run(ev)` 放行、不调即否决（默认实现即"透传放行"）
pub trait Listener: Send + Sync {
    /// 普通模式入口
    fn call(&self, event: &OrchestratorEvent) -> ListenerOutcome;

    /// waterfall 入口：默认透传（不参与拦截的监听器无需实现）
    fn call_waterfall(&self, event: &mut OrchestratorEvent, next: Next<'_>) -> Outcome {
        next.run(event)
    }
}

/// 普通模式分发结果（对齐 dsh `isBailed`：非空即否决——Rust 侧以枚举显式化）
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ListenerOutcome {
    /// 继续分发（默认）
    Continue,
    /// 否决：bail 分发时短路后续监听器
    Bail,
}

/// waterfall 链结果（最外层监听器的返回值）
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Outcome {
    /// 链正常走完（含链尾内建行为）
    Ok,
    /// 被否决（某监听器未调 `next` 且返回本值）
    Vetoed,
}

/// waterfall 链的下游续体（"末参 next"，06 草案 §3.3）
///
/// 不调 [`Next::run`] 即否决；调用则以 `&mut` 事件继续下游——
/// `&mut OrchestratorEvent` 即"可改写负载"位点（05 §2.4 缺口契约，裁剪迁移前置）。
pub struct Next<'a> {
    /// 本次分发的监听器快照（已按 key 过滤、注册顺序）
    chain: &'a [Arc<dyn Listener>],
    /// 下一个待考察的监听器下标
    idx: usize,
    /// 链尾内建默认行为（调用方提供；对应 dsh 的 innermost next）
    inner: Box<dyn FnOnce(&mut OrchestratorEvent) -> Outcome + 'a>,
}

impl<'a> Next<'a> {
    /// 调用下游（链尾为内建默认行为）
    pub fn run(self, event: &mut OrchestratorEvent) -> Outcome {
        run_waterfall_chain(self.chain, self.idx, event, self.inner)
    }
}

/// 监听器注册条目
struct ListenerEntry {
    /// `None` = 全量订阅（on_any）；`Some` = 精确订阅（on）
    key: Option<EventKey>,
    listener: Arc<dyn Listener>,
}

impl ListenerEntry {
    /// 该条目是否接收 `key` 的分发（全量条目恒真）
    fn matches(&self, key: EventKey) -> bool {
        match self.key {
            None => true,
            Some(k) => k == key,
        }
    }
}

/// 分发深度守卫（RAII：正常返回与 panic 展开都会归还深度计数）
struct DepthGuard<'a>(&'a AtomicU8);

impl Drop for DepthGuard<'_> {
    fn drop(&mut self) {
        self.0.fetch_sub(1, Ordering::AcqRel);
    }
}

/// 事件总线 —— 注册顺序即分发顺序、0 监听器静默
///
/// **锁纪律（2026-09-17 风险点处置）**：监听器表在内部（`std::sync::RwLock`，只护表、
/// 临界区极短）；分发入口先取**快照**，再于**不持任何表锁**的前提下运行监听器链——
/// 故链内可安全注册（延后到下一轮，C3 copy-on-write 语义）、可执行长 I/O，不阻滞写者。
/// 外壳 [`crate::event::EventBroadcaster`] 的调度方（AgentLoop / GenaiBackend 等）
/// 取到 [`Arc<EventBus>`] 句柄后**先释放外包锁**再分发，同一保证对会话级广播成立。
#[derive(Default)]
pub struct EventBus {
    /// 监听器表（内部可变：注册经 `&self`，无须外层可变引用）
    listeners: std::sync::RwLock<Vec<ListenerEntry>>,
    /// 当前分发递归深度（分发中重入分发的成环防护）
    depth: AtomicU8,
}

impl EventBus {
    /// 新建空总线
    pub fn new() -> Self {
        Self::default()
    }

    /// 全量订阅（等价既有 `subscribe`；同一实例 `Arc::ptr_eq` 幂等去重）
    ///
    /// 返回 `true` 表示新增，`false` 表示已存在（幂等跳过）。
    pub fn on_any(&self, listener: Arc<dyn Listener>) -> bool {
        self.register(None, listener)
    }

    /// 精确订阅（仅接收 `key` 的分发；判重同上但按 `(key, 实例)` 计）
    pub fn on(&self, key: EventKey, listener: Arc<dyn Listener>) -> bool {
        self.register(Some(key), listener)
    }

    /// 注册（判重单位：同 key + 同实例；全量 key 为 `None`）
    fn register(&self, key: Option<EventKey>, listener: Arc<dyn Listener>) -> bool {
        let Ok(mut ls) = self.listeners.write() else {
            // 表锁中毒：静默拒绝（与 droppable 风格一致，不 panic 波及 UI 线程）
            return false;
        };
        if ls
            .iter()
            .any(|e| e.key == key && Arc::ptr_eq(&e.listener, &listener))
        {
            return false;
        }
        ls.push(ListenerEntry { key, listener });
        true
    }

    /// 取命中 `key` 的监听器快照（短临界区；分发即在快照上运行——C3）
    fn snapshot(&self, key: EventKey) -> Vec<Arc<dyn Listener>> {
        match self.listeners.read() {
            Ok(ls) => ls
                .iter()
                .filter(|e| e.matches(key))
                .map(|e| Arc::clone(&e.listener))
                .collect(),
            Err(_) => Vec::new(),
        }
    }

    /// 已注册监听器数（诊断用）
    pub fn len(&self) -> usize {
        self.listeners.read().map(|l| l.len()).unwrap_or(0)
    }

    /// 是否无监听器
    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }

    /// 同步扇出、忽略返回值（既有 broadcast 语义）
    pub fn emit(&self, event: &OrchestratorEvent) {
        if !self.enter("emit") {
            return;
        }
        let _guard = DepthGuard(&self.depth);
        let chain = self.snapshot(event.key());
        for listener in &chain {
            listener.call(event);
        }
    }

    /// 同步串行、首个否决短路（dsh: bail）
    ///
    /// 返回 `true` 表示被某监听器否决（其后的监听器不再收到该事件）。
    pub fn bail(&self, event: &OrchestratorEvent) -> bool {
        if !self.enter("bail") {
            return false;
        }
        let _guard = DepthGuard(&self.depth);
        let chain = self.snapshot(event.key());
        for listener in &chain {
            if listener.call(event) == ListenerOutcome::Bail {
                return true;
            }
        }
        false
    }

    /// 环绕中间件：监听器链包裹链尾内建行为（dsh: waterfall）
    ///
    /// `inner` = 链尾内建行为（全部监听器放行后执行）；监听器不调 `next` 即否决。
    /// 链顺序 = 注册顺序（外层到内层），与 `emit` 的调用顺序一致。
    pub fn waterfall<'a>(
        &self,
        event: &mut OrchestratorEvent,
        inner: impl FnOnce(&mut OrchestratorEvent) -> Outcome + 'a,
    ) -> Outcome {
        if !self.enter("waterfall") {
            return Outcome::Vetoed;
        }
        let _guard = DepthGuard(&self.depth);
        let chain = self.snapshot(event.key());
        run_waterfall_chain(&chain, 0, event, Box::new(inner))
    }

    /// 分发入口的深度计数（超限丢弃 + `warn!`，返回 `false` 表示应丢弃）
    fn enter(&self, mode: &'static str) -> bool {
        let entered = self.depth.fetch_add(1, Ordering::AcqRel);
        if entered >= MAX_DISPATCH_DEPTH {
            // 超限：立即归还深度并丢弃（不遍历监听器）
            self.depth.fetch_sub(1, Ordering::AcqRel);
            tracing::warn!(
                mode,
                depth = entered,
                max = MAX_DISPATCH_DEPTH,
                "事件分发深度达上限，丢弃本次分发（疑似成环）"
            );
            return false;
        }
        true
    }
}

/// waterfall 链行进（[`Next::run`] 的落点）
///
/// **不计深度**：链行进是单次分发的内在展开，只有分发入口
/// （emit / bail / waterfall）计深度——否则长链会误触深度上限。
fn run_waterfall_chain<'a>(
    chain: &'a [Arc<dyn Listener>],
    start: usize,
    event: &mut OrchestratorEvent,
    inner: Box<dyn FnOnce(&mut OrchestratorEvent) -> Outcome + 'a>,
) -> Outcome {
    match chain.get(start) {
        Some(listener) => {
            let next = Next {
                chain,
                idx: start + 1,
                inner,
            };
            listener.call_waterfall(event, next)
        }
        None => inner(event),
    }
}

#[cfg(test)]
impl EventBus {
    /// 测试用：直接注入当前分发深度（模拟"已在重入中"的状态）
    fn inject_depth(&self, depth: u8) {
        self.depth.store(depth, Ordering::SeqCst);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::event::AgentEvent;
    use crate::types::PlanItemStatus;
    use std::sync::atomic::AtomicUsize;
    use std::sync::Mutex;

    // ─── 测试监听器 ───────────────────────────────

    /// 计数监听器
    struct CountListener {
        count: Arc<AtomicUsize>,
    }

    impl Listener for CountListener {
        fn call(&self, _event: &OrchestratorEvent) -> ListenerOutcome {
            self.count.fetch_add(1, Ordering::SeqCst);
            ListenerOutcome::Continue
        }
    }

    /// 记录分发顺序的监听器
    struct OrderListener {
        tag: &'static str,
        log: Arc<Mutex<Vec<&'static str>>>,
    }

    impl Listener for OrderListener {
        fn call(&self, _event: &OrchestratorEvent) -> ListenerOutcome {
            self.log.lock().unwrap().push(self.tag);
            ListenerOutcome::Continue
        }
    }

    /// 否决监听器（bail 用）
    struct VetoListener;

    impl Listener for VetoListener {
        fn call(&self, _event: &OrchestratorEvent) -> ListenerOutcome {
            ListenerOutcome::Bail
        }
    }

    /// waterfall 环绕监听器：进入/退出各记一笔，放行下游
    struct WrapListener {
        tag: &'static str,
        log: Arc<Mutex<Vec<&'static str>>>,
        /// true = 不调 next（否决）
        veto: bool,
    }

    impl Listener for WrapListener {
        fn call(&self, _event: &OrchestratorEvent) -> ListenerOutcome {
            ListenerOutcome::Continue
        }

        fn call_waterfall(&self, event: &mut OrchestratorEvent, next: Next<'_>) -> Outcome {
            self.log.lock().unwrap().push(self.tag);
            if self.veto {
                return Outcome::Vetoed;
            }
            let out = next.run(event);
            self.log.lock().unwrap().push(match self.tag {
                "wrap" => "wrap-out",
                _ => "tail-out",
            });
            out
        }
    }

    /// 样本事件：Agent 族（key = "agent_end"）
    fn sample_event() -> OrchestratorEvent {
        OrchestratorEvent::Agent(AgentEvent::AgentEnd)
    }

    /// 样本事件：Plan 族（key = "plan_created"）
    fn plan_event() -> OrchestratorEvent {
        OrchestratorEvent::PlanCreated { items: vec![] }
    }

    // ─── 注册与分发基础契约 ───────────────────────

    /// 注册顺序 = 分发顺序
    #[test]
    fn on_preserves_registration_order() {
        let bus = EventBus::new();
        let log = Arc::new(Mutex::new(Vec::new()));
        bus.on_any(Arc::new(OrderListener {
            tag: "first",
            log: log.clone(),
        }));
        bus.on_any(Arc::new(OrderListener {
            tag: "second",
            log: log.clone(),
        }));

        bus.emit(&sample_event());

        assert_eq!(*log.lock().unwrap(), vec!["first", "second"]);
    }

    /// 0 监听器静默（不 panic、无副作用）
    #[test]
    fn emit_without_listeners_is_silent() {
        let bus = EventBus::new();
        assert!(bus.is_empty());
        bus.emit(&sample_event());
    }

    /// 同一实例重复注册幂等（Arc::ptr_eq 去重）
    #[test]
    fn on_dedupes_same_instance() {
        let bus = EventBus::new();
        let count = Arc::new(AtomicUsize::new(0));
        let listener: Arc<dyn Listener> = Arc::new(CountListener {
            count: count.clone(),
        });

        assert!(bus.on_any(listener.clone()));
        assert!(!bus.on_any(listener), "同一实例二次注册应幂等跳过");
        assert_eq!(bus.len(), 1);

        bus.emit(&sample_event());
        assert_eq!(count.load(Ordering::SeqCst), 1, "去重后只应分发一次");
    }

    /// 判重按 (key, 实例) 计：同实例可同时挂全量与精确两个条目
    #[test]
    fn register_dedupe_is_per_key() {
        let bus = EventBus::new();
        let count = Arc::new(AtomicUsize::new(0));
        let listener: Arc<dyn Listener> = Arc::new(CountListener {
            count: count.clone(),
        });

        assert!(bus.on_any(listener.clone()));
        assert!(
            bus.on("plan_created", listener.clone()),
            "同实例换 key 注册应视为新条目"
        );
        assert!(!bus.on("plan_created", listener), "同 key 二次注册应幂等");
        assert_eq!(bus.len(), 2);
    }

    /// 不同实例各自收到一份（模拟"每会话一个 emitter"的会话隔离契约）
    #[test]
    fn distinct_instances_each_receive_one_copy() {
        let bus = EventBus::new();
        let first = Arc::new(AtomicUsize::new(0));
        let second = Arc::new(AtomicUsize::new(0));
        bus.on_any(Arc::new(CountListener {
            count: first.clone(),
        }));
        bus.on_any(Arc::new(CountListener {
            count: second.clone(),
        }));

        bus.emit(&sample_event());

        assert_eq!(first.load(Ordering::SeqCst), 1);
        assert_eq!(second.load(Ordering::SeqCst), 1);
    }

    /// 深度达上限即丢弃分发（防 emit 中 emit 成环）
    #[test]
    fn emit_drops_when_depth_at_limit() {
        let bus = EventBus::new();
        let count = Arc::new(AtomicUsize::new(0));
        bus.on_any(Arc::new(CountListener {
            count: count.clone(),
        }));

        bus.inject_depth(MAX_DISPATCH_DEPTH);
        bus.emit(&sample_event());

        assert_eq!(count.load(Ordering::SeqCst), 0, "达上限应丢弃分发");
        assert_eq!(
            bus.depth.load(Ordering::SeqCst),
            MAX_DISPATCH_DEPTH,
            "丢弃后深度应归还"
        );
    }

    // ─── key 过滤 ─────────────────────────────────

    /// 精确订阅只收本 key 的事件
    #[test]
    fn keyed_listener_receives_only_its_key() {
        let bus = EventBus::new();
        let count = Arc::new(AtomicUsize::new(0));
        bus.on(
            "plan_created",
            Arc::new(CountListener {
                count: count.clone(),
            }),
        );

        bus.emit(&sample_event());
        assert_eq!(count.load(Ordering::SeqCst), 0, "异 key 不应分发");

        bus.emit(&plan_event());
        assert_eq!(count.load(Ordering::SeqCst), 1, "同 key 应分发");
    }

    /// 全量订阅者收所有 key 的事件
    #[test]
    fn on_any_receives_all_keys() {
        let bus = EventBus::new();
        let count = Arc::new(AtomicUsize::new(0));
        bus.on_any(Arc::new(CountListener {
            count: count.clone(),
        }));

        bus.emit(&sample_event());
        bus.emit(&plan_event());

        assert_eq!(count.load(Ordering::SeqCst), 2);
    }

    // ─── bail 分发 ────────────────────────────────

    /// bail：首个否决后短路，其后监听器不再收到
    #[test]
    fn bail_short_circuits_after_first_veto() {
        let bus = EventBus::new();
        let log = Arc::new(Mutex::new(Vec::new()));
        bus.on_any(Arc::new(OrderListener {
            tag: "before",
            log: log.clone(),
        }));
        bus.on_any(Arc::new(VetoListener));
        bus.on_any(Arc::new(OrderListener {
            tag: "after",
            log: log.clone(),
        }));

        let bailed = bus.bail(&sample_event());

        assert!(bailed, "应报告被否决");
        assert_eq!(*log.lock().unwrap(), vec!["before"], "否决后不应继续");
    }

    /// bail：无人否决时全员收到且返回 false
    #[test]
    fn bail_returns_false_when_nobody_vetoes() {
        let bus = EventBus::new();
        let count = Arc::new(AtomicUsize::new(0));
        bus.on_any(Arc::new(CountListener {
            count: count.clone(),
        }));

        assert!(!bus.bail(&sample_event()));
        assert_eq!(count.load(Ordering::SeqCst), 1);
    }

    // ─── waterfall 分发 ───────────────────────────

    /// waterfall：注册顺序即环绕顺序（外层到内层），链尾执行内建行为
    #[test]
    fn waterfall_wraps_inner_in_registration_order() {
        let bus = EventBus::new();
        let log = Arc::new(Mutex::new(Vec::new()));
        bus.on_any(Arc::new(WrapListener {
            tag: "wrap",
            log: log.clone(),
            veto: false,
        }));

        let out = bus.waterfall(&mut sample_event(), |_ev| {
            log.lock().unwrap().push("inner");
            Outcome::Ok
        });

        assert_eq!(out, Outcome::Ok);
        assert_eq!(
            *log.lock().unwrap(),
            vec!["wrap", "inner", "wrap-out"],
            "应环绕链尾内建行为"
        );
    }

    /// waterfall：不调 next 即否决，链尾不执行
    #[test]
    fn waterfall_veto_skips_inner() {
        let bus = EventBus::new();
        let log = Arc::new(Mutex::new(Vec::new()));
        bus.on_any(Arc::new(WrapListener {
            tag: "wrap",
            log: log.clone(),
            veto: true,
        }));

        let out = bus.waterfall(&mut sample_event(), |_ev| {
            log.lock().unwrap().push("inner");
            Outcome::Ok
        });

        assert_eq!(out, Outcome::Vetoed);
        assert_eq!(*log.lock().unwrap(), vec!["wrap"], "否决后不应到链尾");
    }

    /// waterfall：可改写事件载荷（`&mut` 即"可改写负载"位点，裁剪迁移前置契约）
    #[test]
    fn waterfall_listener_can_rewrite_payload() {
        let bus = EventBus::new();

        struct CropListener;
        impl Listener for CropListener {
            fn call(&self, _event: &OrchestratorEvent) -> ListenerOutcome {
                ListenerOutcome::Continue
            }
            fn call_waterfall(&self, event: &mut OrchestratorEvent, next: Next<'_>) -> Outcome {
                if let OrchestratorEvent::PlanStepUpdate { output, .. } = event {
                    *output = Some("[已裁剪]".to_string());
                }
                next.run(event)
            }
        }

        bus.on_any(Arc::new(CropListener));

        let mut ev = OrchestratorEvent::PlanStepUpdate {
            step_id: "s1".to_string(),
            status: PlanItemStatus::Completed,
            output: Some("原始长文本".to_string()),
        };
        let observed = Arc::new(Mutex::new(None));
        let observed_inner = observed.clone();
        let out = bus.waterfall(&mut ev, move |ev| {
            if let OrchestratorEvent::PlanStepUpdate { output, .. } = ev {
                *observed_inner.lock().unwrap() = output.clone();
            }
            Outcome::Ok
        });

        assert_eq!(out, Outcome::Ok);
        assert_eq!(
            *observed.lock().unwrap(),
            Some("[已裁剪]".to_string()),
            "链尾应看到被改写的载荷"
        );
    }

    /// waterfall：链含全量订阅者与精确订阅者（按注册顺序）
    #[test]
    fn waterfall_chain_includes_on_any_listeners() {
        let bus = EventBus::new();
        let log = Arc::new(Mutex::new(Vec::new()));
        bus.on_any(Arc::new(WrapListener {
            tag: "wrap",
            log: log.clone(),
            veto: false,
        }));
        bus.on(
            "plan_created",
            Arc::new(WrapListener {
                tag: "tail",
                log: log.clone(),
                veto: false,
            }),
        );

        let out = bus.waterfall(&mut plan_event(), |_ev| {
            log.lock().unwrap().push("inner");
            Outcome::Ok
        });

        assert_eq!(out, Outcome::Ok);
        assert_eq!(
            *log.lock().unwrap(),
            vec!["wrap", "tail", "inner", "tail-out", "wrap-out"]
        );
    }

    /// waterfall：链行进递归不触发深度上限（长链不误伤）
    #[test]
    fn waterfall_long_chain_does_not_hit_depth_limit() {
        let bus = EventBus::new();
        let count = Arc::new(AtomicUsize::new(0));

        struct PassListener {
            count: Arc<AtomicUsize>,
        }
        impl Listener for PassListener {
            fn call(&self, _event: &OrchestratorEvent) -> ListenerOutcome {
                ListenerOutcome::Continue
            }
            fn call_waterfall(&self, event: &mut OrchestratorEvent, next: Next<'_>) -> Outcome {
                self.count.fetch_add(1, Ordering::SeqCst);
                next.run(event)
            }
        }

        // 链长 12 > MAX_DISPATCH_DEPTH(8)：若链行进计深度会误触上限
        for _ in 0..12 {
            bus.on_any(Arc::new(PassListener {
                count: count.clone(),
            }));
        }

        let out = bus.waterfall(&mut sample_event(), |_ev| Outcome::Ok);

        assert_eq!(out, Outcome::Ok);
        assert_eq!(count.load(Ordering::SeqCst), 12, "长链应全部走完");
    }
}