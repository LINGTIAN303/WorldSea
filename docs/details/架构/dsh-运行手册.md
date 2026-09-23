# dsh 运行手册（仓内 `dsh/` 树）

> **status: 现行**（2026-09-23 建立，B1 迁入批次产物；2026-09-24 追版 rc.1 + fork 改判 + 补 §五 载体侧事实）｜ 口径：只讲「怎么在仓内 `dsh/` 上**装、构、起**」；**`dsh/` 已是我方 fork**（D10，2026-09-24 改判）——可以对它动刀，但每一处改动都必须逐文件登记进 [dsh fork 台账](dsh-fork台账.md)（门禁 `pnpm fork:check`），并尽量收敛在接缝文件。
> 来源与许可：上游 **deepseek-harness tag `dsh-v0.1.7-rc.1`**（提交 `46a7f68b0922371ce7144b668b90e377d8e799f4`），**MIT**；树内自带 `LICENSE` 与 `THIRD_PARTY_NOTICES.md`。迁入口径：排除 `node_modules` 与 `.git`，其余原样。
> 追版记录：初版迁入为 `dsh-v0.1.7-alpha.2`（`00102833`，2026-09-22）→ 2026-09-24 换树至 `dsh-v0.1.7-rc.1`（差异 933 文件 / +13,851 −3,101；会话格式无变动；就绪行格式与 web app 参数零变化，壳无需改动）。

---

## 一、前置（六条口径）

| 项 | 口径 |
|---|---|
| Node | `^22.19 \|\| >=24`（实测 v24.10.0） |
| pnpm | 在 `dsh/` 内自动切到其钉住的 **11.7.0**（根 `packageManager` 字段；本机全局 11.5.1 不必改） |
| registry | 官方源与 npmmirror 当前**均可达**；统一带 `--registry=https://registry.npmmirror.com`（CN 网络更稳）；**不改任何 `.npmrc`** |
| `DSH_HOME` | **建议隔离**——壳默认用应用数据目录（`<app_data>/dsh-home`），手工跑时显式指定（本文示例 `D:/WorldSea/.独立项/b0-home`）。**空/新 home 首启正常**：dsh 自动 `initProfile`（建 `.anonymous-user-id`、`.credentials.yaml`、`profiles/web`、`storages/`）。⚠️ 调用形式注意：用**管道**（`… 2>&1 \| tee 日志`）而非 `timeout`+`env`+`>文件`——后者实测会让启动静默无输出（2026-09-24 更正） |
| 索引忽略 | 仓根 `.qoderignore` 已排除 `dsh/`、`.独立项/`、`node_modules/`——**在工作区内安装前必须先有这个忽略**，否则补丁依赖（`patchedDependencies`）改名会报 `ERR_PNPM_EPERM` |
| git 指纹 | `pnpm run build` 取 `git rev-parse HEAD`；在仓内运行取到 **WorldSea 的提交**（语义偏但可用）；仓外裸拷贝需 `git init` + 空提交，或设环境变量 `CLIENT_COMMIT_HASH_VARIABLE` |

## 二、三条命令

```sh
cd dsh
pnpm install --registry=https://registry.npmmirror.com --prefer-offline   # 实测 1m32.9s；1679 解析 / 1386 包 / node_modules ≈2.1G
pnpm run build                                                            # 实测产出 263 客户端产物：69 个 lib/client.js、307 个 lib/index.js、apps/web/dist
DSH_HOME="D:/WorldSea/.独立项/b0-home" node apps/cli/lib/bin.js web --no-open --port 3088   # 打印 ?token= URL
```

- 启动只监听 **loopback**；`GET /?token=…` → **303 + `Set-Cookie: dsh-auth-*`**（HttpOnly / SameSite=Strict / 30 天）；之后 `/api` 与 `/api/remote.mux`(WS) 认 Cookie，无 Cookie → **401**；index（32.9 KB）含 `__DSH_BOOT__`。
- 壳侧 overlay：`--patch <仓根>/apps/tauri/dsh-overlay.yml`（**打开 web 下默认禁用的右栏内置浏览器**；launcher 标志须排在 `--no-open/--port` 之前）。
- **改了 `dsh/` 之后必跑**（在**仓根**执行）：`pnpm fork:check` —— 未登记的 dsh 改动会报红（见 [dsh fork 台账](dsh-fork台账.md)）。
- 模型调用读环境变量（如 `DEEPSEEK_API_KEY`）；本机环境已设。

## 三、已实测事实（2026-09-23）

- 仓内 `pnpm install` 一次过（`Done in 1m 32.9s using pnpm v11.7.0`）；仓内 `pnpm run build` 一次过（`build: recorded 263 client artifact(s)`）。
- 仓内起服务通过（端口 3088 / 3089 两次验证，探针结果同上）。
- `node scripts/architecture/check.mjs` → **无违规**（`dsh/` 不在 policy 的 `discoveryRoots`，天然不可见；218 存量冻结文件不变）。
- 入库边界：`dsh/.gitignore` 自带 `node_modules/`、`lib/`、`*.tsbuildinfo`、`apps/web/dist/` 等 → 构建产物不入库，无需改仓根 `.gitignore`。
- 用户侧另一份快照（`.独立项/deepseek-harness`）为未发布 WIP 工作树（+197 项、487 类型错误），**不作为基线**（裁定 D9）。

## 四、上游更新（步骤留档）

`dsh/` 内无 `.git`，**不走 `git pull`**。更新口径：取新 tag 的干净树 → 按同样排除口径覆盖 `dsh/` → 先 `diff -rq`（排除 `node_modules`/`lib`）逐条核对差异并解释 → 再提交。版本与提交号同步登记到本手册与 [准备方案](../../plans/2026-09-23-dsh接管Agent面-大重构准备.md)。
> 注（D10 改判后）：本仓**不追随上游**（追随上游的是 DSHWS）；本节仅用于「上游有值得 cherry-pick 的修复」时的手工流程，且按台账纪律登记。

## 五、载体侧事实（C1-a 实测，2026-09-24）

壳（`apps/tauri/`）把 UI 面搬到自定义协议上，**dsh 树零改动**（台账保持空）。要点：

| 项 | 事实 |
|---|---|
| 协议落形 | 壳注册 `worldsea` 协议；**Windows 由 wry workaround 落为 `http://worldsea.localhost/`**（Tauri 官方口径 = `http://<scheme>.localhost/`）→ authority 必须写 `localhost`；写 `app` 会落到真实 TLD `worldsea.app`（HSTS 预载 + 非安全上下文） |
| 换 cookie | 壳在导航前对 `dsh web` 打印的带 token URL 做一次 **303 交换**，取 `set-cookie` 首段留在内存（**token 不出现在 WebView URL**）。cookie 名与签名载荷**绑定 Host authority**（`127.0.0.1:<port>`）——转发与中转必须用同一 authority 作 `Host`，否则 401 |
| `/api` 转发 | 协议处理器删掉页面的 `origin`/`cookie`/`sec-fetch-*` 再补壳侧 cookie → 同时过围栏（Host = loopback、无 Origin）与鉴权 |
| WS | 页面的 mux WS 走壳内 **Rust 中转**（`dsh_relay.rs`）：改写 `Host`/`Origin`/`Cookie`/`Sec-Fetch-Site` 四项后双向透传字节；只认 `/<随机前缀>/api/remote.mux`（前缀由注入的 `streamBaseUrl` 带出）。Chromium 在 WS 握手**不发** `Sec-Fetch-*` |
| 缓存 | index 与 `/plugins/*` 一律 **`no-store`**（每进程内容：宿主 `__DSH_BOOT__` + 壳注入的传输基址；否则二次启动拿到上一轮注入 → 传输指向已死端口） |
| 注入 | index 的 `<head>` 后补一条 `__DSH_TRANSPORT__`（**只合并不覆盖**；早于宿主 head 行与全部模块脚本） |

**排障开关**（壳侧环境变量，详见 `dsh_bridge.rs` / `dsh_proxy.rs` / `dsh_shell.rs` 注释）：

| 变量 | 作用 |
|---|---|
| `WORLDSEA_SHELL_DIAG=1` | 页内诊断开：注入 console 钩子（error/warn/未捕获异常/资源失败 → 壳日志 `page(diag)`）+ 中转落档握手/响应原文 + 开 `/__diag` 通道 |
| `WORLDSEA_NO_TRANSPORT_INJECT=1` | 反证用：不注入 `streamBaseUrl`（WS 必须失败；HTTP RPC 仍通） |
| `WORLDSEA_NO_SHELL_BRIDGE=1` | 反证用：不注入壳桥 `__WORLDSEA_SHELL__`（「设置→打开设置」必须显式降级为右下角红条） |
| `WORLDSEA_LEGACY_DIRECT=1` | 回退直连 loopback（B2/B3 行为，跳过协议桥） |
| `WORLDSEA_DENY_PATH=<前缀>` | 测试钩子：该前缀一律 404（验「资源失败 → 非白屏」降级链） |
| `WORLDSEA_BRIDGE_OPEN=1` | 逃生口：关闭路径白名单（白名单误伤时先放行排查） |
| `WORLDSEA_RELOAD_AFTER=<秒>` | 核查用：页面就绪后再等 <秒> 做一次 `window.reload`（刷新/二次导航稳定性） |
| `WORLDSEA_DSH_ROOT` / `WORLDSEA_DSH_HOME` / `WORLDSEA_NODE` | 指定 dsh 树 / home / node（默认自动探测与应用数据目录隔离 home） |

> Git Bash 传这些值时注意 MSYS **路径转换**：`WORLDSEA_DENY_PATH=/assets/index-` 会被改写成 `E:/GIT/Git/assets/index-`——需前缀 `MSYS_NO_PATHCONV=1 MSYS2_ARG_CONV_EXCL='*'`。

**协议面的闸门与白名单（C1-b）**：壳在转发前先判「方法白名单（GET/HEAD/POST）/ 越界段（`.` `..` → 403）/ 路径白名单」，宿主随后仍按自己的语义再判一次。白名单**枚举自 dsh 源码**（`webServer.register`、`connection.fetch.register` 的调用点 + dist 根文件），新增宿主路由时要同步：改 `dsh_proxy.rs` 的 `ALLOWED_PREFIXES` + 补 `allowlist_covers_enumerated_host_routes` 用例。漏掉的路径会在壳日志留 `404（路径白名单外）`。

**HMR 已关闭**：`client-hmr` 的 `/plugins/events` 是 SSE 长连，而壳协议（Tauri `UriSchemeResponder`）只能回缓冲体 → 该行在壳内必然失效。已在 `apps/tauri/dsh-overlay.yml` 禁用；代理对任何 `text/event-stream` 响应显式 502 + 落档。若将来要 HMR，需要一条可流式的传输（C2 的 portless 通道是候选）。

**壳件与壳桥（C1-c）**：

- **原生菜单**（`menu.rs`）：文件（关闭窗口/退出）· 编辑（撤销/重做/剪切/复制/粘贴/全选，muda 预定义项）· 视图（重新加载 `Ctrl+R` · 放大 `Ctrl+=` · 缩小 `Ctrl+-` · 实际大小 `Ctrl+0` · 全屏 `F11`）· 设置（打开设置 `Ctrl+,`）。
- **壳桥**（`dsh_shell_bridge.js` 注入 + `shell_bridge.rs` 命令）：页面可用 `globalThis.__WORLDSEA_SHELL__`：
  `notify(title, body)`（原生通知）· `openExternal(url)`（系统浏览器打开；仅 http(s)/mailto）· `report(msg)`（落壳日志 `[DSH-SHELL] bridge(page)`）· `openSettings()`（点开侧栏设置入口）。
  原理：我们的页面在 Tauri `is_local_url` 白名单内，`__TAURI_INTERNALS__.invoke` 直达应用命令（应用命令不属插件 ACL，无需 capability 项）。
- **通知**：壳桥 `notify` 是页面通道（dsh 客户端暂无生产者）；**宿主异常退出**时壳自带一条系统通知（窗口可能在托盘里）。
- 注入脚本三件套的关停开关：`WORLDSEA_NO_TRANSPORT_INJECT` / `WORLDSEA_NO_SHELL_BRIDGE`（+ 诊断钩子 `WORLDSEA_SHELL_DIAG`）。

**核查与清理**（改壳或复跑前）：

- `taskkill //IM worldsea-tauri-app.exe //T //F` 清干净再起；被强杀的实例会留**孤儿 dsh host**（node 不在 Job Object 里），用 `tasklist | grep -i node` 复核。**本机 `wmic` 已失效（恒返回空）**——进程核查改用 `tasklist` / `powershell Get-CimInstance`。
- 应用日志建议直写（`… > 日志 2>&1`）；本机 `tee` 有块缓冲，短窗口内读会拿到**过期内容**（曾据此误判「页面未加载」）。
- Windows 坑（已修，代码注释留档）：`accept()` 出来的套接字**继承 listener 的非阻塞态**（Unix 不继承），中转若忘了 `set_nonblocking(false)`，握手 101 后会 0 字节即断（`WSAEWOULDBLOCK 10035`）。
