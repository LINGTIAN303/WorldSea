# 壳代理路径白名单运行时化（A 方案）交接文档

> **status: 已完成（交接使命结束，2026-11-03）**——已转为本仓可施工批计划 [2026-11-03-壳插件前缀白名单运行时化批计划.md](2026-11-03-壳插件前缀白名单运行时化批计划.md)，**该批已完成并归档，施工与验收以它为准**；本文保留为问题取证与技术来源。
>
> 本文是**跨仓交接件**：由插件侧（`E:\dsh-agents-Visualization`）只读排查产出，**未改动 WorldSea 任何文件**。
> 落地时请遵守 WorldSea 自己的治理口径（`arch:check` / `fork:check` / `permissions/worldsea-shell.toml` / 400 行上限 / dsh fork 台账登记）。
>
> **转计划时补正的 4 处**（原文事实全部核对无误，以下为原文未覆盖、影响方案成立的点，详见批计划 §七）：
> 1. 壳对**未知帧类型**是 fail-closed 断链（`dsh_pipe_io.rs:328` 的 `_ => false` → `:59-62`），原文「旧壳忽略未知字段」只对旧壳成立；本仓壳只忽略 hello 帧内的多余**字段**，不忽略新**帧类型**。
> 2. 一次性快照会被**插件热装**打破（`boot/plugin-manager` + base bundle 的 `hmr` 行），故壳侧改为「未命中 → 试探转发 + 落档」。
> 3. `routePrefixes` 须在**连接建立时**求值（carrier 每连接新建），不能在 `installPipeCarrier` 装配时求值一次。
> 4. 壳侧 `dsh_proxy.rs` / `dsh_pipe_io.rs` / `dsh_bridge.rs` 施工后将越 400 行上限；`webserver/src/index.ts` 已 630 行，但 `dsh/` 不在 `arch:check` 的 `discoveryRoots` 内故不受该门禁约束。

## 一、为什么要做这件事（问题陈述）

### 1.1 现象

插件 `dsh-agents-visualization@0.1.2` 装进 WorldSea 的 web profile 后：

- 设置页 **「规则」入口正常出现**（客户端 bundle 走 `/plugins/`，在白名单内）
- 三个 Tab **全部显示空态、且无任何错误提示**（项目级「当前没有已注册的工作区」/ 全局级「没法解析全局目录（配置缺失）」/ 第三方「没有可扫描的第三方工具」）
- 实际是：插件全部数据接口 `404`，一个请求都没到宿主

### 1.2 根因

`apps/tauri/src-tauri/src/dsh_proxy.rs:75`：

```rust
const PLUGIN_PREFIXES: [&str; 2] = ["/dsh-whale/", "/dsh-bili/"];
```

插件 API 前缀 `/dsh-agents-visualization/api` **不在白名单** → `proxy()` 在 `:181-184` 直接 `404`，不转发。
宿主侧插件 Host 半边其实**正常加载并注册了路由**（`webServer.register({kind:'prefix'})` 成功），只是被壳挡在外面。

### 1.3 机制性缺陷（这才是要修的）

| # | 缺陷 | 证据 |
|---|---|---|
| 1 | 清单是**手工记账簿**，非可推导集合 | `PLUGIN_PREFIXES` 来源是「这台机器恰好装过什么插件」 |
| 2 | 失败模式**已重复发生两次** | `dsh_proxy.rs:73` 注释「dsh-whale-widget 即此」；C1-b 批计划 `:91` 记 `/open-in-app/apps` 误杀 |
| 3 | 失败对插件开发者**静默** | 页面只见 404；壳日志只在 debug 构建的 stdout，不落盘 |
| 4 | 代价错配：编译期常量 vs 运行时插件生态 | dsh 插件是运行时装载（profile `node_modules` + bundle patch），白名单却在 Rust 编译期内写死 |
| 5 | 注释语义混淆 | `dsh_proxy.rs:59` 说白名单「枚举自 dsh 源码」——对 `ALLOWED_PREFIXES` 成立，对 `PLUGIN_PREFIXES` **完全不成立**，二者却并列同表 |

> **关键洞察**：插件代码本身就跑在宿主进程内（能读任意文件、能注册任意路由）。壳对插件命名空间做精确字符串匹配，**不构成真正的安全边界**——它挡的是「页面被 XSS 后借道」，不是「恶意插件」。所以对插件前缀放宽，安全收益损失有限，摩擦成本却是全额。

## 二、方案（A：白名单运行时化）

### 2.1 核心思路

把「插件前缀」从 **Rust 编译期常量** 改为 **宿主启动后上报的运行期快照**：

```
宿主启动 → webserver 路由表就位 → 上报 prefix 清单 → 壳接收并缓存 → 闸门按快照判定
```

`ALLOWED_PREFIXES`（dsh 内置路由）**保持静态不动**——它有客观来源，也是安全基线。
只有「第三方插件命名空间」这一段变成运行时。

### 2.2 一个关键简化：「插件 vs 内置」如何区分

**不需要区分。** 让宿主把**整张 prefix 路由表**上报即可（内置 + 插件一起），壳用它替换 `PLUGIN_PREFIXES` 的角色，`ALLOWED_PREFIXES` 作为**兜底底集**保留（防止上报失败时页面完全不可用）。

这消掉了「谁是插件」这个无法可靠回答的问题（`node_modules` 里既有第三方也有 dsh 自带包）。

### 2.3 上报通道选型（推荐 B1，备选 B2/B3）

已核实的代码事实：

| 通道 | 可行性 | 依据 |
|---|---|---|
| **B1. 管道 hello 帧扩展** | ✅ 推荐 | `pipe-transport.ts:25` 有 `PIPE_TRANSPORT_VERSION = 1`；`:269` 发 hello 帧。**加一个可选字段 `routePrefixes` 即可，不需要新帧类型**——旧壳忽略未知字段，向后兼容 |
| B2. 就绪行附加信息 | ⚠️ 可行但要改 CLI 输出格式 | `web-app/src/index.ts:277` 打印 `dsh web: <url>`；壳在 `dsh_shell.rs` 解析该行 |
| B3. 新增 HTTP 端点 | ❌ 不推荐 | 端点自身要先过白名单，先有鸡先有蛋；且多一次请求 |

**推荐 B1 的具体做法**：

1. dsh 侧：`WebServer` 增加只读访问器，导出 prefix 清单
   - 现 `prefixes` 是 `private readonly prefixes = new Map<string, WebRoute>()`（`host/webserver/src/index.ts:309`）
   - 加一个 public getter（如 `listPrefixRoutes()`），返回 `string[]`
2. dsh 侧：`installPipeMode` 里把该清单塞进 hello 帧
   - `bundle/web-app/src/index.ts:208-213` 的 `installPipeCarrier({...})` 增参
   - `pipe-transport.ts` 的 `HelloFrame`（`:81-85`）加 `readonly routePrefixes?: readonly string[]`
3. 壳侧：`dsh_pipe.rs` 的 hello 处理保存清单 → `ProxyCfg` 增字段 → `path_allowed` 改为「静态底集 ∪ 运行期快照」

### 2.4 落地为两条独立可测的改动

| 改动 | 文件 | 规模 | 风险 |
|---|---|---|---|
| **A-1 dsh 侧上报** | `host/webserver/src/index.ts`（+getter）· `bundle/web-app/src/{index,pipe-transport}.ts` | 小（~40 行） | 低；**必须登记 fork 台账**（这两个文件已在台账内，属既有条目的增补） |
| **A-2 壳侧消费** | `apps/tauri/src-tauri/src/{dsh_proxy.rs, dsh_pipe.rs, dsh_bridge.rs}` | 中（~80 行） | 低；纯壳侧，不进 dsh 树 |

**A-1 与 A-2 必须同批上线**：只上 A-1 无害（旧壳忽略新字段），只上 A-2 则拿不到清单（回落到静态底集，等价现状）。建议一次做完。

### 2.5 安全审查（放宽了什么、没放宽什么）

| 维度 | 变化 |
|---|---|
| 路径穿越 `.`/`..` | **不变**，仍 403 |
| 方法白名单 GET/HEAD/POST | **不变**，仍 405 |
| 内置路由范围 | **不变**，`ALLOWED_PREFIXES` 仍是硬底集 |
| **插件命名空间** | 放宽为「宿主自报的全部 prefix」——即宿主本来就会路由的路径，**没有扩大宿主的攻击面** |
| 上报被篡改的风险 | 管道是壳↔宿主的私有进程内通道（`\\.\pipe\worldsea-dsh-<pid>-<ts>`），无第三方可写 |

> 结论：安全面**实质未退步**。原本的精确清单是「伪精确」——它挡不住宿主内任何代码，只挡住页面发起的、被白名单遗漏的**合法**请求。

### 2.6 顺带修掉的可观测性缺陷（建议同批）

1. **白名单 404 落盘**：现在只 `eprintln!` 到 stdout（`dsh_proxy.rs:182`），debug 构建才有。改为写壳日志文件。
2. **给页面的 404 带可辨认标记**：`failure_response` 目前给 `text/plain`（`:183`）。建议对 `is_api` 路径返回 JSON `{"ok":false,"code":"SHELL_PATH_BLOCKED"}`，让插件能识别「被壳拦了」而非「接口不存在」——这是本次排查花了大量时间才定位的直接原因。
3. **`WORLDSEA_BRIDGE_OPEN=1` 已有**，保留；建议在日志里显著提示「白名单已关闭（逃生口）」（`:100` 已有一条，可加进落盘日志）。

## 三、验收（建议）

### 3.1 单测

- dsh 侧 `webserver-external.spec.ts` / `webserver.spec.ts`：`listPrefixRoutes()` 覆盖「内置 + 动态注册的插件路由」
- `pipe-transport.spec.ts`：hello 帧含 `routePrefixes`；旧壳（不带该字段）解析不报错
- 壳侧 `dsh_proxy_tests.rs`：
  - `path_allowed` 新增「运行期快照内路径放行」
  - **保留并扩展** `allowlist_covers_enumerated_host_routes` 的负面断言（`/dsh-evil/widget.js` 必须仍拒——快照为空/未就绪时不得放行）

### 3.2 真机走查（用户手测）

| 场景 | 预期 |
|---|---|
| 装 `dsh-agents-visualization` | 设置页「规则」三个 Tab **有真实数据**（全局级显示两份 AGENTS.md、第三方列出已装工具） |
| 断点验证 | 把某插件从 `PLUGIN_PREFIXES` 删掉重启 → `WORLDSEA_BRIDGE_OPEN=1` 下功能恢复，取消该变量后 404 且**页面上有可辨认错误**（验证 2.6-2） |
| 负向 | 页面 `fetch('/etc/passwd')` 仍 404；`fetch('/assets/../secret')` 仍 403 |

## 四、施工顺序建议

1. **先做 A-1 的 getter + hello 帧字段**（dsh 侧），跑 dsh 自带 typecheck/test，登记 fork 台账
2. **再做 A-2 壳侧消费**，跑 `cargo test --lib`（现有基线 146 例）
3. **同批补 2.6 的可观测性**（改动小，收益直接）
4. **删除 `PLUGIN_PREFIXES`**，或降级为「静态兜底快照」（保留 `/dsh-whale/`、`/dsh-bili/` 作为上报失败时的底集）
5. 门禁全跑：`pnpm arch:check` · `pnpm fork:check` · `cargo test` · vitest

## 五、与「插件侧修复」的对比（为什么不选那条）

插件侧方案是把 API 挂到 `/plugins/dsh-agents-visualization/api`（`/plugins/` 在白名单内）。**不采纳**，理由：

- 它让插件承担了壳的实现细节——**其他插件作者不会知道要这么做**
- dsh 标准写法就是 `webServer.register({kind:'prefix', path:'/<plugin-name>/api'})`，插件没错
- 治标不治本：下一个带 API 的插件还会撞同一堵墙

## 六、参考资料（本文档的事实来源，均在 WorldSea 仓内）

| 文件 | 用途 |
|---|---|
| `apps/tauri/src-tauri/src/dsh_proxy.rs:61-75,106-117,181-184` | 白名单定义、判定、404 落点 |
| `apps/tauri/src-tauri/src/dsh_proxy_tests.rs:470-512` | 清单锁定用例 |
| `apps/tauri/src-tauri/src/dsh_bridge.rs:103-156` | 壳侧 `ProxyCfg` 装配（A-2 落点） |
| `dsh/packages/host/webserver/src/index.ts:308-309,375-396` | 路由表与 `register` |
| `dsh/packages/bundle/web-app/src/pipe-transport.ts:25,81-85,269` | 管道协议版本与 hello 帧 |
| `dsh/packages/bundle/web-app/src/index.ts:199-224` | `installPipeMode`（A-1 落点） |
| `docs/details/架构/dsh-fork台账.md` | **A-1 必须登记**（`webserver/src/index.ts`、`web-app/src/{index,pipe-transport}.ts` 已在台账内） |
| `docs/details/注释/tauri/dsh-bridge.md` | 路径闸门口径（改动后需同步） |
| `docs/plans/已完成/2026-09-24-C1-Tauri原生desktop载体批计划.md:84,91` | 闸门立项与两次误杀记录 |

---

## 附：插件侧待办（WorldSea 修好后再处理，**不属于本批**）

- 全空态时「没法解析全局目录（配置缺失）」文案误导——它实际是「/state 请求失败」的假空态
- 切 Tab 调用 `resetSelection()` 会清掉错误横幅（`client.js` 内 `setErr(null)`），导致失败状态不可见
