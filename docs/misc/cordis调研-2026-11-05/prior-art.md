# 先例审计：Cordis 两条轴（可逆副作用 + 反应式依赖）是否"史无前例"

> 任务：task-2。不预设结论，正面寻找反例。
> 时间：2026-11-05。审计者：prior-art-hunter。
> 审计对象：Cordis 所称的"时空可组合性"= 时间轴（可回滚副作用 / LIFO 结构化 teardown）+ 空间轴（反应式依赖驱动组件生命周期）统一进一个运行时 context。
> 方法：一手文档 / 规范原文 / 论文 PDF / 源码；每条给出可点击链接与原文关键句。**检索不到的一律写"未检索到"，不写"不存在"。**

---

## 零、结论先行

### 0.1 最重要的一条前置事实（会改变整个命题）

**该论文本身没有使用 "first / unprecedented / novel / 史无前例" 一类强断言。**

在本地 `paper.pdf`（92 页）全文检索以下字符串，**全部零命中**：

| 检索串 | 命中页 |
|---|---|
| `to our knowledge` | 无 |
| `we are the first` | 无 |
| `the first to` | 无 |
| `first formal` | 无 |
| `first system` | 无 |
| `no prior` | 无 |
| `no existing` | 无 |
| `unprecedented` | 无 |
| `novel` | 无 |

摘要（p.1）的新颖性表述是功能性的，不是排他性的：

> "Modern software—from plugin systems to self-evolving agent harnesses—increasingly requires dynamic composition, yet **its formal foundations remain underdeveloped**. We identify two orthogonal dimensions of the problem..."

论文 §7 Related Work 通篇用 "The closest precedent to our reactive coeffects reacts to service availability"（§7.4，p.82）这类**承认式**措辞，而不是"无人做过"。

**结论：如果二手报告把"史无前例 / 首次系统化"当作论文的主张，那是转述走形。论文自己主张的是"这两条轴的形式化基础不足（underdeveloped）"，而非"机制从未存在"。**（对照核验见 task-1 产出 `paper.md`；本条只基于本地 PDF 原文。）

### 0.2 分层判定表

| 层 | 判据 | 判定 | 依据 |
|---|---|---|---|
| **(a) 机制是否存在**（依赖图驱动生命周期 + 可逆 teardown 同时具备） | 两者在同一系统内共存 | **"史无前例"不成立，明确被推翻** | **≥6 个系统在 (a) 层已同时具备**：integrant、Stuart Sierra Component、Spring（contains + RefreshScope）、OSGi Declarative Services、iPOJO、Kevoree/Aeolus（部署侧）。其中 **integrant 与 OSGi DS 做得最完整** |
| **(b) 是否有形式化**（观测等价 / independence / commutativity / confluence 的定理与证明），且**针对"可逆效果 + 反应式 coeffect"这一统一对象** | 有定理 + 证明 | **部分层已被先例占据，但"这一组合"未检索到** | 已占据：ICFP 2016 graded effect+coeffect（类型层统一，有分配律模型）；可逆进程演算的因果一致性（RCCS / Phillips-Ulidowski / Giachino）；图重写的合流性（critical pair analysis，Wermelinger、Krause/Reo）；Aeolus 的可达性/不可判定性定理。**缺口**：上述三条从未被合成到"运行时组件生命周期"这一个对象上 |
| **(c) 语言无关的运行时 overlay**（不要求改写整个程序） | 不侵入宿主代码 | **不成立，被推翻** | integrant / Component / OSGi DS / Spring 全都是 overlay；Component 唯一的 (c) 缺口是"retrofit 到既存应用需大改"（自有原文承认），但 integrant 明确针对此点做了改进 |
| **(d) 把整个 agent harness（含 agent loop）做成可热替换插件树** | agent loop 本身是插件 | **未检索到反例**（这是真正的新颖落点） | 已核：`dsh-agent-loop` 经 `ctx.effect(() => ctx.agents.setFactory(this))` 注册，卸载即空槽；论文自己的 case study 是 Koishi（聊天机器人），且论文结语把 agent harness 列为**未来验证方向**而非已完成 |

### 0.3 一句话结论

> **新颖性不可能落在 (a)（机制层，早被 integrant / OSGi DS 做到），也很难落在 (c)（overlay 形态是 Clojure / OSGi / Spring 的常态）。真正还能站住的是 (b) 的这一个特定组合——"把 effect 与 coeffect 从编译期类型层搬到运行时机制层，并对这一统一对象给出观测等价 / independence / confluence 的定理"——以及 (d) 的工程事实（agent loop 本身可热替换）。"史无前例 / 首次系统化"作为一个不加限定的整体命题，是错的；作为 (b)+(d) 的限定命题，目前未检索到反例。**

---

## 一、判定标准的分层定义（本审计使用的口径）

必须先说清"做到哪一步"，否则各说各话。

- **(a) 机制存在**：系统内同时具备
  - (a-1) 依赖图/声明式依赖驱动生命周期（依赖不满足则不激活；依赖消失则停用）
  - (a-2) 结构化、逆序（或至少与启动对称）的拆除；且拆除是"由运行时持有并执行"而非完全靠作者自觉
- **(b) 形式化**：对上述机制给出定理与证明，典型是可观测等价（observational equivalence）、独立性/交换性（independence / commutativity）、保持性（preservation）、进展（progress）、合流（confluence）。
- **(c) overlay**：不要求把整个程序改写成某种效果类型（monad/effect row），能在普通宿主代码上运行。
- **(d) agent harness 整体可热替换**：含 agent loop / 工具注册 / 会话日志在内的整棵插件树可运行时装卸。

**注意**：(a) 与 (b)(c)(d) 不可混为一谈。"机制早就有了"不代表"形式化早就有了"，反之亦然。以下按层给证据。

---

## 二、先例总表（11 组 + 追加组）

| # | 系统 | 时间 | (a-1) 依赖驱动生命周期 | (a-2) 可逆/逆序 teardown | (b) 形式化 | (c) overlay | (d) agent harness | 来源 |
|---|---|---|---|---|---|---|---|---|
| 1 | **Clojure integrant** | 2016– | ✅ 配置 `ig/ref` + 拓扑排序 | ✅ **逆依赖序 halt!**；且 halt 幂等；suspend/resume 可复用资源 | ❌ 无定理 | ✅ 数据驱动，不改宿主代码 | ❌ | [README](https://github.com/weavejester/integrant) |
| 2 | **Stuart Sierra Component** | 2013– | ✅ 显式依赖图，禁止环 | ✅ stop 逆序（"deps not stopped until AFTER it is stopped"） | ❌ | ⚠️ 需 retrofit，"not easy" | ❌ | [README](https://github.com/stuartsierra/component) |
| 3 | **mount** | 2015– | ⚠️ 靠 namespace `require` 顺序（编译器保证），非显式图 | ✅ stop = reverse(start order) | ❌ | ✅ | ❌ | [README](https://github.com/tolitius/mount) |
| 4 | **Spring 容器** | 2003– | ✅ `depends-on` | ✅ **逆序 destroy**；dependents 先于 provider 销毁 | ❌ 无定理（行为有文档、无证明） | ✅ | ❌ | [depends-on 文档](https://docs.spring.io/spring-framework/reference/core/beans/dependencies/factory-dependson.html) / [DefaultSingletonBeanRegistry](https://github.com/spring-projects/spring-framework/blob/main/spring-beans/src/main/java/org/springframework/beans/factory/support/DefaultSingletonBeanRegistry.java) |
| 5 | **Spring Cloud RefreshScope** | 2013– | ✅ 运行期配置变更 → destroy + 下次访问重建 | ✅ destroy 回调执行后再重建 | ❌ | ✅ | ❌ | [RefreshScope 源码](https://github.com/spring-cloud/spring-cloud-commons/blob/master/spring-cloud-context/src/main/java/org/springframework/cloud/context/scope/refresh/RefreshScope.java) |
| 6 | **OSGi Declarative Services** | 2006–（1.3+ 增强） | ✅✅ **sat/unsat 驱动 activate/deactivate 链**；含 prototype/`prototype_required` 重解析 | ⚠️ 有 `deactivate` 但**回调由开发者写**；SCR 会 `unget` 追踪到的 service objects | ❌ | ✅（注解/XML，不改程序逻辑） | ❌ | [OSGi Compendium §112](https://docs.osgi.org/specification/osgi.cmpn/8.1.0/service.component.html) |
| 7 | **iPOJO** | 2008– | ✅ 依赖 + validity 驱动；`reconfigure()` 通知 | ⚠️ 同上（handler `stop()`） | ❌ | ✅ | ❌ | [Felix iPOJO handler 文档](https://cwiki.apache.org/confluence/display/FELIX/How+to+write+your+own+handler) |
| 8 | **Effect-TS（Scope / Layer）** | 2022– | ✅ **Layer 依赖图**；MemoMap 去重 | ✅✅ **finalizer 逆序执行（明确类比 stack unwinding）** | ❌ 无定理（类型层面有保证） | ❌ 需写在 effect 类型内 | ❌ | [Scope](https://effect.website/docs/resource-management/scope/) / [Layers](https://effect.website/docs/requirements-management/layers/) |
| 9 | **ZIO（Scope / ZLayer）** | 2019– | ✅ ZIO 2 自动建图（"order doesn't matter"） | ✅✅ 逆序 finalizer，子 scope 级联关闭 | ❌ | ❌ 需写在 ZIO 内 | ❌ | [Scope](https://zio.dev/reference/resource/scope/) / [迁移指南](https://zio.dev/guides/migrate/zio-2.x-migration-guide/) |
| 10 | **Kotlin 结构化并发** | 2018– | ⚠️ Job 父子层级（不是服务依赖图） | ✅ 结构化取消，父等子 | ⚠️ 有 progress/preservation 类结论但非针对依赖图 | ✅ | ❌ | [CoroutineScope](https://kotlinlang.org/api/kotlinx.coroutines/kotlinx-coroutines-core/kotlinx.coroutines/-coroutine-scope/) |
| 11 | **Erlang/OTP supervision** | 1996– | ✅ 监督树 + restart strategy | ✅✅ **逆启动序终止整棵树** | ❌ | ✅ | ❌ | [supervisor](https://www.erlang.org/doc/apps/stdlib/supervisor.html) / [Applications](https://www.erlang.org/docs/26/design_principles/applications.html) |
| 12 | **React useEffect** | 2019– | ❌（依赖数组触发重跑，非 provider 图） | ⚠️ cleanup 是结构化配对，但**兄弟间顺序无保证**、无 LIFO 承诺 | ❌ | ✅ | ❌ | [useEffect](https://react.dev/reference/react/useEffect) / [issue #19866](https://github.com/facebook/react/issues/19866) |
| 13 | **Vue 3 effectScope** | 2021– | ❌ | ⚠️ 有作用域级联，但**同作用域内 teardown 是正序**（非 LIFO） | ❌ | ✅ | ❌ | [RFC 0041](https://github.com/vuejs/rfcs/blob/master/active-rfcs/0041-reactivity-effect-scope.md) / [源码](https://github.com/vuejs/vue/blob/main/src/v3/reactivity/effectScope.ts) |
| 14 | **Angular DestroyRef** | 2023– | ✅ **层级 injector 销毁即销毁服务实例** | ✅ 有作用域、可反注册 | ❌ | ✅ | ❌ | [DestroyRef](https://angular.dev/api/core/DestroyRef) / [分层注入器](https://angular.dev/guide/di/hierarchical-dependency-injection) |
| 15 | **Koka / Eff / 代数效应** | 2013– | ❌（handler 是词法作用域） | ⚠️ handler finalizer / bracket 可表达 | ✅ 类型与 effect row 有完整理论 | ❌ 需改写程序 | ❌ | [Koka 论文](https://www.microsoft.com/en-us/research/wp-content/uploads/2016/08/algeff-tr-2016-v3.pdf) |
| 16 | **Effekt（effects as capabilities）** | 2020– | ⚠️ capability 隐含"需要什么" | ⚠️ 词法作用域 | ✅ System Ξ 形式化 | ❌ | ❌ | [OOPSLA 2020](https://dl.acm.org/doi/10.1145/3428194) |
| 17 | **coeffects / graded effect+coeffect** | 2013–2016 | — | — | ✅✅ **ICFP 2016 给出统一演算 + graded distributive law 模型** | ❌ 纯类型层 | ❌ | [ICFP 2016](https://www.cs.kent.ac.uk/people/staff/dao7/publ/combining-effects-and-coeffects-icfp16.pdf) / [ICALP 2013](https://www.cs.kent.ac.uk/people/staff/dao7/publ/coeffects-icalp13.pdf) |
| 18 | **可逆计算 / 可逆效果（inverse arrows）** | 2018– | — | ✅✅ 每个计算带 dagger/inverse | ✅ 范畴语义 | ❌ | ❌ | [Reversible effects as inverse arrows](https://arxiv.org/html/1805.08605) |
| 19 | **可逆进程演算（RCCS / 因果一致回滚）** | 2004– | ✅ 因果依赖决定可撤销性 | ✅✅ **因果一致回滚**（后果先撤销） | ✅✅ 有定理 | ❌ | ❌ | [Dependence and Independence for Reversible Process Calculi](https://export.arxiv.org/pdf/2410.14699) / [Causal-consistent rollback](https://www.cs.unibo.it/~lanese/newpublications/fulltext/jlamp2017-klaimrev.pdf) |
| 20 | **DSU / Kitsune / Erlang hot swap / HMR** | 2002– | ❌ | ❌ **状态前移（migrate forward），不是效果回滚** | ❌ | ✅ | ❌ | [Kitsune](https://www.cs.umd.edu/~mwh/papers/kitsune.pdf) |
| 21 | **Nooks / shadow drivers / Akeso** | 2003–2009 | ⚠️ 记录式回收（非依赖图） | ✅✅ **运行时持有记录并回收**，非作者自觉 | ❌ | ✅ 内核层 overlay | ❌ | [Nooks](https://pages.cs.wisc.edu/~swift/nooks/) |
| 22 | **Aeolus（云组件模型）** | 2012–2014 | ✅✅ require/provide + 状态机驱动 | ⚠️ 有 bind/unbind，无逆效果 | ✅✅ 可达性定理、**不可判定性**、Ackermann-hard | ❌（部署规划器） | ❌ | [Aeolus IC 2014](https://upsilon.cc/~zack/research/publications/ic-2014-aeolus.pdf) |
| 23 | **Wermelinger & Fiadeiro（图重写重配置）** | 2001–2002 | ✅ 结构约束 | ⚠️ quiescence + 状态转移，非逆效果 | ✅✅ 范畴语义 + 双推out 规则 | ❌ | ❌ | [SCP 2002](https://oro.open.ac.uk/1165/1/wermelinger02scp.pdf) |
| 24 | **Reo / HLR 图重写重配置** | 2011– | ✅ 结构 invariants | ⚠️ 事务级回滚 | ✅✅ **critical pair analysis 验合流** | ❌ | ❌ | [SCP 2011](https://ir.cwi.nl/pub/17413/17413.pdf) |
| 25 | **Context-Oriented Programming** | 2005– | ⚠️ 上下文变化驱动 layer 激活 | ❌ **不追踪也不回滚副作用** | ❌ | ❌ 语言扩展 | ❌ | [JOT 2008](https://www.jot.fm/issues/issue_2008_03/article4/) |
| 26 | **FRP / signals** | 1997– | ❌ 值级传播 | ❌ | ⚠️ glitch freedom 有形式化 | ✅ | ❌ | 见 §五.7 |
| 27 | **agent harness 插件化** | 2026 | — | — | — | — | ⚠️ 仅本系统；同期的 [Self-evolving Agent Harness](https://arxiv.org/html/2610.18813)（2026-10）讨论插件组合但**引用了本文** | — |

图例：✅✅ = 该层做得最完整 / 最强先例；✅ = 具备；⚠️ = 部分具备或形态不同；❌ = 缺；— = 不适用。

---

## 三、最大反例排行（前三名，逐个说清"做到哪一步"）

### 🥇 第一名：Clojure integrant（2016）

**为什么是最大反例**：它在 (a) 层的两条轴**同时具备**，而且比 Stuart Sierra Component 更彻底——依赖图从**数据**推导而非代码，且拆除**完全由运行时按逆拓扑序执行**，还带 suspend/resume 做资源复用。这几乎就是"两条轴"的工程形态。

**原文关键句**（[README](https://github.com/weavejester/integrant)）：

> "The `init` function will **start keys in dependency order**, and resolve references as it goes:"

> "**Like Component, `halt!` shuts down the system in reverse dependency order.** Unlike Component, `halt!` is entirely side-effectful. The return value should be ignored, and the system structure discarded."

> "It's also important that `halt-key!` is **idempotent**. We should be able to run it multiple times on the same key without issue."

> "In Integrant, **anything can be dependent on anything else. The dependencies are resolved from the configuration before it's initialized into a system.**"

**运行期重解析证据**（源码 [`integrant/core.cljc`](https://raw.githubusercontent.com/weavejester/integrant/master/src/integrant/core.cljc)）：

```clojure
(defn resume
  "Turn a config map into a system map, reusing resources from an existing
  system when it's possible to do so. Keys are traversed in dependency order,
  resumed with the [[resume-key]] multimethod, then the refs associated with
  the key are resolved."
  ([config system] (resume config system (keys config)))
  ([config system keys]
   (halt-missing-keys! config system keys)      ; ← 新配置里已删除的 key 先 halt
   (build config keys
          (fn [k v]
            (if (contains? system k)
              (resume-key k v (-> system meta ::build (get k)) (system k))
              (init-key k v)))
          wrapped-assert-key
          resolve-key)))
```

`halt-missing-keys!` 正是"**配置变化 → 找出不再存在的依赖 → 逆序停止**"这一段逻辑，配合 `integrant.repl/reset`（[API 文档](https://cljdoc.org/d/integrant/repl/0.5.1/api/integrant.repl)）：

> "**Suspend the current running system via `suspend`, reload any changed namespaces, and then finally resume the system with `resume`.**"

**它缺什么**（这才是判断"新颖性还剩什么"的关键）：
1. **(b) 完全没有**：无定理、无观测等价、无 independence/commutativity/confluence 的形式论证。整个库 ~600 行 Clojure，无一处形式化。
2. **逆操作靠作者写**：`halt-key!` 是用户 `defmethod` 出来的，"遗忘即泄漏"这一点与 OSGi 同罪。
3. **无异步拆除协议**：`halt!` 是同步 side-effectful 调用；`halt-key!` 若返回 future/promise 无运行时契约去 await。
4. **无 agent harness**（(d)）：与 agent 无关。
5. **空间轴的粒度不同**：integrant 的依赖图是**静态配置推导**的；它不会"因为某个 provider 在运行期被换掉而自动重激活下游"——`resume` 需要**人**调用。Cordis 是"上下文变化 → 运行时自动分类为激活/停用/中性"。

> **判定**：(a) 层的"统一两条轴"**在 2016 年已被 integrant 做到**。新颖性不能落在 (a)。

---

### 🥈 第二名：OSGi Declarative Services（尤其 1.3+）

**为什么是第二大反例**：空间轴（(a-1)）上它是**所有先例中最强的**——真正做到了"服务可用性变化 → 自动级联 activate/deactivate"，且有 prototype 作用域的重解析与 SCR 侧的 `unget` 追踪。论文自己都承认它是"closest precedent"。

**原文关键句**（[OSGi Compendium §112](https://docs.osgi.org/specification/osgi.cmpn/8.1.0/service.component.html)）：

> "SCR must activate a component configuration when the component is enabled and **the component configuration is satisfied** and a component configuration is needed. During the life time of a component configuration, SCR can notify the component of changes in its bound references."

> "**SCR will deactivate a previously activated component configuration when the component becomes disabled, the component configuration becomes unsatisfied, or the component configuration is no longer needed.**"

> "Once any of the listed conditions are no longer true, the component configuration becomes unsatisfied. **An activated component configuration that becomes unsatisfied must be deactivated.**"

> "**Component configurations are deactivated before any bound service for the static reference becomes unavailable.** If a target service is available to replace the bound service which became unavailable, the component configuration must be reactivated and the replacement service is bound to the new component instance."

——这一句就是空间轴的"**provider 撤离前，consumer 必须先停用**"，与 Cordis 的 Unloading 惯性态（"a provider withdraws a binding only after dependent fibers have deactivated"）**语义同构**。

> "If an activated component configuration's configuration properties change, SCR must either notify the component configuration of the change ... or **deactivate the component configuration and then attempt to reactivate** the component configuration using the new configuration information."

——Configuration Admin 触发的 activate/deactivate 链，确认存在。

**1.3+ 的 prototype / prototype_required 重解析**（同页）：

> "If the `scope` attribute of the `service` element is `prototype`, then, **for each distinct request for the service object, such as via `ServiceObjects`, a different component configuration is created and activated and a new instance of the component implementation class is returned** as the service object."

> "If service objects for a bound service have been obtained and the service becomes unbound, **SCR must unget any unreleased service objects** ... SCR must **track those service objects** so that when the service becomes unbound, SCR can unget any unreleased service objects."

——注意最后这句：**SCR 自己持有记录并负责回收**，这已经是"运行时持有逆操作"的雏形，不只是"作者自觉"。

**它缺什么**：
1. **(a-2) 的逆操作仍主要是手写回调**：`deactivate` 方法由开发者实现，SCR 不检查其完备性。这是论文 §7.4 点出的第一个 gap，**成立**。
2. **同步**：`deactivate` 是同步方法；若拆除需要与已离场的依赖做异步交换，规范不提供 await 协议，只能阻塞等待可能已失效的引用。这是论文点出的第二个 gap，**也成立**。
3. **(b) 完全没有**：规范是行为契约（"must"），不是定理。无观测等价、无 independence 证明。
4. **无"effect 级逆操作"**：粒度是"组件级 deactivate"，不是"每一次 context 变更都携带一个 inverse 并被运行时累加"。这是**语义粒度的真实差别**：OSGi 只能整体停/启，Cordis 能按 es* 累加器逐步回卷到任意中间点。

> **判定**：(a-1) 层"反应式依赖驱动组件生命周期"**在 2006 年已被 OSGi DS 做到**。(a-2) 也有骨架（deactivate + SCR unget），但缺"逆操作的结构性配对"与"异步拆除协议"。新颖性**不能**落在"依赖驱动生命周期"本身。

---

### 🥉 第三名：Effect-TS Scope/Layer 与 ZIO Scope（并列）

**为什么是第三大反例**：它们在 (a-2) 上做到了**最彻底的逆序结构化拆除**——明确类比 stack unwinding，且与依赖图构造**同一个抽象**（Layer/ZLayer 既是依赖图构造器，又是作用域持有者）。这是"时间轴 + 空间轴在同一抽象里"最干净的工程实现。

**Effect-TS 原文**（[Scope 文档](https://effect.website/docs/resource-management/scope/)）：

> "finalizer 2 <-- **finalizers are closed in reverse order**"
> "finalizer 1"

> "**Finalizers are executed in reverse order of how they were added, ensuring that resources are released in the proper sequence, just like in stack unwinding.**"

（[Layer 文档](https://effect.website/docs/requirements-management/layers/)）：

> "To represent the **"dependency graph"** of our program and manage these dependencies more effectively, we can utilize a powerful abstraction called **"Layer"**."

> "Layers act as **constructors for creating services**, allowing us to manage dependencies during construction rather than at the service level."

`Layer.build` 的类型即证据——构造与作用域是同一个东西：

> `declare function build<RIn, E, ROut>(self: Layer<ROut, E, RIn>): Effect<Context<ROut>, E, Scope | RIn>`

社区总结（[EffectPatterns](https://github.com/PaulJPhilp/EffectPatterns/blob/main/content/published/patterns/resource-management/compose-scoped-layers.mdx)）：

> "The Effect runtime will **automatically build a dependency graph, acquire resources in the correct order, and release them in the reverse order**."

**ZIO 原文**（[Scope](https://zio.dev/reference/resource/scope/)）：

> "**By default, when a `Scope` is closed all finalizers added to that `Scope` will be closed in the reverse of the order in which those finalizers were added to the `Scope`.**"

> "`fork`: **Finalizers added to this scope will be run sequentially in the reverse of the order in which they were added** when this scope is closed. **The child scope will automatically be closed when this scope is closed.**"

（[ZIO 2 迁移指南](https://zio.dev/guides/migrate/zio-2.x-migration-guide/)）：

> "In ZIO 2.x, we can **automatically construct dependencies** ... **The order of dependencies doesn't matter**"

> "So we found that **the ZIO Environment is now powerful enough to provide resource-safety by itself!**"

——这句是 (a) 层"两条轴合流"的最直白自述。

**它们缺什么**（这三条正是 Cordis 论文自陈的差异，且**基本成立**）：
1. **(c) overlay 不成立**：必须把程序写进 `Effect<A, E, R>` / `ZIO[R, E, A]` 类型里。这是"改写整个程序"，非 overlay。论文 §7.1 的这句判断是准确的：
   > "the tracking costs a **monadic embedding**: a program obtains it only by being written inside the effect type, whereas Cordis tracks effects as an **overlay over ordinary host code**."
2. **provider 消失后不会自动重解析生命周期**：Layer 图是**构造期**解析的；运行期 provider 被替换不存在于模型中（没有 "reactive" 那一半）。ZIO 的 Scope 是资源生命周期，不是服务可用性驱动。这是空间轴的真实缺口。
3. **(b) 无定理**：有类型保证，无观测等价/independence/confluence 定理。

**同组补充：Kotlin 结构化并发**（[CoroutineScope](https://kotlinlang.org/api/kotlinx.coroutines/kotlinx-coroutines-core/kotlinx.coroutines/-coroutine-scope/)）只有"作用域嵌套取消"，**没有依赖图**，且官方明确警告其反向陷阱：

> "**Pitfall: returning closeable resources from a lexically scoped coroutine**" —— 说明它连"作用域内资源回收"都不是自动的，需要手写 `try/finally` + `NonCancellable`。**不作为主要反例。**

---

## 四、(a) 层"史无前例"被推翻的证据汇总

按判据 (a-1) + (a-2) 同时具备来筛，以下系统**在 Cordis 论文之前**就已同时具备：

| 系统 | (a-1) 证据 | (a-2) 证据 | 引入年份 |
|---|---|---|---|
| integrant | `ig/ref` + 拓扑排序 init | 逆依赖序 `halt!`，幂等；suspend/resume | 2016 |
| Component | 显式依赖图 | stop 逆序（依赖在自身停止后才停） | 2013 |
| mount | require 顺序 | `stop = reverse(start)` | 2015 |
| Spring | `depends-on` | 逆序 destroy + dependents-first | 2003 |
| OSGi DS | sat/unsat 级联 | `deactivate` + SCR `unget` 追踪 | 2006 |
| iPOJO | validity 驱动 | handler `stop()` | 2008 |
| Erlang OTP | 监督树 | 逆启动序终止 | 1996 |
| Effect-TS / ZIO | Layer/ZLayer 图 | 逆序 finalizer | 2022 / 2019 |

**结论：在 (a) 层，称"史无前例"是不成立的。**至少有 8 个系统在时间上早于 Cordis 论文，且其中 integrant 与 OSGi DS 的完成度足以让"统一两条轴"这一表述失去排他性。

---

## 五、(b)(c)(d) 三层：逐层看还剩什么

### 5.1 (b) 形式化：先例已占据大半，但"这一组合"未检索到

**(b-1) 已被占据：effect + coeffect 的统一演算。**

ICFP 2016（[论文 PDF](https://www.cs.kent.ac.uk/people/staff/dao7/publ/combining-effects-and-coeffects-icfp16.pdf)，[ACM](https://dl.acm.org/doi/10.1145/2951913.2951939)）：

> "Effects and coeffects are two general, complementary aspects of program behaviour. **They roughly correspond to computations which change the execution context (effects) versus computations which make demands on the context (coeffects).**"

> "**we introduce a new general calculus with a combined effect-coeffect system** ... The effect-coeffect system has a denotational model in terms of effect-graded monads and coeffect-graded comonads where interaction is expressed via the novel concept of **graded distributive laws**."

——这就是"把 effect 与 coeffect 统一进一个系统并给定理"的先例。**关键差别：它是类型层的、编译期的、作用域词法固定的；Cordis 是运行时机制层的、作用域随组件生灭变化的。** 论文 §7.1 对此的表述是准确的：

> "**All of these operate at the type level**: effects and coeffects are static annotations checked at compile time over lexically fixed scopes. Our contribution is orthogonal to this analysis: we lift the same two notions to runtime mechanisms."

coeffect 概念的源头（[ICALP 2013](https://www.cs.kent.ac.uk/people/staff/dao7/publ/coeffects-icalp13.pdf)）：

> "Monadic effect systems provide a unified way of tracking effects of computations, but **there is no unified mechanism for tracking how computations rely on the environment** in which they are executed. ... **We use the term coeffect for such contextual program properties.**"

**(b-2) 已被占据：可逆性的形式化。**

[Reversible effects as inverse arrows](https://arxiv.org/html/1805.08605)（Heunen 等）：

> "We model reversible effects by adapting Hughes' arrows to dagger arrows and inverse arrows."
> "We call a computation a:X→Y reversible when it comes with a **specified partner computation** a†:Y→X."

可逆进程演算的因果一致性（[Dependence and Independence for Reversible Process Calculi](https://export.arxiv.org/pdf/2410.14699)，[causal-consistent rollback](https://www.cs.unibo.it/~lanese/newpublications/fulltext/jlamp2017-klaimrev.pdf)）：

> "any given past action can be undone, **provided that all the actions caused by it are undone as well**"

——注意：这正是 Cordis 的 "LIFO 回卷 + provider 等 dependents 先停" 在并发语义侧的原型。论文 §7.3 自己也承认：

> "Their **causal-consistency criterion is the concurrent counterpart of the order Cordis's recovery follows**"

**(b-3) 已被占据：重配置的合流性 / 结构一致性。**

图重写的 critical pair analysis / 局部合流（[Reo HLR, SCP 2011](https://ir.cwi.nl/pub/17413/17413.pdf)）：

> "We use **critical pair analysis** for static verification of reconfiguration rules."

架构重配置的范畴语义 + quiescence（[Wermelinger & Fiadeiro, SCP 2002](https://oro.open.ac.uk/1165/1/wermelinger02scp.pdf)）：

> "components are removed in a **quiescent state** ... reconfiguration and computation are kept separate ... **the state of components and connectors that are not deleted nor added by a rule does not change.**"

——最后半句就是"独立分量的效果不被打扰"的早期形式。

Aeolus 的复杂度/可判定性定理（[IC 2014](https://upsilon.cc/~zack/research/publications/ic-2014-aeolus.pdf)）：

> "the achievability problem is **undecidable for the full Aeolus model** ... the problem becomes decidable, but **Ackermann hard**, as soon as one drops non-functional requirements ... **polynomial time algorithm** for the further restriction"

——这是"依赖驱动生命周期 + 状态机"这一对象上最强的负面/复杂性结果，**比 Cordis 的 progress 定理更"硬"**（Cordis 只证"无环则进展"，Aeolus 证"一般情形不可判定"）。

**(b-4) 未检索到的部分（这就是新颖性落点）**

**"把 revertible effect（每次 context 变换携带 inverse）与 reactive coeffect（每次 context 变更按规格分类为 act/deact/neutral）统一进一个 context 类型，并对这一统一对象给出 preservation / temporal composability / spatial composability / progress / confluence 五条定理"——未检索到先例。**

三条线（graded effect-coeffect、可逆演算、重配置图重写）在文献中**各自独立发展，从未被合成到"运行时组件生命周期"这一个对象上**。这是 (b) 层可以作为新颖性主张的部分。

**但必须标注两个削弱因素**（都来自论文自己的表述）：
- 定理的条件很紧：合流性需"依赖图无环 + 步骤相互独立"（§7 结论前的限定，见 [Helmcode 转述](https://helmcode.com/posts/cordis-paper-spatiotemporal-composability) 与 alphaXiv 摘录 "Confluence, for instance, is proved assuming the dependency graph has no cycles and that the steps involved are independent of each other"）。
- 覆盖面有限：只有"经 context 中介的 key 交互"被覆盖；系统边界外（网络字节、已发消息、磁盘）不可回滚，只能 compensation/withholding。alphaXiv 摘录：
  > "It is **not a claim that arbitrary side effects can be rolled back**. Only interactions mediated by reified context keys are covered, and **operations outside the system boundary are not tracked or reverted**."

### 5.2 (c) overlay：不成立，被推翻

反例是最强的：**integrant / Component / mount / OSGi DS / Spring / Angular DI** 全都是 overlay——不要求改写宿主程序。

- integrant 的整个设计动机就是"**架构由数据而非代码定义**"（README: "In Integrant, systems are created from a configuration data structure... The architecture of the application is defined through **data**, rather than code."）；
- OSGi DS 用注解/XML 声明，业务类保持 POJO；
- Spring 用注解/XML。

Component 是唯一有 (c) 缺口的（README 自承）：

> "**It is not easy to retrofit the component model to an existing application without major refactoring.** In particular, the 'component' library assumes that all application state is passed as arguments to the functions that use it."

——但这恰恰说明 integrant 已经把这一缺口补上了。

**所以 (c) 不能作为新颖性主张。**它只能作为"相对于 Effect-TS / ZIO / Koka 的优势"（那三者确实需要 monadic embedding），而不是"相对于所有先例"。

### 5.3 (d) agent harness 整体可热替换：未检索到反例

这是唯一在检索中**没有找到先例**的一层。

证据（本仓库，另一审计线 task-3 负责逐行核验；此处仅记录要点）：`dsh-agent` 只持有一个工厂槽位，`dsh-agent-loop` 在构造函数里用一行注册进去：

```
ctx.effect(() => ctx.agents.setFactory(this))
```

卸载即槽位清空，UI / hook / tool 插件都只针对 `dsh-agent` 的事件与服务编译，不感知 loop 实现（见 [MartianLee 分析](https://martianlee.github.io/posts/2026-09-05-deepseek-harness-architecture)，英文原文："The 'dsh-agent-loop' is swappable"）。

**但要注意两个限定**：
1. **论文自己没把 (d) 当作已完成成果**。论文 §8 结语把 agent harness 列为**未来验证方向**：
   > "Beyond human-curated plugin ecosystems, a compelling direction for **future validation** is self-evolving agent harnesses ... Such validation **would demonstrate** the paradigm's applicability..."
2. **同期已有相邻工作**：[Self-evolving Agent Harness](https://arxiv.org/html/2610.18813)（2026-10-13）讨论插件式 harness 自我演进，但它的引用里已包含 Cordis 论文（"Kernel-defined substrates specify how these services are connected, mounted, and replaced (DeepSeek-AI, 2026; Shi et al., 2026)"），**属于后续工作而非先例**。

**判定**：(d) 可作为"工程首创"的主张，但它是**实现事实**而非**理论新颖性**，且论文自身把它归为未来工作。严谨说法是"**目前未检索到把 agent loop 本身做成可热替换插件且带结构化回滚的运行时**"。

---

## 六、术语层面的核查

**"spatiotemporal composability" 这一确切短语，未检索到 Cordis 论文之外的软件工程用法。**

检索到的全部命中都指向该论文自身或其派生的二手解读（arXiv abs、alphaXiv、HuggingFace papers、cordiverse/paper、以及大量博客转述）。

**一个须如实记录的相邻命中**：[Composable Instruction Set for Data Streaming Applications](https://arxiv.org/html/2407.00207v2)（arXiv 2407.00207，2024-07）使用了 **"temporal composability"** 但**语义完全不同**——指硬件指令级的时序可组合（用 REPETITION / TRANSITION 算子从原子指令构造复杂操作）：

> "**Temporal composability** refers to the ability to construct a complex operation from one or more atomic basic operations and some well-defined temporal transformation operators."

——**同名异义**，不构成概念先例，但说明"temporal composability"作为术语在 2024 年已被其他领域使用。若要做严格的术语首创主张，需注意这一点。

**"compositionality in time and space" / "lifecycle composition"**：未检索到与 Cordis 论题等价的既有提法。

---

## 七、论文自陈的 Related Work 覆盖情况（用于判断"是否漏检先例"）

论文 §7（p.77–82）实际点名的先例，逐条对照本审计：

| 论文点名 | 本审计是否确认 | 备注 |
|---|---|---|
| ZIO、Effect-TS、fp-ts | ✅ | §7.1，定位为"monadic embedding" |
| Effekt、代数效应 | ✅ | §7.1 |
| Heunen 等 reversible effects / inverse arrows | ✅ | §7.1，称"the formal account closest to our revertible effects" |
| Orchard 等 graded modal types / Granule、ICFP 2016 | ✅ | §7.1，"Our contribution is orthogonal" |
| **Context-Oriented Programming** | ✅ | §7.2，长段辨析（"the resemblance is nominal"） |
| **AOP / dynamic-AOP** | ✅ | §7.2 |
| Kramer & Magee quiescence、Vandewoude tranquility | ✅ | §7.3 |
| Hicks DSU、Stoyle、**Kitsune** | ✅ | §7.3 |
| **Erlang/OTP code_change** | ✅ | §7.3 |
| **HMR（webpack / Vite）** | ✅ | §7.3 |
| **OSGi、Eclipse extension points、IntelliJ、VSCode** | ✅ | §7.3（作为"developer-authored recovery"） |
| Command pattern、saga、event sourcing、**React useEffect** | ✅ | §7.3，React 被单独展开（"comes closest to pairing an effect with its inverse structurally"） |
| **STM、可逆计算 / Janus、RCCS、Phillips & Ulidowski、linear types、RAII、Rust ownership** | ✅ | §7.3 |
| Kim & Rinard（每操作 inverse + 交换条件） | ✅ | §7.3 |
| **Nooks、shadow drivers、Akeso** | ✅ | §7.3，"the closest systems-level precedent" |
| **DI 框架（Spring、Guice、Angular、Inversify）、Vue provide/inject、React Context** | ✅ | §7.4 |
| **OSGi DS、iPOJO、iPOJO Gravity、R-OSGi** | ✅ | §7.4，"The closest precedent to our reactive coeffects" |
| **FRP、signals（SolidJS、Vue、Angular Signals）、glitch freedom** | ✅ | §7.4 |

**漏检项（本审计发现、论文 §7 未点名）**：

| 漏检系统 | 为何重要 | 影响 |
|---|---|---|
| **Clojure integrant** | (a) 层最强反例：数据驱动依赖图 + 逆序可逆 halt + suspend/resume | ★★★ 论文全文无 `integrant` / `Clojure` / `Sierra` / `Component` 命中 |
| **Stuart Sierra Component / mount** | 同上家族，(a) 层早于论文 10 年以上 | ★★★ |
| **Aeolus** | (b) 层最硬的定理（不可判定性、Ackermann-hard）就在"依赖驱动生命周期"这个对象上 | ★★ |
| **Wermelinger & Fiadeiro / Reo HLR 图重写** | (b) 层的合流性（critical pair）与"非受影响分量状态不变" | ★★ |
| **Kotlin 结构化并发** | 任务书要求核查；论文未点名 | ★ |
| **Kevoree（models@runtime）** | 运行期模型驱动的组件重配置 | ★ |

**这不是"论文遗漏了机制先例"，而是"论文遗漏了最接近的机制先例族群"。** §7.3 的 "developer-authored recovery" 只列了 OSGi / Eclipse / IntelliJ / VSCode，完全没覆盖 Clojure 生态的 Component/integrant/mount——而后者恰恰是"依赖图 + 可逆 teardown"最纯正的实现。

> 严格说：这不影响 (b) 层新颖性（integrant 无定理），但**严重影响 (a) 层的排他性措辞**。如果二手报告据此说"首次把两条轴统一"，那么 integrant 是直接反例。

---

## 八、"是否史无前例"的分层结论（可直接引用）

### 8.1 明确被推翻的

| 命题 | 判定 | 反例 |
|---|---|---|
| "首次把可逆 teardown 做成结构化、运行时持有的机制" | ❌ **不成立** | ZIO/Effect 的 Scope（逆序 finalizer，类比 stack unwinding）；Nooks/shadow drivers/Akeso（运行时记录并回收，2003–2009）；Spring 逆序 destroy（2003）；Erlang OTP 逆序终止（1996） |
| "首次让依赖图驱动组件生命周期" | ❌ **不成立** | OSGi DS（2006，sat/unsat 级联 + prototype 重解析）；iPOJO（2008）；Spring `depends-on`（2003）；integrant（2016）；Aeolus（2012） |
| "首次把这两条轴统一进一个系统" | ❌ **不成立** | **integrant（2016）**：数据驱动依赖图 + 逆依赖序可逆 halt + suspend/resume；**OSGi DS**：依赖驱动生命周期 + deactivate/SCR unget；**Effect-TS Layer+Scope / ZIO ZLayer+Scope**：依赖图构造器即作用域持有者 |
| "首次用语言无关的 overlay 实现" | ❌ **不成立** | integrant / Component / OSGi DS / Spring / Angular DI 全是 overlay |
| "首次把 effect 与 coeffect 统一并给形式化" | ❌ **不成立（但仅限类型层）** | ICFP 2016 graded effect+coeffect（有演算 + 分配律模型） |
| "首次给出可逆性 + 并发因果的定理" | ❌ **不成立** | RCCS / Phillips-Ulidowski / 因果一致回滚（2004–） |
| "首次给出重配置合流性的形式化" | ❌ **不成立** | 图重写 critical pair analysis（Reo, 2011）；Wermelinger 范畴语义（2002） |

### 8.2 未被推翻的（新颖性可落点）

| 命题 | 判定 | 依据 |
|---|---|---|
| **(b) 把 effect 与 coeffect 从"编译期类型层"下沉为"运行时机制层"，并对这一统一对象给出 preservation / temporal / spatial / progress / confluence 五条定理** | ✅ **未检索到反例** | 三条先例线（graded effect-coeffect、可逆演算、重配置图重写）各自独立，从未合成到"运行时组件生命周期"这一个对象上 |
| **(b) 的"inverse 由调用方在应用点提供、复合的 inverse 由组合自动导出"这一非对称设计** | ✅ **未检索到反例** | 有别于可逆计算（要求整个计算可逆、inverse 双侧）与 DSU（状态前移）。论文自述："not that the whole computation be reversible, but that each atomic effect admit a **one-sided inverse, supplied by the caller** at the point of application rather than derived" |
| **(d) 整个 agent harness（含 agent loop）作为可热替换插件树** | ⚠️ **未检索到反例，但论文自归为未来工作** | 属工程事实；同期相邻工作已引用本文，不构成先例 |

### 8.3 给 Lead 的一句话建议措辞

> 若要说新颖性，正确说法是："**首次把 effect 与 coeffect 从编译期类型层下沉为运行时机制并给出五条定理**，且**首次在 agent harness 上把 agent loop 本身做成可热替换插件**。"
>
> 不能说："首次把可逆副作用与反应式依赖统一"——integrant（2016）与 OSGi DS（2006）已经做过机制层的统一；也不能说"史无前例"——论文自己都没这么说。

---

## 九、检索局限（必须如实标注）

1. **未检索到**任何在 (b) 层"可逆效果 + 反应式 coeffect 统一 + 运行时生命周期"这一**确切组合**上的先例论文。但这**不等于不存在**——可能存在于 OOPSLA/ECOOP 的组件模型社群、或 Dagstuhl 研讨会报告等本审计未覆盖的来源。
2. **未检索到** "spatiotemporal composability" 在 Cordis 论文之外的软件工程用法；但 "temporal composability" 在硬件/DSL 领域已有同名异义用法（arXiv 2407.00207）。
3. **未检索到**把 agent loop 做成可热替换插件的先例（(d) 层）。
4. **未覆盖**：日文/中文/德文学术文献；非 ACM/IEEE 的组件模型社群（如 JLAP、SCP 的部分卷期）；Kevoree 的法文原始论文仅取到摘要与部分正文。
5. **Kevoree** 一项目前只确认了"运行期模型驱动重配置 + 依赖一致性"的存在，未取到其"可逆 teardown"的原文关键句，故表中标 ⚠️ 而非 ✅。
6. Clojure **integrant 的 (b) 层缺失是核实过的**（源码 ~600 行无形式化），不是推测。
7. 论文 PDF 为本地 `paper.pdf`（92 页），与 arXiv 2608.25512 对应；若 arXiv 有新版本（"preprint under active revision"），页码可能与本地不一致——**本审计的页码引用均基于本地 PDF**。

---

## 十、来源清单（可点击）

**Clojure 生态（最大反例）**
- integrant README — https://github.com/weavejester/integrant
- integrant 源码 `core.cljc` — https://raw.githubusercontent.com/weavejester/integrant/master/src/integrant/core.cljc
- integrant.repl API — https://cljdoc.org/d/integrant/repl/0.5.1/api/integrant.repl
- Stuart Sierra Component — https://github.com/stuartsierra/component
- mount — https://github.com/tolitius/mount

**OSGi / iPOJO**
- OSGi Compendium §112 Declarative Services — https://docs.osgi.org/specification/osgi.cmpn/8.1.0/service.component.html
- iPOJO handler 文档 — https://cwiki.apache.org/confluence/display/FELIX/How+to+write+your+own+handler
- iPOJO annotations（`@Requires` policy / `@Updated`）— https://cwiki.apache.org/confluence/display/FELIX/How+to+use+iPOJO+Annotations
- DS 1.3 prototype 作用域说明 — https://vogella.com/blog/control-osgi-ds-component-instances-2024/

**Spring**
- `depends-on`（含销毁序）— https://docs.spring.io/spring-framework/reference/core/beans/dependencies/factory-dependson.html
- `DefaultSingletonBeanRegistry`（逆序 destroy 源码）— https://github.com/spring-projects/spring-framework/blob/main/spring-beans/src/main/java/org/springframework/beans/factory/support/DefaultSingletonBeanRegistry.java
- `RefreshScope` 源码 — https://github.com/spring-cloud/spring-cloud-commons/blob/master/spring-cloud-context/src/main/java/org/springframework/cloud/context/scope/refresh/RefreshScope.java
- Spring Cloud Refresh Scope 文档 — https://docs.spring.io/spring-cloud-commons/reference/spring-cloud-commons/application-context-services.html

**Effect 系统（Scope / Layer）**
- Effect Scope — https://effect.website/docs/resource-management/scope/
- Effect Layers — https://effect.website/docs/requirements-management/layers/
- Effect Layer API（`build` / `MemoMap`）— https://effect.website/docs/v4/api/effect/Layer
- Effect Layer 记忆化 — https://effect.website/docs/v4/requirements-management/layer-memoization
- EffectPatterns（依赖图 + 逆序释放）— https://github.com/PaulJPhilp/EffectPatterns/blob/main/content/published/patterns/resource-management/compose-scoped-layers.mdx
- ZIO Scope — https://zio.dev/reference/resource/scope/
- ZIO ZLayer — https://zio.dev/reference/di/zlayer-constructor-as-a-value.md
- ZIO 2 迁移指南（自动建图 / Environment 自足）— https://zio.dev/guides/migrate/zio-2.x-migration-guide/

**Web / 移动框架**
- React useEffect — https://react.dev/reference/react/useEffect
- React issue #19866（兄弟间顺序无保证）— https://github.com/facebook/react/issues/19866
- Vue RFC 0041 effectScope — https://github.com/vuejs/rfcs/blob/master/active-rfcs/0041-reactivity-effect-scope.md
- Vue effectScope 源码（正序 teardown）— https://github.com/vuejs/vue/blob/main/src/v3/reactivity/effectScope.ts
- Angular DestroyRef — https://angular.dev/api/core/DestroyRef
- Angular 分层注入器 — https://angular.dev/guide/di/hierarchical-dependency-injection
- Kotlin CoroutineScope — https://kotlinlang.org/api/kotlinx.coroutines/kotlinx-coroutines-core/kotlinx.coroutines/-coroutine-scope/

**Erlang/OTP 与 DSU**
- supervisor（逆启动序终止）— https://www.erlang.org/doc/apps/stdlib/supervisor.html
- Applications（应用停止序）— https://www.erlang.org/docs/26/design_principles/applications.html
- Release Handling（`code_change` / 同步代码替换）— https://www.erlang.org/doc/system/release_handling.html
- Kitsune（DSU，状态前移）— https://www.cs.umd.edu/~mwh/papers/kitsune.pdf

**效应系统 / coeffect / 可逆性**
- Koka（代数效应，row 多态）— https://www.microsoft.com/en-us/research/wp-content/uploads/2016/08/algeff-tr-2016-v3.pdf
- Coeffects ICALP 2013 — https://www.cs.kent.ac.uk/people/staff/dao7/publ/coeffects-icalp13.pdf
- **Combining Effects and Coeffects via Grading（ICFP 2016）** — https://www.cs.kent.ac.uk/people/staff/dao7/publ/combining-effects-and-coeffects-icfp16.pdf / https://dl.acm.org/doi/10.1145/2951913.2951939
- Effekt（effects as capabilities，OOPSLA 2020）— https://dl.acm.org/doi/10.1145/3428194
- Reversible effects as inverse arrows — https://arxiv.org/html/1805.08605
- Foundations of Reversible Computation — https://link.springer.com/chapter/10.1007/978-3-030-47361-7_1
- Dependence and Independence for Reversible Process Calculi — https://export.arxiv.org/pdf/2410.14699
- Causal-consistent rollback in μKlaim — https://www.cs.unibo.it/~lanese/newpublications/fulltext/jlamp2017-klaimrev.pdf
- Scoped effects / parameterized algebraic theories（TOPLAS 2025）— https://dl.acm.org/doi/10.1145/3731678
- Dynamic Wind for Effect Handlers（System Ξ↬，resource safety 定理）— https://se.cs.uni-tuebingen.de/publications/voigt2025dynamic.pdf

**系统层（Nooks / Akeso）**
- Nooks / shadow drivers — https://pages.cs.wisc.edu/~swift/nooks/
- Recovering Device Drivers（OSDI 2004）— https://www.usenix.org/legacy/event/osdi04/tech/swift/swift.pdf

**架构重配置（形式化）**
- Wermelinger & Fiadeiro, SCP 2002 — https://oro.open.ac.uk/1165/1/wermelinger02scp.pdf
- Aeolus IC 2014 — https://upsilon.cc/~zack/research/publications/ic-2014-aeolus.pdf
- Aeolus SEC 2013（工具链）— https://upsilon.cc/~zack/research/publications/esocc2013-aeolus.pdf
- Reo HLR 重配置（critical pair / 合流）— https://ir.cwi.nl/pub/17413/17413.pdf
- Kevoree models@runtime — https://inria.hal.science/hal-00714557v1/document

**Context-Oriented Programming / FRP**
- COP, JOT 2008 — https://www.jot.fm/issues/issue_2008_03/article4/
- ContextL, 2005 — https://hpi.uni-potsdam.de/hirschfeld/publications/media/CostanzaHirschfeld_2005_LanguageConstructsForContextOrientedProgrammingAnOverviewOfContextL_AcmAuthorsVersion.pdf
- COP 语言比较, 2009 — https://www.hirschfeld.org/writings/media/AppeltauerHirschfeldHauptLinckePerscheid_2009_AComparisonOfContextOrientedProgrammingLanguages_AcmDL.pdf
- ContextJS 开放实现 — https://www.hirschfeld.org/writings/media/LinckeAppeltauerSteinertHirschfeld_2010_AnOpenImplementationForContextOrientedLayerCompositionInContextJS_Elsevier.pdf

**被审计对象**
- arXiv 2608.25512 — https://arxiv.org/abs/2608.25512
- cordiverse/paper — https://github.com/cordiverse/paper
- alphaXiv（含定理摘录与限定条件）— https://www.alphaxiv.org/abs/2608.25512
- HuggingFace papers — https://huggingface.co/papers/2608.25512
- 论文派生解读（用于交叉核对定理表述，非一手）— https://helmcode.com/posts/cordis-paper-spatiotemporal-composability
- 相邻工作（后续、非先例）— https://arxiv.org/html/2610.18813
- dsh agent loop 可替换性分析 — https://martianlee.github.io/posts/2026-09-05-deepseek-harness-architecture
