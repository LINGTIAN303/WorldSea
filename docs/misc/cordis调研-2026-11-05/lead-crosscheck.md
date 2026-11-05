# Lead 独立交叉核对（论文一手 + 本地源码一手）

> 用途：给 paper-verifier / local-auditor 的产出做独立对照，避免只依赖队友转述。
> 时间：2026-11-05

## A. 论文元数据（arXiv abs 页 + 本地 PDF 抽取，双证）

| 项 | 值 | 结论 |
|---|---|---|
| arXiv 编号 | 2608.25512 (cs.PL) | 真实存在 |
| 标题 | A Programming Paradigm for Spatiotemporal Composability | 一致 |
| 作者 | Yifan Shi (1,2), Wei Zhang (1), Tianyi Cui (2) | — |
| 单位 | (1) Peking University, (2) DeepSeek-AI | 报告"北大+DeepSeek"成立 |
| 页数 | Comments: 92 pages, 1 figure, 2 tables | 报告"92 页"成立；PDF 实抽 92 页 |
| 提交 | [v1] Wed, 26 Aug 2026 08:22:19 UTC | 仅 v1 |
| 主题 | Programming Languages (cs.PL); Software Engineering (cs.SE) | — |
| HTML 全文 | arxiv.org/html/2608.25512v1 → 404（无 HTML） | 必须走 PDF |

抽取：pypdf 92 页 / 300,412 字符 → `.devtmp/cordis-audit/paper-fulltext.txt`

## B. 关键断言逐条对照（论文原文）

### B1. 两条轴的定义 —— §1.1（P4）成立

> "**Temporal composability** addresses the time dimension: upon removal of a component, the modifications the component made to the shared environment must be completely and safely reversed. This requires tracking every resource allocation, event registration, and state mutation the component performs, and guaranteeing their orderly reclamation upon removal."
> "**Spatial composability** addresses the space dimension: components must be able to declare, discover, and resolve their dependencies on one another in a structured and verifiable manner. This requires managing dependency topology and coordinating component lifecycles in response to dependency changes."

还解释了静态退化："In the static setting, temporal composability reduces to lexical scoping (e.g., RAII, bracket patterns), and spatial composability reduces to module import resolution."
→ 报告的"静态世界退化成 RAII / module import"成立。

### B2. 统一 context 类型 —— 摘要 + §1.3 贡献 3 成立

> 摘要："We then unify the effect context and the coeffect context into a single context type and mediate every effect and coeffect through it, yielding a discipline we call **the context paradigm**; the mediation induces an **observational equivalence** up to which the effects of distinct components interleave without disturbing one another."

§1.3 贡献 3 同义。贡献 1/2 分别"establishes **local** temporal/spatial composability"；贡献 4 用 calculus 的 metatheory 从单组件抬升到整个系统。贡献 5 是 Cordis 实现。
→ 报告"统一 context 类型 + 观测等价 + independence/commutativity"成立。

### B3. VS Code 反例数字 —— §1.2.1（P5）**部分成立**

> "Among the top 100 extensions by install count, however, **87 contain executable code**¹ and will therefore require such a restart upon removal."
> "among the top 100 extensions by install count, **only 7 declare extensionDependencies on non-built-in extensions**.¹"
> 脚注 1: "Data retrieved from the Visual Studio Code Marketplace on **June 9, 2026**."
> deactivate: "VSCode provides a deactivate hook, it serves only as a graceful shutdown callback during the host process' termination, and thus does not enable live removal."

→ 87 / 7 / deactivate 三处数字全部对得上。
⚠️ 修正点：报告写"87 个含可执行代码"，原文是"87 **contain executable code**"（含可执行代码）；报告的"只有 7 个声明扩展间依赖"原文限定了 "on **non-built-in** extensions"。细微但报告省略了限定语。

### B4. ⚠️ 论文**没有**说"史无前例"

全文检索：`unprecedent` = **0 命中**；`novel` = **0 命中**；`to our knowledge` / `we are not aware of` / `first system` / `first formal` = **0 命中**。
`first` 出现 49 次，全部是"They first modeled…"这种描述他人先例的用法（如 "Moggi first modeled computational effects"）。
→ 报告"论文自己也没用 first / unprecedented 这类词"**成立**，这是报告里少数诚实的判断。

### B5. "逆操作由作者提供、运行时只持有不验证" —— §5.1.1（P59）成立，但**"unchecked obligation"这个措辞要修正**

原文：
> "What the operation does not check is the witness that 𝔈*Γ carries: the callback supplies an inverse, and that the inverse reverts the effect it accompanies is **an obligation on the component author rather than a property the runtime verifies**."
> "The witness of a coeffect (Definition 46) is **unchecked in the same way**: that the operations published at a key commute is an obligation on the component providing it."
> "Theorem 68 is where the calculus appeals to it, and **Section 6.1 is where the obligation is delimited**."

全文 `unchecked` 只有 1 次命中，就是第 2791 行这句 "is unchecked in the same way"。也就是说：
- 论文说的是 **obligation on the component author（作者义务）+ 运行时不做验证**；
- "unchecked obligation" 不是一个连写的专有名词，是报告把 "obligation" 与 "unchecked in the same way" 两句拼成的术语。
- 报告归到"§5.1.1"，**章节号正确**。

→ 判定：**实质成立，术语是报告的二次加工**。

### B6. 循环依赖 —— §6.5（P74）成立，措辞需修正

> "a dependency cycle simply leaves the involved components **permanently inactive**… **Unlike deadlock** in concurrent systems, which depends on the schedule and must be detected as it happens, this condition is **predictable from the dependency declarations alone**, so a runtime can report it when components are loaded."

→ 报告"循环依赖会让相关组件永久 inactive（可预测，不是死锁）"**完全成立**。

### B7. 不是沙箱 —— §6.3（P72）成立

> "securing the application calls for two complementary mechanisms: (1) constraining what dependencies a component may access, and (2) sandboxing untrusted code from the host environment. **Cordis supports the first** through dependency declarations and interception; **the second requires an external sandbox**."
> "This is structurally similar to capability-based security, where authority is conferred by possession of a reference rather than by ambient authority."

→ 报告"不是沙箱；能力式访问控制不等于安全隔离"成立。

### B8. 系统边界外 emission 不可回滚 —— §6.1（P71）成立

> "In the **emission** stage, the operation pushes data through that channel, as with the bytes a write hands to the file or the datagram a send puts on the wire, and the push acts as **id_Γ**, leaving the data where other parties may read and write it."
> "A system that must nonetheless recover from an emission has two approaches available. One is to **withhold** an emission until the state that produced it is certain to persist… The other is **compensation**: an action that restores the state up to an equivalence the application supplies, coarser than the ≃ of Definition 33."
> "The metatheory does not [transfer]: the commutation of Definition 65 is proved against ≃ and has to be re-established against the coarser one."

→ 报告"只能靠 compensation / withholding（§6.1）"成立，且报告漏掉了一个更狠的点：**定理在更粗的等价上不成立，要重新证**。

### B9. 状态不跨 reload —— §7.3（P80）成立

> "Cordis reverts the old component's tracked effects and reapplies the new component's from a clean slate, so **a component's own in-memory state does not survive a reload** unless placed in a longer-lived dependency, and **layering DSU-style forward migration atop revertible effects is future work**."

→ 报告"组件内存状态不跨 reload；DSU 式状态迁移是 future work（§7.3）"**完全成立**。

### B10. ⚠️ 报告漏了的自承边界（论文自己说的）

P55 / P56：整体保证的措辞是**限于状态**：
> "it speaks of the state, not of the emissions the system produced along the way, which cross [the boundary]"

§5.3 Koishi（P70）自承方法论弱点：
> "…it is **observational rather than a controlled comparison**"
且 P69 脚注 4：
> "**Koishi currently uses Cordis v3. This paper presents Cordis v4**"

→ 这是报告完全没有提的关键：4000+ 插件的生产验证跑的是 **v3**，论文形式化的是 **v4**；且作者自己承认是观察性证据而非对照实验。

### B11. Koishi 数字 —— 成立

> "it has accumulated over **4000 community-contributed plugins**⁵"（P69）
→ 报告"4000+ 社区插件做生产验证"成立。

### B12. 异步 disposer 并发 —— ✅ **报告这句成立**（我的初判有误，已更正）

论文 §5.1.3（P63）：
> "The wait sits ahead of the whole recovery rather than inside one of the inverses being waited on, since **fiber.dispose initiates a fiber's effects concurrently** and a wait placed within one of them would leave the rest unordered."

本地实现双重佐证：
- `vendor/cordis/src/fiber.ts:720`：`await Promise.all(this._disposables.clear().map(async (dispose) => {...}))` —— 确实是 `Promise.all` **并发**跑。
- `vendor/cordis/src/utils.ts:27-31`：`clear() { const values=[...]; this.map.clear(); return values.reverse() }` —— 逆序（LIFO）由 `reverse()` 实现。
- `docs/cordis-tutorial/02-lifecycle-and-effects.zh.md:94` 原话：
  > "disposer 会按注册顺序的逆序启动，但多个**异步** disposer 会并发运行。如果拆除步骤必须按顺序执行，请把它们放在同一个 disposer 中，并在其中依次等待每步完成。"

→ 判定：**报告"多个异步 disposer 会并发执行，拆除顺序要自己保证"完全正确**，论文与本地源码/文档三方一致。
（更正说明：我最初把论文里"provider 等 dependents 先停"与"同 fiber 内 disposer 并发"混为一谈，误判为报告外推。实测源码后确认报告是对的。）

### B13. 相关工作覆盖度 —— 报告有清单偏差

论文 §7 实际覆盖：
- §7.1：ZIO、Effect-TS、fp-ts；**Effekt**（Brachthäuser et al., effects as capabilities，论文称"the extension closest to our work"）；**Heunen et al.（dagger arrows / inverse arrows，论文称"the formal account closest to our revertible effects"）**；Orchard et al. graded modal types / **Granule**。
- §7.2：Context-oriented programming（COP）；AOP。
- §7.3：quiescence(Kramer&Magee)/tranquility；DSU（Hicks、Stoyle、Kitsune）；Erlang/OTP；**HMR(webpack/Vite)**；OSGi/Eclipse/IntelliJ/VSCode 插件生命周期；Command pattern；**saga**；effect handler finalizers；event sourcing；**React useEffect**；STM；可逆计算（Landauer/Bennett/Janus）；可逆进程演算（RCCS、Phillips&Ulidowski）；线性类型/RAII/Rust ownership；Kim&Rinard 的 per-operation inverse 验证；**Nooks / shadow drivers / Akeso**。
- §7.4：DI 框架（Spring/Guice/Angular/Inversify、Vue provide-inject、React Context）；**OSGi DS + iPOJO + Gravity + R-OSGi**；FRP / signals（SolidJS、Vue、Angular Signals、glitch freedom）。

⚠️ **报告漏了两个"最近邻"**，而这两个恰恰是论文自己点的：
1. **Effekt**（capability-based effects）——论文自认最近的效应系统近亲；
2. **Heunen et al.**（可逆效应语义）——论文自认最接近 revertible effects 的形式化工作。
3. 还漏了 **Granule / graded modal types**——effects+coeffects 统一的类型层已有先例（论文用它说明自己是"抬到运行时"）。
4. ⚠️ **integrant 全文 0 命中**：论文**没有**讨论 Clojure integrant（依赖图 + 可逆 halt），这是论文相关工作的一处真空，也是"史无前例"最强的潜在反例候选（待 prior-art-hunter 确认）。

## C. 本地源码交叉核对（我自己做的，不依赖 local-auditor）

### C1. ⚠️ FiberState 枚举与报告不符（报告漏了 FAILED、顺序也错）

`dsh/vendor/cordis/src/fiber.ts:139-154`：

```
/**
 * `PENDING` — waiting for required services; `LOADING` — the plugin callback
 * is running; `ACTIVE` — loaded and providing; `FAILED` — the callback or its
 * config threw; `UNLOADING` — disposers are running; `DISPOSED` — the fiber
 * was removed and cannot restart.
 */
export const enum FiberState {
  PENDING,
  LOADING,
  ACTIVE,
  FAILED,
  DISPOSED,
  UNLOADING,
}
```

- 报告写 "PENDING → LOADING → ACTIVE → UNLOADING → DISPOSED"；
- 实际枚举有 **6 个状态**，报告**漏了 FAILED**（失败态），且枚举声明顺序是 `DISPOSED` 在 `UNLOADING` **之前**（说明它是 bitmask 式 enum，不是顺序状态机）。
- 行号 `fiber.ts:147` **准确**（正是 `export const enum FiberState {` 那一行）。

→ 报告的状态机描述**不完整且把 enum 误读成线性状态机**。这是文档里常见的简化，但作为"核验报告"应指出。

### C2. README 指向论文 —— 成立，行号 7

`dsh/README.md:7`：
> "It is built on an **everything-is-a-plugin** architecture and powered by [Cordis](https://github.com/cordiverse/cordis), whose design is described in [_A Programming Paradigm for Spatiotemporal Composability_](https://arxiv.org/abs/2608.25512)."

→ 报告"README 直接指向论文"成立。

## D. Lead 阶段性判断（待队友结论合并）

1. 论文**真实存在**，元数据（北大+DeepSeek、92 页、2608.25512）全部核实。
2. 论文**从不用"史无前例"类措辞**，反而逐个点名最近邻并划边界 —— 报告这点对。
3. 论文**自承**的边界比报告列的更多/更关键：Koishi 验证跑 v3 / 论文形式化 v4；观察性而非对照；整体保证只说状态不说 emission。
4. 报告的**事实错误**集中在三处：
   - FiberState 漏 FAILED、把 enum 当线性状态机；
   - "多个异步 disposer 并发执行、拆除顺序自己保证"——论文实为**通过把 wait 前置解决**了顺序，且有 Theorem 73 termination；
   - 相关工作漏掉 Effekt / Heunen et al. / Granule 三个论文自认的近邻。
5. 报告的**最大空白**：论文相关工作**完全没提 integrant**（等 prior-art-hunter 判定其是否真构成反例）。
