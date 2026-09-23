# C1 批计划：Tauri 原生「desktop 类」载体

> **status: 待拍板**（2026-09-24）｜ 上游策略前提：**本项目 fork dsh、不追随上游**（D10）；C1 的产物是「壳自有的 desktop 级载体」，其技术模板 = dsh 自己的 Electron desktop 载体（只借机制、不复刻其打包流水线）。
> 关联：[准备方案](2026-09-23-dsh接管Agent面-大重构准备.md) §六/§九 · [dsh fork 台账](../details/架构/dsh-fork台账.md) · [运行手册](../details/架构/dsh-运行手册.md)

---

## 一、目标与非目标

**目标**：把「WebView 直连 `http://127.0.0.1:<port>`」升级为 **UI origin 与传输面分离** 的 desktop 级载体：
1. **UI origin** = 自定义协议（如 `worldsea://app/`）——页面不再是 `http://127.0.0.1` 来源；
2. **传输面**（`/api` 与 `streamBaseUrl` 的 WS）保持 loopback——**这是刻意的**（WebView 自定义协议不支持 WebSocket，Electron 桌面版同样保留 loopback 19387，见 §二 事实 1）；
3. 壳件补齐（单实例/托盘已在；菜单、通知、更新按需）；
4. 壳桥按需注入（`initialization_script`）。

**非目标**：
- 不复刻 Electron 的打包流水线（runtime/projectDir/包集 + release identity）——那是「1:1 指工程不指代码」的反面；
- 不做 `--profile desktop`（CLI 拒绝管理该 profile，且其宿主态依赖 Electron 的 fd 通道）；
- **真·无端口不是本批目标**——那是 C2（用 `__DSH_TRANSPORT__` 接缝把传输换掉）。

## 二、事实基线（2026-09-24 取证，来源均为 fork 内 dsh 代码）

| # | 事实 | 出处 |
|---|---|---|
| 1 | desktop 载体**同样开 loopback 端口**（19387）；`dsh-app://` 只伺服**静态资源**，`/api`+WS 仍走 loopback | `apps/desktop-host/src/index.ts:28`、`docs/architecture.md:55` |
| 2 | 客户端流通道的基址读 `globalThis.__DSH_TRANSPORT__?.streamBaseUrl ?? document.baseURI`；desktop 注入 `streamBaseUrl = new URL(hostUrl).origin`（即 loopback） | `packages/api/gateway/src/client/stream-client.ts:476-477`、`apps/desktop/src/main.ts:585` |
| 3 | desktop 的静态伺服：从**打包 dist** 读文件（MIME 表 + 越界 403/越权 405/缺失 404），并在 `<head>` 后插引导脚本 `globalThis.__DSH_BOOT_READY__ = Promise.withResolvers()` | `apps/desktop/src/web-document.ts:24-49` |
| 4 | 鉴权：把宿主打印的**带 token URL** `fetch(..., {redirect:'manual'})` → 取 **303 的 `set-cookie`**（`dsh-auth-*`）→ 作为 `Cookie` 头**转发**给宿主的 `/api`；页面侧不需要自己持 token | `apps/desktop/src/web-document.ts:56-70` |
| 5 | UI 的 index 注入（`__DSH_BOOT__` 插件图等）是**宿主渲染**的：`frontend-static` 拿 index 时先过 Connection 鉴权，再走 `webServer.renderIndex`（结构化注入行）；`__DSH_BOOT__` 由 `client-modules` 作为 global 注入行推入 | `packages/host/frontend-static/src/index.ts`（模块头）、`packages/host/webserver/src/index.ts:360`、`packages/client/modules/src/index.ts:585` |
| 6 | 宿主 CLI 有 `--trusted-host <authority...>`（`/api` 浏览器信任围栏的额外白名单） | `apps/cli` web app `--help` |
| 7 | Tauri 2.11.5 有 `register_uri_scheme_protocol` / `register_asynchronous_uri_scheme_protocol`；仓内已有 `reqwest`(blocking,rustls) 与 `ureq`，**无需新增依赖** | `tauri-2.11.5/src/app.rs:2130/2198`、`apps/tauri/src-tauri/Cargo.toml` |

**现役壳形态**（B2/B3/B5）：`dsh_shell.rs` spawn `node dsh/apps/cli/lib/bin.js web --patch <overlay> --no-open --port <空闲>` → 解析 `dsh web: <url>` → `WebviewWindow::navigate(loopback URL)`；`DSH_HOME` 默认隔离到应用数据目录；退出回收 + 可辨认失败页。

## 三、形态候选

**候选 A（推荐）：协议层「代理宿主」**
- Tauri 注册 `worldsea://app/…`：协议处理器把请求**转发到宿主 loopback**（index 直接取宿主渲染结果 → **零注入复刻**；静态资源与 `/plugins/??…` 直通）；`/api` 由处理器带 cookie 转发（照事实 4）；
- 在 index 的 `<head>` 前插一段**壳引导脚本**：`globalThis.__DSH_TRANSPORT__ = { ...(已有||{}), streamBaseUrl: 'http://127.0.0.1:<port>' }`（照事实 2，使 WS 直达 loopback）；
- 不改 dsh（纯壳侧；台账保持空），origin 与传输面分离。
- **待验证风险**：WS 握手跨源（`worldsea://` 页 → `ws://127.0.0.1`）时的 **Cookie 投递**（`dsh-auth-*` 是 `SameSite=Strict`）与宿主的 Origin 围栏——若失败，退路依次为：① 用 `--trusted-host` 放行壳 origin；② 让宿主把 WS 也走「处理器代理」（需 fork 支持）；③ 直接进 C2（message 传输，一劳永逸）。

**候选 B：Rust 自建静态伺服 + 向宿主取注入**
- Tauri 直读 `dsh/apps/web/dist` 与各包 `lib/client.js`，自己实现 index 注入（`__DSH_BOOT__` 图 + bundle 校验快照）；
- 代价：复刻事实 5 的宿主侧逻辑（fork 级），收益 = 无宿主静态伺服依赖。**不推荐**（把 dsh 的构建期知识搬进 Rust，长期跟随成本高）。

**候选 C：保持现状（不升级载体）**
- 只补壳件与桥，UI 仍由 loopback 直接伺服。成本最低；收益 = 0（origin 仍为 `http://127.0.0.1`，token 出现在首跳 URL）。

## 四、裁定点（待拍板）

| # | 裁定点 | 选项（推荐加粗） |
|---|---|---|
| ① | 载体形态 | **候选 A（协议层代理宿主）** ｜ 候选 B（Rust 自建静态） ｜ 候选 C（维持现状，仅补壳件） |
| ② | 自定义协议名与信任 | **`worldsea://app`**（+ 需要时 `--trusted-host` 放行其 authority） ｜ 其他命名（`dsh-app` 风格） |
| ③ | 壳件范围（本批） | **最小集**：单实例（已有）+ 托盘（已有）+ 菜单 + 通知（已有插件）；**更新与权限（麦克风等）后置** ｜ 全量一次补齐 |
| ④ | C2 衔接 | **C1 先把「传输基址」抽成单点（`streamBaseUrl` 注入处），C2 只换那一层** ｜ C1 不预留、C2 再重构 |

## 五、批次划分（拍板后施工；每批含实现 / 验收 / 反证 / 台账 / 文档）

### C1-a · 可行性小实验（必做，决定后续形态）
- **任务**：在现役壳上加一个**最小**自定义协议处理器（只代理 index 与一个静态资源）+ 注入 `streamBaseUrl`，起宿主 → 打开窗口；**观察矩阵**：RPC 是否通、WS 是否连上（看宿主日志与页面 console）、cookie 是否投递、Origin 围栏是否放行。
- **验收**：矩阵四格全部有明确结论（通/不通 + 原因），落档；**不通则按候选 A 的退路 ①→②→③ 选一条并回报**。
- **反证**：把 `streamBaseUrl` 注入**摘掉** → WS 必须失败（证明该注入是必要件，而非装饰）。

### C1-b · 协议伺服转正
- **任务**：把 C1-a 的实验实现转正（路径白名单、MIME、越界/越权语义、HEAD/OPTIONS、失败降级）；index 的 `<head>` 插桩与宿主注入的**共存顺序**定死并测试。
- **验收**：界面完整、RPC+WS 正常、刷新/多窗口/二次导航稳定；`dsh web: <url>` 的 token 不再出现在 WebView 可见 URL（改为壳内部交换）。
- **反证**：故意让协议处理器 404 一个资源 → 页面必须报可辨认错误（不是白屏静默）。

### C1-c · 壳件与桥
- **任务**：菜单（文件/编辑/视图 + 打开设置）、通知（已装插件，接上）、`initialization_script` 注入按需项（`dshPlatform` 等；`__DSH_HOST_PATHS__` 与 `dshDesktop` 按 B2 结论不做并登记）。
- **验收**：菜单项可用；`initialization_script` 注入项在文档开始前生效（页面读取到）。
- **反证**：摘掉注入 → 依赖它的功能必须显式降级（不静默）。

### C1-e · 收口
- **任务**：台账登记（若触 dsh）、更新准备方案 §六/§九 + 运行手册 + 索引、走查清单（用户手测）。
- **验收**：门禁全绿（`pnpm fork:check` / `arch:check` / 断链）；走查通过。

## 六、风险

| # | 风险 | 缓解 |
|---|---|---|
| R1 | WS 跨源 Cookie（`SameSite=Strict`）不投递 | C1-a 四格矩阵先测；退路 ①`--trusted-host` ②宿主侧代理 WS（fork）③直接进 C2 |
| R2 | 协议处理器成为页面**唯一**入口 → 它出错就是白屏 | C1-b 反证（404 可辨认）+ 保留「直连 loopback」回退开关（env） |
| R3 | 与宿主注入的插桩顺序冲突（`__DSH_BOOT__`/`__DSH_BOOT_READY__`/`__DSH_TRANSPORT__`） | 顺序写成契约并测试；只**合并**不覆盖（`{...existing, streamBaseUrl}`） |
| R4 | 触发 fork 改动（候选 A 的退路②）→ 台账与 dsh 自带门禁成本 | 优先 ①；真要②时按台账纪律单独立项，并跑 dsh 自带 typecheck/lint/test |
| R5 | 与 C2 目标冲突（C2 要去掉 loopback） | 裁定点 ④：传输基址单点化，C2 只换该层 |

## 七、本批不做

- 打包/分发形态（Node 运行时随包或 pkg）——独立批；
- 更新通道（自动更新/签名）；
- 产品域落位（27 芽视图）与冻结面可留候选立项。
