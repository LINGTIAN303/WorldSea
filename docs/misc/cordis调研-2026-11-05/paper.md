# 论文一手核验（arXiv 2608.25512）

> 撰写：Lead（原 paper-verifier 队友在收尾阶段崩溃，无产出；本文件由 Lead 用其已下载的 `paper.pdf` 直接抽取原文完成）
> 抽取方式：`pypdf` 读 92 页 → `paper-fulltext.txt`（300,412 字符）
> 原则：每条给英文原句 + 章节/页码；找不到写"无法证实"，不推测

## 0. 元数据（arXiv abs 页 + 本地 PDF 双证）

| 项 | 值 |
|---|---|
| 编号 | arXiv:2608.25512 (cs.PL) |
| 标题 | A Programming Paradigm for Spatiotemporal Composability |
| 作者 | Yifan Shi (1,2), Wei Zhang (1), Tianyi Cui (2) |
| 单位 | (1) Peking University (2) DeepSeek-AI |
| 页数 | 92 pages, 1 figure, 2 tables（PDF 实抽 92 页） |
| 提交 | [v1] Wed, 26 Aug 2026 08:22:19 UTC（仅 v1） |
| HTML | `arxiv.org/html/2608.25512v1` → **404 无 HTML**，只能走 PDF |
| DOI | https://doi.org/10.48550/arXiv.2608.25512 |

**判定：论文真实存在，报告元数据（北大+DeepSeek、92 页、编号）全部成立。**

## 1. 摘要是否统一两条轴 —— 成立

> "We identify two orthogonal dimensions of the problem: **temporal composability**, the ability to completely revert a component's side effects upon removal, and **spatial composability**, the ability to declare and reactively manage inter-component dependencies."
> "We then **unify the effect context and the coeffect context into a single context type** and mediate every effect and coeffect through it, yielding a discipline we call **the context paradigm**; the mediation induces an **observational equivalence** up to which the effects of distinct components interleave without disturbing one another."

## 2. §1.1 两条轴定义 —— 成立（P4）

> "**Temporal composability** addresses the time dimension: upon removal of a component, the modifications the component made to the shared environment must be completely and safely reversed. This requires tracking every resource allocation, event registration, and state mutation the component performs, and guaranteeing their orderly reclamation upon removal."
>
> "**Spatial composability** addresses the space dimension: components must be able to declare, discover, and resolve their dependencies on one another in a structured and verifiable manner. This requires managing dependency topology and coordinating component lifecycles in response to dependency changes."
>
> "In the static setting, temporal composability reduces to **lexical scoping (e.g., RAII, bracket patterns)**, and spatial composability reduces to **module import resolution**."

## 3. VS Code 反例统计 —— **成立，但报告省略了限定语**

§1.2.1（P4–5）：
> "Temporal limitation. VSCode runs all extensions in a shared process called the extension host. Although extensions can be installed dynamically, this host provides no mechanism to unload an individual extension's code at runtime."
> "Among the top 100 extensions by install count, however, **87 contain executable code**¹ and will therefore require such a restart upon removal."
> "VSCode provides a **deactivate** hook, it serves only as a **graceful shutdown callback during the host process' termination**, and thus does not enable live removal. Moreover, the hook separates effect disposal from effect creation (in activate), violating locality of concern and making complete cleanup difficult to verify."
> "**Spatial limitation.** VSCode does provide extensionDependencies ... among the top 100 extensions by install count, **only 7 declare extensionDependencies on non-built-in extensions**.¹"

脚注 1：**"Data retrieved from the Visual Studio Code Marketplace on June 9, 2026."**

偏差：报告写"只有 7 个声明扩展间依赖"，原文限定 **on non-built-in extensions**（非内置扩展）。数字本身准确。

## 4. 零样本事实：**论文从不用"史无前例"类措辞**

全文检索结果：

| 检索串 | 命中 |
|---|---|
| `unprecedent` | **0** |
| `novel` | **0** |
| `to our knowledge` | **0** |
| `we are not aware` | **0** |
| `first formal` | **0** |
| `first system` | **0** |
| `no prior` | **0** |

`first` 出现 49 次，全部用于描述他人先例（"Moggi [16] **first** modeled computational effects categorically via monads"；"Lucassen and Gifford ... **first** introduced a kinded type system"）。

论文真正的新颖性主张（摘要 + §1.3）是**功能性**而非**排他性**：
> "Despite the growing practical importance of dynamic composition, **its theoretical foundations remain underdeveloped**."
> §1.3："We make the following contributions: ... 3. We introduce the context paradigm ... 5. We implement these ideas in Cordis ..."

**判定：报告"论文自己也没用 first / unprecedented 这类词"成立。这是报告里判断最准确的一条。**

## 5. §5.1.1 逆操作不验证 —— 成立，但 **"unchecked obligation" 是报告加工出的术语**

P59 原文：
> "**What the operation does not check** is the witness that 𝔈*Γ carries: the callback supplies an inverse, and **that the inverse reverts the effect it accompanies is an obligation on the component author rather than a property the runtime verifies**."
> "The witness of a coeffect (Definition 46) is **unchecked in the same way**: that the operations published at a key commute is an obligation on the component providing it."
> "Theorem 68 is where the calculus appeals to it, and **Section 6.1 is where the obligation is delimited**."

全文 `unchecked` 仅 1 次命中（就是第 2 句）。论文用的是 **obligation on the component author（作者义务）** + **runtime does not verify（运行时不做验证）**两句话。
→ "unchecked obligation" 并非论文的连写术语，是报告把两句拼成的标签。**实质正确，术语是二次加工。报告引 §5.1.1 章节号正确。**

## 6. §6.1 emission 不可回滚 —— 成立，且报告漏了更狠的一层（P71）

> "In the **emission** stage, the operation pushes data through that channel, as with the bytes a write hands to the file or the datagram a send puts on the wire, and **the push acts as id_Γ**, leaving the data where other parties may read and write it."
> "A system that must nonetheless recover from an emission has two approaches available. One is to **withhold** an emission until the state that produced it is certain to persist, which is the output commit problem of rollback-recovery. The other is **compensation**: an action that restores the state up to an equivalence the application supplies, coarser than the ≃ of Definition 33."
> "**The metatheory does not**: the commutation of Definition 65 is proved against ≃ and **has to be re-established against the coarser one**."

→ 报告"只能靠 compensation / withholding（§6.1）"成立。**报告漏掉的是：定理在更粗的等价上不再自动成立，需重新证。**

## 7. §6.3 不是沙箱 / §6.5 循环依赖 / §7.3 DSU 为 future work —— 三条全部成立

§6.3（P72）：
> "securing the application calls for two complementary mechanisms: (1) constraining what dependencies a component may access, and (2) sandboxing untrusted code from the host environment. **Cordis supports the first** through dependency declarations and interception; **the second requires an external sandbox**."
> "This is structurally similar to **capability-based security**, where authority is conferred by possession of a reference rather than by ambient authority."

§6.5（P74）：
> "a dependency cycle simply leaves the involved components **permanently inactive** ... **Unlike deadlock** in concurrent systems, which depends on the schedule and must be detected as it happens, this condition is **predictable from the dependency declarations alone**."

§7.3（P80）：
> "Cordis reverts the old component's tracked effects and reapplies the new component's from a clean slate, so **a component's own in-memory state does not survive a reload** unless placed in a longer-lived dependency, and **layering DSU-style forward migration atop revertible effects is future work**."

## 8. 相关工作实际覆盖（§7，P77–82）

**§7.1 Effect 与 Coeffect 系统**：ZIO、Effect-TS、fp-ts；**Effekt**（Brachthäuser et al., effects as capabilities，"the extension closest to our work"）；**Heunen et al.**（dagger/inverse arrows，"the formal account closest to our revertible effects"）；**Orchard et al. graded modal types / Granule**（"Our contribution is orthogonal to this analysis"）。

**§7.2 编程范式**：显式线程/隐式突变；**COP**（"the resemblance is nominal"）；**AOP**（declaration vs obliviousness、lifecycle integration 两轴）。

**§7.3 时间可组合性**：quiescence(Kramer&Magee)/tranquility(Vandewoude)；DSU（Hicks/Stoyle/**Kitsune**）；**Erlang/OTP code_change/3**；**HMR(webpack/Vite)**；**OSGi/Eclipse/IntelliJ/VSCode** 插件生命周期；Command pattern；**saga**；effect handler finalizers；event sourcing；**React useEffect**；STM；可逆计算（Landauer/Bennett/**Janus**）；**RCCS / Phillips&Ulidowski**；**linear types / RAII / Rust ownership**；**Kim & Rinard**；**Nooks / shadow drivers / Akeso**。

**§7.4 空间可组合性**：DI 框架（**Spring**/Guice/Angular/Inversify、Vue provide-inject、React Context）；**OSGi DS + iPOJO + Gravity + R-OSGi**（"The closest precedent to our reactive coeffects"）；**FRP / signals**（SolidJS/Vue/Angular Signals）、glitch freedom。

**⚠️ 报告漏掉的三个论文自认近邻**：Effekt、Heunen et al.、Granule。这三个恰恰是论文承认"最接近"的，报告完全没提，导致"真正新的三点"缺少对照。

**⚠️ 论文未提的先例（对"史无前例"最致命）**：全文 `integrant` **0 命中**、`Sierra` **0 命中**、`Component`（作为 Clojure 库）**0 命中**。Clojure integrant 是"数据驱动依赖图 + 逆依赖序可逆 halt + suspend/resume"的最纯正实现（2016），论文相关工作整章未提。

## 9. Koishi 4000+ —— 成立，**但报告漏了两个致命限定**

P69：
> "Koishi is an open-source chatbot application framework built on Cordis 4. Over four years of development, it has accumulated **over 4000 community-contributed plugins**⁵"

P69 脚注 4（**关键**）：
> "**Koishi currently uses Cordis v3. This paper presents Cordis v4**, which refines the effect and coeffect semantics"

P70（**关键**）：
> "…it is **observational rather than a controlled comparison**"

P70（另一处自承）：
> "in Section 1.2.1, where inter-plugin dependencies are largely absent, **Koishi's ecosystem exhibits** [similar absence]"

→ 报告说"用 Koishi 4000+ 社区插件做生产验证"**成立，但有两个报告没说的重大削弱**：
1. 4000+ 插件跑的是 **Cordis v3**，而论文形式化的是 **v4** —— 生产验证与形式化对象**不是同一个版本**；
2. 作者自己承认这是 **observational 而非 controlled comparison**；
3. 而且 Koishi 生态**恰恰几乎没有插件间依赖**（论文自己拿来类比 VS Code 的 spatial 缺陷），所以它对"空间可组合性"的验证力最弱。

## 10. 异步 disposer 并发 —— ✅ 报告成立（论文 + 本地源码 + 本地文档三方一致）

P63：
> "The wait sits ahead of the whole recovery rather than inside one of the inverses being waited on, since **fiber.dispose initiates a fiber's effects concurrently** and a wait placed within one of them would leave the rest unordered."

本地实现：
- `vendor/cordis/src/fiber.ts:720` → `await Promise.all(this._disposables.clear().map(...))`
- `vendor/cordis/src/utils.ts:27-31` → `clear(){ ... return values.reverse() }`（LIFO 由 reverse 实现）
- `docs/cordis-tutorial/02-lifecycle-and-effects.zh.md:94` → "disposer 会按注册顺序的逆序启动，但多个**异步** disposer 会并发运行。如果拆除顺序必须按顺序执行，请把它们放在同一个 disposer 中，并在其中依次等待每步完成。"

## 11. 报告未提、但论文自承的其它边界

| 位置 | 论文原句 | 含义 |
|---|---|---|
| P7 §2.3 | 与 dynamic composability 的关系章节 | 论文把 effect/coeffect 定位为"理论支柱"，非既有实现 |
| P75 §6.6 | "The coeffect model provides only **nominal linking (by key name)** but no versioned or structural linking" | **依赖只按 key 名匹配，无版本、无结构兼容检查** —— 这是报告完全没提的重大工程风险（key 冲突 / 接口漂移） |
| P55 | "it speaks of the **state**, not of the emissions the system produced along the way" | 整体保证的措辞本身就把 emission 排除在外 |
| P83 §8 | "a compelling direction for **future validation** is self-evolving agent harnesses" | **论文明确把 agent harness 列为"未来验证"，而非已完成成果** |

## 12. 逐条判定汇总

| # | 报告断言 | 判定 |
|---|---|---|
| 1 | arXiv 2608.25512 / 北大+DeepSeek / 92 页 | ✅ 成立 |
| 2 | 摘要统一 effect context 与 coeffect context | ✅ 成立 |
| 3 | §1.1 两条轴定义、静态退化为 RAII / module import | ✅ 成立 |
| 4 | VS Code：87 个含可执行代码、7 个声明依赖、deactivate 只在退出时跑 | ✅ 成立（报告省略 "non-built-in" 限定） |
| 5 | §5.1.1 "unchecked obligation" | ⚠️ 实质成立，术语为报告加工 |
| 6 | §6.1 emission 只能 compensation/withholding | ✅ 成立（报告漏"定理需重证"） |
| 7 | §6.3 不是沙箱 / §6.5 循环依赖 inactive 非死锁 / §7.3 DSU future work | ✅ 三条全成立 |
| 8 | 论文不用 first/unprecedented | ✅ 成立 |
| 9 | 相关工作点名 OSGi/Erlang/React/Effect-TS/可逆计算/Koishi | ✅ 成立，但**报告漏 Effekt / Heunen / Granule** |
| 10 | Koishi 4000+ 生产验证 | ⚠️ 数字成立，**但验证跑 v3、论文形式化 v4；observational 非对照** |
| 11 | 多个异步 disposer 并发、顺序自理 | ✅ 成立（三方差证） |

## 13. 报告完全没提、但对结论有实质影响的四件事

1. **Koishi 验证版本错配**（v3 生产 vs v4 形式化）。
2. **依赖只按 key 名匹配**（§6.6：无版本、无结构兼容）—— 实际工程风险远大于报告描述。
3. **Clojure integrant 全文未提** —— "两条轴统一"最纯正的既有实现被相关工作遗漏。
4. **agent harness 被论文自己列为 future validation**，而报告的结论把 dsh 当作"已完成落地样本"。
