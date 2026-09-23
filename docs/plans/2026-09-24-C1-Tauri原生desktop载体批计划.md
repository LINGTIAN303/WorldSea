# C1 批计划：Tauri 原生「desktop 类」载体

> **status: 执行中**（2026-09-24 四裁定已拍板；C1-a 待开工）｜ 上游策略前提：**本项目 fork dsh、不追随上游**（D10）；C1 的产物是「壳自有的 desktop 级载体」，技术模板 = dsh 自己的 Electron desktop 载体（只借机制、不复刻其打包流水线）。
> 关联：[准备方案](2026-09-23-dsh接管Agent面-大重构准备.md) §六/§九 · [dsh fork 台账](../details/架构/dsh-fork台账.md) · [运行手册](../details/架构/dsh-运行手册.md)

---

## 一、目标与非目标

**目标**：把「WebView 直连 `http://127.0.0.1:<port>`」升级为 **UI origin 与传输面分离** 的 desktop 级载体：
1. **UI origin** = 自定义协议 `worldsea://app/`——页面不再是 `http://127.0.0.1` 来源；
2. **传输面**（`/api` 与 `streamBaseUrl` 的 WS）保持 loopback——**这是刻意的**（WebView 自定义协议不支持 WebSocket，Electron 桌面版同样保留 loopback 19387，见 §二 事实 1）；
3. 壳件补齐（最小集：菜单 + 通知；单实例/托盘已有）；
4. 壳桥按需注入（`initialization_script`）。

**非目标**：
- 不复刻 Electron 的打包流水线（runtime/projectDir/包集 + release identity）——那是「1:1 指工程不指代码」的反面；
- 不做 `--profile desktop`（CLI 拒绝管理该 profile，且其宿主态依赖 Electron 的 fd 通道）；
- **真·无端口不是本批目标**——那是 C2（用 `__DSH_TRANSPORT__` 接缝把传输换掉）。

## 二、事实基线（2026-09-24 取证，来源均为 fork 内 dsh 代码）

| # | 事实 | 出处 |
|---|---|---|
| 1 | desktop 载体**同样开 loopback 端口**（19387）；`dsh-app://` 只伺服**静态资源**，`/api`+WS 仍走 loopback | `apps/desktop-host/src/index.ts:28`、`docs/architecture.md:55` |
| 2 | 客户端流通道基址读 `globalThis.__DSH_TRANSPORT__?.streamBaseUrl ?? document.baseURI`；desktop 注入 `streamBaseUrl = new URL(hostUrl).origin` | `packages/api/gateway/src/client/stream-client.ts:476-477`、`apps/desktop/src/main.ts:585` |
| 3 | desktop 的静态伺服：从打包 dist 读文件（MIME 表 + 越界 403 / 越权 405 / 缺失 404），并在 `<head>` 后插引导脚本 `globalThis.__DSH_BOOT_READY__ = Promise.withResolvers()` | `apps/desktop/src/web-document.ts:24-49` |
| 4 | 鉴权：把宿主打印的**带 token URL** `fetch(..., {redirect:'manual'})` → 取 **303 的 `set-cookie`**（`dsh-auth-*`）→ 作为 `Cookie` 头**转发**给宿主的 `/api` | `apps/desktop/src/web-document.ts:56-70`、`main.ts:389/570-573` |
| 5 | UI 的 index 注入（`__DSH_BOOT__` 插件图等）是**宿主渲染**的：`frontend-static` 取 index 时先过 Connection 鉴权，再走 `webServer.renderIndex`；`__DSH_BOOT__` 由 `client-modules` 作为 global 注入行推入 | `packages/host/frontend-static/src/index.ts`（模块头）、`packages/host/webserver/src/index.ts:360`、`packages/client/modules/src/index.ts:585` |
| 6 | 宿主 CLI 有 `--trusted-host <authority...>`（`/api` 浏览器信任围栏的额外白名单） | `apps/tauri/../dsh` web app `--help` |
| 7 | Tauri 2.11.5 有 `register_uri_scheme_protocol` / `register_asynchronous_uri_scheme_protocol`；仓内已有 `reqwest`(blocking,rustls) 与 `ureq`，**无需新增依赖** | `tauri-2.11.5/src/app.rs:2130/2198`、`apps/tauri/src-tauri/Cargo.toml` |
| 8 | **WS 的跨源凭据是「壳注入」的**（不是 WebView 自带）：desktop 用 `session.webRequest.onBeforeSendHeaders({urls:['ws://127.0.0.1/*']})`，回调里注入 `cookie`、把 `origin` 改写成 loopback origin、`sec-fetch-site: same-origin` | `apps/desktop/src/main.ts:606-616` |

**现役壳形态**（B2/B3/B5）：`dsh_shell.rs` spawn `node dsh/apps/cli/lib/bin.js web --patch <overlay> --no-open --port <空闲>` → 解析 `dsh web: <url>` → `WebviewWindow::navigate(loopback URL)`；`DSH_HOME` 默认隔离到应用数据目录；退出回收 + 可辨认失败页。

## 三、形态与做法

**载体形态 = 候选 A（已拍板）：协议层代理宿主**
- Tauri 注册 `worldsea://app/…`：协议处理器把请求**转发到宿主 loopback**（index 直接取宿主渲染结果 → **零注入复刻**；静态资源与 `/plugins/??…` 直通）；`/api` 由处理器**带 cookie 转发**（照事实 4）；
- 在 index 的 `<head>` 前插**壳引导脚本**：`globalThis.__DSH_TRANSPORT__ = { ...(globalThis.__DSH_TRANSPORT__ ?? {}), streamBaseUrl: 'http://127.0.0.1:<port>' }`（照事实 2：WS 直达 loopback；**只合并不覆盖**）；
- **WS 凭据（事实 8 的 Tauri 落地）**——两条路，C1-a 先试第 ①：
  ① **Rust WS 中转（首选，零 unsafe）**：壳内起一个极小的 loopback 中转（raw TCP relay），页面连它（`streamBaseUrl` 指向它）；中转在握手请求上**补 `Cookie` + 改写 `Origin`/`sec-fetch-site`** 后转发给宿主，随后双向透传字节。
  ② WebView2 `WebResourceRequested` 头注入（与 Electron 同构；需 unsafe COM，仓内有 `with_webview` 先例可循）。
- 不改 dsh（纯壳侧；台账保持空）。

**不采用**：候选 B（Rust 自建静态 + 向宿主取注入——把 dsh 构建期知识搬进 Rust，跟随成本高）；候选 C（维持现状，收益为 0）。

## 四、裁定记录（2026-09-24 拍板）

| # | 裁定点 | 结果 |
|---|---|---|
| ① | 载体形态 | **候选 A：协议层代理宿主** |
| ② | 自定义协议名 | **`worldsea://app`**（需要时用 `--trusted-host` 放行其 authority） |
| ③ | 壳件范围（本批） | **最小集**：菜单 + 通知（插件已在）；单实例/托盘已有；**更新与权限后置** |
| ④ | C2 衔接 | **把「传输基址」抽成单点**（= `streamBaseUrl` 注入处），C2 只换那一层 |

## 五、批次划分（每批含实现 / 验收 / 反证 / 台账 / 文档）

### C1-a · 可行性小实验（必做，决定后续落地方式）
- **任务**：在现役壳上加**最小**实现——① `worldsea://app` 协议处理器（先只代理 index 与一个静态资源 + `/api` 带 cookie 转发）；② `<head>` 注入 `streamBaseUrl`；③ WS 走「Rust 中转」或「头注入」中先试成的其一；起宿主打开窗口。
- **验收（四格矩阵，逐格给结论与证据）**：RPC 是否通 ｜ WS 是否连上 ｜ cookie 是否被接受 ｜ 宿主 Origin 围栏是否放行；落档（日志 + 页面 console）。
- **反证**：把 `streamBaseUrl` 注入**摘掉** → WS 必须失败（证明该注入是必要件）。

### C1-b · 协议伺服转正
- **任务**：路径白名单 / MIME / 越界 403 / 越权 405 / HEAD 语义 / 失败降级；index 插桩与宿主注入的**共存顺序**写成契约并测试。
- **验收**：界面完整、RPC+WS 正常、刷新/二次导航稳定；`dsh web: <url>` 的 token **不再出现在 WebView 可见 URL**。
- **反证**：协议处理器对某资源返回 404 → 页面必须给出可辨认错误（非白屏）。

### C1-c · 壳件与桥（最小集）
- **任务**：菜单（文件/编辑/视图 + 打开设置）；通知接上；`initialization_script` 注入按需项（`dshPlatform` 等；`__DSH_HOST_PATHS__` 与 `dshDesktop` 按 B2 结论不做并登记）。
- **验收**：菜单可用；注入项在文档开始前生效。
- **反证**：摘掉注入 → 依赖功能显式降级（不静默）。

### C1-e · 收口
- **任务**：台账登记（若触 dsh）、更新准备方案 §六/§九 + 运行手册 + 索引、走查清单（用户手测）。
- **验收**：门禁全绿（`pnpm fork:check` / `arch:check` / 断链）；走查通过。

## 六、风险

| # | 风险 | 缓解 |
|---|---|---|
| R1 | WS 凭据/Origin 围栏在 Tauri 侧不成立 | 事实 8 已给出 Electron 的可行机制 → 按 §三 ①→② 依次试；最坏退路 = 直接进 C2（message 传输） |
| R2 | 协议处理器成为页面**唯一**入口 → 它出错就是白屏 | C1-b 反证（404 可辨认）+ 保留「直连 loopback」回退开关（env） |
| R3 | 与宿主注入的插桩顺序冲突（`__DSH_BOOT__` / `__DSH_BOOT_READY__` / `__DSH_TRANSPORT__`） | 顺序写成契约并测试；`__DSH_TRANSPORT__` 只合并不覆盖 |
| R4 | 触发 fork 改动（若两条 WS 路都不通） | 按台账纪律单独立项，并跑 dsh 自带 typecheck/lint/test |
| R5 | 与 C2 目标冲突（C2 要去掉 loopback） | 裁定 ④：传输基址单点化，C2 只换该层 |

## 七、本批不做

- 打包/分发形态（Node 运行时随包或 pkg）——独立批；
- 更新通道（自动更新/签名）；
- 产品域落位（27 芽视图）与冻结面可留候选立项。
