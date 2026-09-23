# C1 批计划：Tauri 原生「desktop 类」载体

> **status: 执行中**（2026-09-24 四裁定已拍板；**C1-a 已完成**：四格矩阵全绿 + 双反证成立，见 §五）｜ 上游策略前提：**本项目 fork dsh、不追随上游**（D10）；C1 的产物是「壳自有的 desktop 级载体」，技术模板 = dsh 自己的 Electron desktop 载体（只借机制、不复刻其打包流水线）。
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
| 9 | **Windows 上自定义协议的落形由 wry workaround 决定**：`<scheme>://<authority>/…` ⇄ `http://<scheme>.<authority>/…`（`custom_protocol_workaround`）；Tauri 官方口径同此（**Windows/Android = `http://<scheme>.localhost/`**）。故 **authority 必须写 `localhost`** → 页面 origin = `http://worldsea.localhost/`（RFC 6761 保留域、Chromium 视为 potentially trustworthy）；若用 `worldsea://app` 则落到真实 TLD `worldsea.app`（HSTS 预载 + 非安全上下文，属坏形）。**裁定 ② 的 authority 由此修正为 `localhost`**（协议名仍 `worldsea`） | `wry-0.55.1/src/custom_protocol_workaround.rs`、`tauri-2.11.5/src/webview/mod.rs::is_local_url` |
| 10 | **/api 与 WS 两侧共用同一道围栏**（`isTrustedApiRequest`，WS 走 `connection.admit`）：① `Host` 必须 loopback（或 `trustedHosts` 授权）② `Sec-Fetch-Site: cross-site` 直接拒 ③ 有 `Origin` 时其 `host` 必须与 `Host` 同 authority。而页面的 `Origin` 是 `http://worldsea.localhost`、`Host` 会是中转 authority → **必须三处一起改写**（只补 Cookie 不够）。Chromium 在 WS 握手**不发** `Sec-Fetch-*`（实测原文），但 /api 会发 | `packages/client/connection/src/api-request-trust.ts:91-118`、`rpc-host.ts:104-113` |
| 11 | **cookie 是 authority 绑定的**：名 = `dsh-auth-<b64url(sha256(Host authority))>`，签名载荷里也带 `authority`，校验时用请求的 `Host` 反推 —— 转发/中转的 `Host` 必须与 303 交换时一致（`127.0.0.1:<port>`）。推论：**原计划的 `--trusted-host` 不需要**（Origin 由壳改写，围栏的 trustedHosts 分支用不到） | `packages/client/connection/src/browser-auth.ts:106-108/238-260/287-300` |
| 12 | **index 与 `/plugins/*` 必须 `no-store`**：index 含**每进程**内容（宿主注入的 `__DSH_BOOT__` 插件图 + 壳注入的传输基址），`/plugins/*` 的 immutable 修订号每次启动都变。实测坑：WebView disk cache 让**第二次启动**拿到上一轮的注入 → 传输指向已死的中转端口 → 页面停在「Loading plugins…」。Electron 同构（`PLUGIN_BUNDLE_PATH → no-store`） | `apps/desktop/src/web-document.ts:58-65/91` |

**现役壳形态**（B2/B3/B5）：`dsh_shell.rs` spawn `node dsh/apps/cli/lib/bin.js web --patch <overlay> --no-open --port <空闲>` → 解析 `dsh web: <url>` → `WebviewWindow::navigate(loopback URL)`；`DSH_HOME` 默认隔离到应用数据目录；退出回收 + 可辨认失败页。

## 三、形态与做法

**载体形态 = 候选 A（已拍板）：协议层代理宿主**（**已按此落地，见 §五 C1-a**）
- Tauri 注册 `worldsea` 协议（Windows 落形 = `http://worldsea.localhost/`，见事实 9）：协议处理器把请求**转发到宿主 loopback**（index 直接取宿主渲染结果 → **零注入复刻**：`__DSH_BOOT__` 等仍由宿主注入；静态资源与 `/plugins/*` 直通）；`/api` 由处理器**带 cookie 转发**（照事实 4/10/11）；
- index 与 `/plugins/*` 一律 `no-store`（事实 12：每进程内容，缓存会让下次启动拿到过期注入）；
- 在 index 的 `<head>` 后插**壳引导脚本**：`globalThis.__DSH_TRANSPORT__ = { ownsHost: true, streamBaseUrl: 'http://127.0.0.1:<中转端口>/<随机前缀>/' }`（照事实 2；**只合并不覆盖**；末端 `/` 让客户端的相对 mux 路径落在随机前缀下）；
- **WS 凭据（事实 8 的 Tauri 落地）——走第 ① 条，已验成**：
  ① **Rust WS 中转（零 unsafe，已采用）**：壳内起 loopback 中转（raw TCP relay），页面连它；中转在握手首部上**改写 `Host`/`Origin`/`Cookie`/`Sec-Fetch-Site` 四项**（事实 10/11）后转发给宿主，随后双向透传字节（不解析 WS 帧）；只认 `/<随机前缀>/api/remote.mux`，故它不是通用代理。
  ② WebView2 `WebResourceRequested` 头注入（与 Electron 同构）——**不需要了**，留作备选。
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

### C1-a · 可行性小实验（必做，决定后续落地方式）——**已完成（2026-09-24）**
- **任务**：在现役壳上加**最小**实现——① `worldsea` 协议处理器（代理 index + 静态资源 + `/api` 带 cookie 转发）；② `<head>` 注入 `streamBaseUrl`（只合并不覆盖）；③ WS 走「Rust 中转」（**已按本路线做成**，未动用 WebView2 头注入）；起宿主打开窗口。
- **落点**（全在壳侧，`dsh/` 零改动、台账保持空）：`apps/tauri/src-tauri/src/dsh_bridge.rs`（协议处理器 + 303 换 cookie + 注入 + 页内诊断通道）、`dsh_relay.rs`（WS 中转：握手首部改写 + 双向透传）、`lib.rs`（注册协议 + 装配桥 + 回退口）。
- **结果（四格矩阵全绿）**：
  | 格 | 结论 | 证据 |
  |---|---|---|
  | 协议页加载 | 通 | `bridge: GET / → 200（注入传输基址；34901B）`；截图 = dsh UI 完整渲染（侧栏/欢迎页/模型选择器） |
  | RPC | 通 | 23×`POST /api/… → 200`（含 `session/modelCatalog`、`agentPresets/list`、`session/create`…）；UI 拉到真实数据 |
  | cookie 接受 | 通 | 200/101（无 401）；cookie 由壳做 303 交换取得、**token 不出现在 WebView URL** |
  | 围栏放行 | 通 | WS `101`；**负控**：直连宿主时 `Origin: http://worldsea.localhost` + `cross-site` → **403**，`Origin: http://127.0.0.1:<port>` + `same-origin` → **101** |
  | WS 稳定性 | 通 | 2 次升级、**0 次关闭**、双腿（页↔中转↔宿主）ESTABLISHED；100 秒窗口零变化；UI「重新连接中…」消失 |
- **反证（两道，均成立）**：
  1. **摘掉 `streamBaseUrl` 注入**（`WORLDSEA_NO_TRANSPORT_INJECT=1`）→ 中转升级数 **0**、UI 退回「重新连接中…」+ 编辑区禁用；同轮 HTTP `/api` 仍 200（证明该注入是 WS 的必要件、且与 HTTP 面解耦）。
  2. **中转 bug 的本地整链单测**（`relay_keeps_tunnel_alive_and_pipes_bytes`）：修复前 `上行 0B / 下行 3B` + `WSAEWOULDBLOCK(10035)` 报红；修复后 `上行 2B / 下行 5B` 通过。
- **顺带落地**：`__DSH_TRANSPORT__` 与宿主注入的**顺序契约**（壳脚本落 `<head>` 之后、早于宿主 head 行与全部模块脚本；只合并不覆盖）；`/__diag` 页内诊断通道（`WORLDSEA_SHELL_DIAG=1` 时注入 console 钩子）。
- **遗留（转 C1-b）**：路径白名单（现在全量转发）、HEAD/206 语义细化、失败降级页、中转只认 `/<secret>/api/remote.mux`（已有）之外的收口；`WORLDSEA_LEGACY_DIRECT=1` 直连回退口保留（R2 缓解）。

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
| R1 | ~~WS 凭据/Origin 围栏在 Tauri 侧不成立~~ | **已消解（C1-a 验成）**：Rust 中转改写四项头部即通（101），且负控 403 证明围栏真实存在；WebView2 头注入路线不再需要 |
| R2 | 协议处理器成为页面**唯一**入口 → 它出错就是白屏 | C1-b 反证（404 可辨认）+ 已有「直连 loopback」回退开关 `WORLDSEA_LEGACY_DIRECT=1`（桥准备失败时也会自动回退，不静默） |
| R3 | 与宿主注入的插桩顺序冲突（`__DSH_BOOT__` / `__DSH_BOOT_READY__` / `__DSH_TRANSPORT__`） | **顺序契约已落地并测试**：壳脚本落 `<head>` 之后、早于宿主 head 行与全部模块脚本；只合并不覆盖。C1-b 把契约写成文档 + 测试 |
| R4 | 触发 fork 改动（若两条 WS 路都不通） | 未触发（纯壳侧）；如后续需改 dsh，按台账纪律单独立项 |
| R5 | 与 C2 目标冲突（C2 要去掉 loopback） | 裁定 ④：传输基址单点化（= `streamBaseUrl` 注入处），C2 只换该层 |
| R6 | **环境坑（C1-a 实测，已固化在代码注释里）**：① Windows `accept()` 会**继承 listener 的非阻塞态**，中转到隧道的 `io::copy` 立刻 `WSAEWOULDBLOCK(10035)` → 表现为「握手 101 后 0 字节即断」；② 旧壳实例若被强杀留**孤儿 dsh host**（node 不在 Job Object 里），会与新实例并存；③ 本机 `wmic` 已失效（返回空），进程核查要用 `tasklist`/`Get-CimInstance` | ① 接受后显式 `set_nonblocking(false)`（含整链单测）；② 起壳前 `taskkill //IM worldsea-tauri-app.exe //T //F` 并核对；③ 核查命令写进运行手册 |

## 七、本批不做

- 打包/分发形态（Node 运行时随包或 pkg）——独立批；
- 更新通道（自动更新/签名）；
- 产品域落位（27 芽视图）与冻结面可留候选立项。
