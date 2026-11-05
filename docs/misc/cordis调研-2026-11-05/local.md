# 本地核验：dsh 仓库内 Cordis 源码与文档引用逐条比对

> 撰写：Lead（原 local-auditor 队友在收尾阶段崩溃，无产出；本文件由 Lead 直接对 `D:\WorldSea\dsh` 逐行核验）
> 原则：行号一律自行 grep/read 确认，不沿用报告给的引用；对不上就写偏差

## 1. Fiber 状态机 —— 报告 **漏了 FAILED，且把 bitmask enum 误读为线性状态机**

报告引 `vendor/cordis/src/fiber.ts:147`，行号**准确**。但 `fiber.ts:139-154` 实际内容：

```ts
/**
 * Lifecycle state for one plugin fiber.
 *
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

偏差三处：
1. **报告漏了 `FAILED`**（插件 apply 或 config 抛错）—— 这是 6 态中的第 4 态，工程上很重要；
2. 枚举声明顺序是 `... DISPOSED, UNLOADING`（DISPOSED 在 UNLOADING **前**），不是报告写的 `→ UNLOADING → DISPOSED` 线性链；
3. 官方文档画的是**带分支**的状态机，不是单链。`docs/cordis-tutorial/02-lifecycle-and-effects.zh.md:72-80`：

```
PENDING → LOADING → ACTIVE → UNLOADING → DISPOSED
                 ↘ FAILED
```
> - **PENDING**：已经声明，但所需服务（第 3 章）尚不可用。
> - **LOADING / ACTIVE**：`apply` 正在运行／已经完成。
> - **FAILED**：`apply` 或配置校验抛出异常。
> - **UNLOADING / DISPOSED**：disposer 正在运行／一切均已拆除。

**判定：实质方向正确，但"PENDING → LOADING → ACTIVE → UNLOADING → DISPOSED"这一串漏掉了 FAILED 分支。**

## 2. ctx.effect / disposer / LIFO / 异步 await / 父 dispose 递归 —— **全部成立**

- `fiber.ts:421-424` 有 `effect(execute): Disposable | AsyncDisposable` 两个重载，返回 disposer。
- `utils.ts:5-40` `DisposableList`：
  ```ts
  push(value){ const sn = ++this.sn; this.map.set(sn, value); ... }
  clear(){ const values=[...this.map.values()]; this.map.clear(); return values.reverse() }
  ```
  **LIFO 由 `reverse()` 实现**，确认。
- `docs/.../02-lifecycle-and-effects.zh.md:66`（报告引 `:68`，**实际是 66**，偏差 2 行）：
  > "`fiber.dispose()` 会等该插件的所有清理工作（包括异步 disposer）完成后才结束，并**递归卸载它挂载的所有子插件**。"
- 同文件 `:86-90`："你很少需要亲自编写 `ctx.effect()`，因为**内置注册 API 本身已经是 effect**" + "`ctx.plugin(child)`：子插件会随父插件一同 dispose" + "服务注册属于 effect"。

**判定：报告 4 条子断言全部成立；引用行号 68 偏 2 行（68 是 `## Fiber 状态机` 标题行）。**

## 3. inject / notify / isolate / intercept —— **三条成立，"intercept" 的引用行号有偏差**

- `inject`：`registry.ts:300` 正是 `inject(inject: Inject, callback: Plugin.Function<void>)`，**行号准确**。
  > "@param inject — required services, as an array or a name → config map."
- `inject` 是持续跟踪而非一次性检查 —— `docs/cordis-tutorial/03-services.zh.md:74-76`：
  > "## 加载后仍会跟踪依赖关系
  > `inject` 并非一次性的启动检查。如果应用运行期间所需服务消失，例如提供方被卸载或热替换，每个依赖插件也会随之卸载，并在服务恢复后再次加载。"
- `notify`：`reflect.ts:335` `notify(names: string[], filter = ...)`；`fiber.ts:599`、`reflect.ts:309/313` 调用点确认。
- `isolate`：`context.ts:109-113` —— **报告引 context.ts:109 命中，但落在 isolate 的 JSDoc 上**：
  > "Create a child context with an **independent service scope** for `name`. Below the returned context, reads and writes of the service `name` resolve against the new label instead of the parent's"
- `intercept`：**不在 `context.ts:109`，而在 `context.ts:139-144`**（报告把 isolate 与 intercept 都归到 109，偏差约 30 行）：
  ```ts
  intercept(name: string, config: any) {
    const intercept = Object.create(this[symbols.intercept])
    intercept[name] = config
    return this.extend({ [symbols.intercept]: intercept })
  }
  ```
  语义（`context.ts:19`）："Intercept map: service name → config **merged into that service's per-plugin config**" —— 即只改"怎么用"，不改"解析到谁"。**报告这句语义描述准确。**

**判定：语义全对；`intercept` 的引用行号应从 109 改为 139。**

## 4. Loader 按稳定 id 对账 / disabled 只卸载不删 / HMR 先卸后装 —— **全部成立，报告引 `:19` 准确**

`docs/cordis-tutorial/06-composition-and-hmr.zh.md:19`（**行号准确**）：
> "`id` 为 Cordis 配置项提供稳定标识，使 loader 能区分修改现有 Cordis 配置项与先删除再添加。`disabled: true` 会**卸载插件而不删除其 Cordis 配置项**；改回原值后，插件以及所有因依赖其服务而处于 PENDING 的插件都会再次加载。"

HMR（`:25`、`:59`）：
> "卸载会释放 effect，加载则遵循依赖关系，因此 HMR 可以**先卸载、再加载**，以替换正在运行的插件。"
> "旧实例先卸载（其所有 effect 都会回卷），新代码随后加载，`apply` 再次运行。"

**判定：三条全部成立。**

## 5. "没有特权核心可打补丁" / agent loop 是插件 —— **成立，且比报告引的 :9 更强**

`docs/architecture.md:9`（**行号准确**）：
> "[Cordis] is the framework under dsh: plugins contribute services, typed events, and reversible effects to a shared context. **Every part of the product is a plugin, including the model adapter, the tool registry, the session log, and the agent loop itself**, so each is replaceable from configuration."

报告引的 `:9` 只是前半句，**真正"没有特权核心"原句在 `:11`**：
> "**There is no privileged core to patch**: you extend dsh by mounting a plugin beside the others, and **registrations are effects that unwind when their plugin unloads**."

**判定：成立，报告引用行号 9 命中但漏了 11 那句关键原话。**

## 6. agent loop 是否真做成可热替换插件 —— **成立，有代码级证据**

`packages/core/agent-loop/src/index.ts:336`：
```ts
ctx.effect(() => ctx.agents.setFactory(this), 'agentLoop.setFactory()')
```

- `packages/core/agent/src/index.ts:383` `setFactory(factory: AgentFactory): () => void`；
- 同文件 `:244` JSDoc："(`@deepseek-ai/dsh-agent-loop`), registered via `setFactory`"；
- `:171` 注明创建能力"Kept on the `dsh-agent` interface"（即核心只留槽位，实现由插件提供）；
- `packages/extensions/tool-cordis/src/api-catalog.ts:265` 对外描述："Agent *creation* is provided by whichever plugin implements the AgentFactory (`@deepseek-ai/dsh-agent-loop`), registered via setFactory."

> `ctx.effect(...)` 包裹意味着：**卸载 agent-loop 插件时该工厂槽位自动回卷（清空）**，符合"注册即 effect"。

**判定：不是文档修辞，是真实的槽位式热替换；`ctx.effect` 包裹保证了卸载即回卷。**

## 7. 报告归给论文的四条边界，在 dsh 本地的对应证据

| 报告断言 | dsh 本地证据 | 结论 |
|---|---|---|
| 多个异步 disposer 并发、拆除顺序自理 | `fiber.ts:720` `await Promise.all(this._disposables.clear().map(...))`；`02-lifecycle-and-effects.zh.md:94` 明文警告 | ✅ **完全成立** |
| 组件内存状态不跨 reload | dsh 本地未明说；论文 §7.3 P80 明说 | 论文侧成立，本地无对应文档 |
| 不是沙箱 | 论文 §6.3；dsh 另有独立 `packages/sandbox/` 做进程级隔离 | ✅ 成立（dsh 把沙箱做成独立包，正是"外部沙箱"的体现） |
| 循环依赖永久 inactive | `03-services.zh.md:72` 描述 PENDING 停驻；论文 §6.5 讲循环 | ✅ 成立 |

## 8. Cordis 官方对"时空可组合性"的本地自述 —— **注意：dsh 文档几乎不用这个词**

检索 `docs/**` 全库：`cordis-primer.zh.md` 与 `cordis-tutorial/` 中：
- **`时空` / `spatiotemporal` 命中 0 次**（在教程与 primer 里）；
- 只有 `README.md:7` 指向论文时才出现该概念。

`cordis-primer.zh.md:13` 的实际表述方式是行为式的：
> "**注册是可逆的副作用。** 提示词片段、工具 schema、适配器、提供方和监听器通过 `ctx.effect()` 或 `ctx.on()` 安装，reload 和 teardown 时会按预期撤销。"

`:51`：
> "每个注册都应有对应的 disposer ... 如果 teardown 顺序有要求，请将相关工作放在同一个 effect 中，以确保资源按预期顺序释放。"

**判定：报告"README 直接指向论文"成立（`README.md:7`，原句已核）；但要提醒——"时空可组合性"是论文的术语，dsh 自己的教程/primer 里几乎不用这个词，用的是"可逆副作用 / 依赖跟踪"这类工程化表述。**

## 9. 报告本地引用的行号偏差汇总

| 报告引用 | 实际 | 偏差 |
|---|---|---|
| `fiber.ts:147` | `fiber.ts:147`（`export const enum FiberState`） | ✅ 准确 |
| `02-lifecycle-and-effects.zh.md:68` | 实为 `:66`（`:68` 是标题行） | 偏 2 行 |
| `context.ts:109` | `:109` 是 **isolate**；**intercept 在 `:139`** | isolate 准确，intercept 偏 ~30 行 |
| `registry.ts:300` | `:300`（`inject(...)`） | ✅ 准确 |
| `06-composition-and-hmr.zh.md:19` | `:19` | ✅ 准确 |
| `architecture.md:9` | `:9` 命中；"没有特权核心"原句在 `:11` | 命中但漏句 |

## 10. 报告未提、但本地存在的重要事实

1. **插件颗粒度远超报告描述**：`dsh/packages/` 下有 **372 个带 `package.json` 的包**，横跨 51 个分组（`client` 69、`experimental` 65、`session` 22、`util` 21…）。报告说"连 agent loop、tool registry、session log 都是插件"——这还只是举例，实际上 subagent(9)、jobs(3)、workflow(3)、goal(4)、schedule(2)、guard(2)、plan(1)、mcp(2) 等能力全部是包。**"一切皆插件"在 dsh 里是可数的工程事实，不是修辞。**
2. **`packages/sandbox/` 独立存在（4 个包）**：印证论文 §6.3"沙箱需外部机制"的说法在 dsh 里被显式落实为独立一层。
3. **`vendor/AGENTS.md` 明确 Cordis 是 pinned source copy（带 upstream SHA 的 vendored 副本）**，不是 fork —— 说明 dsh 对 Cordis 的改动是被登记管理的（"Local modifications" 需逐条记录），这会削弱"dsh 自己魔改了框架"的猜测，但也说明 Cordis 上游与 dsh 是同一批人维护。
4. **"时空可组合性"这个词在 dsh 全库只出现 2 次**：`README.md:7` 与 `README.zh.md:7`，都只是引用论文标题。`docs/` 全目录（含 tutorial / primer / subsystems）**零使用**该术语 —— 文档一律用工程化表述（"注册是可逆的副作用"、"依赖跟踪"）。
