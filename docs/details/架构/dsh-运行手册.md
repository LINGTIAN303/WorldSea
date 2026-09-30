# dsh 运行手册（仓内 `dsh/` 树）

> **status: 现行**（2026-09-23 建立，B1 迁入批次产物；2026-09-24 追版 rc.1 + fork 改判 + 补 §五 载体侧事实）｜ 口径：只讲「怎么在仓内 `dsh/` 上**装、构、起**」；**`dsh/` 已是我方 fork**（D10，2026-09-24 改判）——可以对它动刀，但每一处改动都必须逐文件登记进 [dsh fork 台账](dsh-fork台账.md)（门禁 `pnpm fork:check`），并尽量收敛在接缝文件。
> 来源与许可：上游 **deepseek-harness tag `dsh-v0.1.7-rc.2`**（提交 `477b4f420553e8a52c2fbccc464d7561b239c443`），**MIT**；树内自带 `LICENSE` 与 `THIRD_PARTY_NOTICES.md`。迁入口径：排除 `node_modules` 与 `.git`，其余原样。
> 追版记录：初版迁入为 `dsh-v0.1.7-alpha.2`（`00102833`，2026-09-22）→ 2026-09-24 换树至 `dsh-v0.1.7-rc.1`（差异 933 文件 / +13,851 −3,101；会话格式无变动；就绪行格式与 web app 参数零变化，壳无需改动）→ **2026-09-24/25 换树至 `dsh-v0.1.7-rc.2`**（差异 3429 文件 / +136,313 −24,518；我方 11 处 fork 改动用 `git apply --3way` **全部干净重放**；接缝源码零改动、`preload-windows`/`credentials-local`/`attachment-local` 零改动；换树法 = `git rm` 入库文件 + 复制 tag 干净树 + 清 `lib/` 旧产物 + `pnpm install` + `pnpm run build`）。详见 [F1 批计划](../../plans/2026-09-24-F1-追版rc2批计划.md)。→ **2026-09-29 换树至 `dsh-v0.2.0-rc.1`**（上游 `4878cdab`；差异 1109 文件 / +20,374 −77,795，树 13,850 → 14,004；我方 11 处改动仍只 3 处与上游重叠、`--3way` 全干净；**命脉接缝零改动**：`client/web/src/boot.ts` · `client/connection/src` · `api/gateway/src` · `host/webserver/src` · `bundle/web-app/src` · `apps/cli/src` · `preload-windows.ts` → 就绪行/旗标族/管道契约不变）。本轮新增两条硬纪律：**锁文件一律「还原上游原版 + 手插我方 3 行 link 条目 + `--frozen-lockfile`」**（否则 pnpm 全量重解析造成版本漂移、tsc 双版本冲突）；**漂移一旦发生必须移走 `node_modules` 全新安装**（pnpm 的 up-to-date 短路不重链）。详见 [F2 批计划](../../plans/2026-09-29-F2-追版0.2.0-rc.1批计划.md)。→ **2026-09-29 同日换树至 `dsh-v0.2.0-rc.2`**（上游 `639ed015397290b3745d163aafe02ffee4aa3f84`；delta **1012 路径** = 918 改 + 89 增 + 5 删；我方 11 处改动只与上游重叠 **2 处**——`bundle/web-app/package.json` 的上游改动仅版本号、`pnpm-lock.yaml` 按硬纪律重放；`--3way` 10 处全干净；**命脉接缝只两处被上游动过且均为加性**：`apps/cli/src`（新增 desktop 命令管理，不碰 `--patch`/`--ipc-pipe`）与 `api/gateway`（新增 `hasLiveClient()`），**就绪行所在 `bundle/web-app/src/index.ts` 与 overlay 目标行所在 `cordis.patch.yml` 均未动**；**本轮新增取树法**：GitHub 的 git 链路不通时改从 codeload 取 tag tarball〔`curl`〕，两棵树同法物化后 `diff -rq`）。详见 [F3 批计划](../../plans/2026-09-29-F3-追版0.2.0-rc.2批计划.md)。

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

`dsh/` 内无 `.git`，**不走 `git pull`**。现行换树法（F1 建立、F2 复核）：

1. **取证**：`.workbuddy/_dsh-upstream`（上游公开仓的浅克隆 + `blob:none`）`git fetch --depth=1 origin tag <新tag>` → 核对发布说明与我方 [fork 台账](dsh-fork台账.md) 的冲突面（`git diff <旧tag> <新tag> --name-status` 逐条比我方 11 处改动与命脉接缝）。
2. **导出补丁**：`git diff <基线提交> -- dsh` 落 `.workbuddy/`（另出一份排除 `pnpm-lock.yaml` 的供重放）。
3. **换树**：`git checkout <新tag>` 物化干净树 → `git rm -r --quiet dsh`（只删入库文件，`node_modules` 留盘）→ 清 `lib/` 产物目录 + `*.tsbuildinfo` + `.dsh-build/` + `apps/web/dist/`（均被 `dsh/.gitignore` 忽略）→ `robocopy <干净树> dsh /E /XD .git` → 单独提交。
4. **重放**：`git apply --3way <补丁（不含锁）>` → 逐条核对 → 单独提交 → 台账基线改为换树提交 → `pnpm fork:check` 必须 11 = 11。
5. **锁文件（硬纪律，F2 实测）**：`git checkout <换树提交> -- dsh/pnpm-lock.yaml` 还原上游原版 → **手插我方 3 行**（web-app importer 内 `'@deepseek-ai/dsh-api-gateway': specifier: workspace:* / version: link:../../api/gateway`）→ `pnpm install --frozen-lockfile`。**绝不让 pnpm 全量重解析**：我方那条依赖边会使上游原版锁「与 package.json 不同步」，触发默认 `resolution-mode=highest` 把 caret 范围升到最新（F2 实测 micromark 家族双版本 → `tsc` TS2769）。**若已重解析过**：pnpm 的 `Already up to date` 短路（含 `--force`、含删 `.modules.yaml`/`.pnpm/lock.yaml`）不会重链，**必须把 `dsh/node_modules` 移走后全新安装**。
6. **重建与门禁**：`pnpm run build` → dsh 自带 `typecheck`/`lint`/`test --maxWorkers=4`（邻域子集优先；**★ 超长件（2026-10-01 复核）：`packages/boot/app-boot/tests/linked-resolution-matrix.spec.ts` 展开 4800 例 / ~14,400 个临时 fixture，Windows 实机 fs 密集约 55 分钟（单文件占五包邻域整跑的大头）——常规邻域门禁加 `--exclude "**/linked-resolution-matrix.spec.ts"`，需要该件时单独安排时长；F2 记的「收尾挂死」实为门禁窗口误杀（同一命令完整跑完 = 51 文件 / 6154 例全过、exit 0；fixture 目录 `dsh-linked-matrix-*` 序号仍在攀升 = 它仍在跑）**）→ 我方四道（cargo `--offline` / 仓库根 vitest / `apps/tauri` vue-tsc / `arch:check`）→ 真机接面回归（C1 注入 · C2 管道与就绪行 · C4 工作区 · C5 凭据 · **C6 窗口栏与浮层避让** · D1 工作台窗 · D2/D3 产品域面）→ 5 次 reload 看协议违规/真 502。
7. **收口**：台账基线与上游对照列、本节追版记录、索引、批计划、记忆同步。

> 注（D10 改判后）：本仓**不追随上游**（追随上游的是 DSHWS）；追版只在「冲突面小、整版追比零摘干净」时做（F1/F2 先例），其余上游修复按台账「上游对照」列单独立批摘取。
> 注（F2 实测）：profile 目录（`%APPDATA%/com.worldsea.app/dsh-home/profiles/web/`）**不受换树影响**——`initProfile` 对已存在的文件一律不碰；其 `node_modules` 只有指向我方 `apps/` 插件的 link，无指向 dsh 树的链接。

## 五、载体侧事实（C1-a 实测 + C2-b 零端口，2026-09-24）

壳（`apps/tauri/`）把 UI 面搬到自定义协议上、把传输面搬到**壳自有的 IPC 管道**上；`dsh/` 树的改动只在 C2-a 落了 11 个文件（见 [fork 台账](dsh-fork台账.md)），C2-b 纯壳侧（台账不变）。要点：

| 项 | 事实 |
|---|---|
| 协议落形 | 壳注册 `worldsea` 协议；**Windows 由 wry workaround 落为 `http://worldsea.localhost/`**（Tauri 官方口径 = `http://<scheme>.localhost/`）→ authority 必须写 `localhost`；写 `app` 会落到真实 TLD `worldsea.app`（HSTS 预载 + 非安全上下文） |
| 换 cookie | 壳在导航前对 `dsh web` 打印的带 token URL 做一次 **303 交换**，取 `set-cookie` 首段留在内存（**token 不出现在 WebView URL**）。cookie 名与签名载荷**绑定 Host authority**——管道模式下壳统一合成 `Host: 127.0.0.1`（无端口），交换与全部后续请求同形 |
| `/api` 转发 | 协议处理器删掉页面的 `origin`/`cookie`/`sec-fetch-*` 再补壳侧 cookie → 同时过围栏（Host = loopback、无 Origin）与鉴权 |
| **传输面（C2 默认）** | **IPC 管道**：壳生成管道路径（Windows `\\.\pipe\worldsea-dsh-…` / POSIX 短名套接字）→ `--ipc-pipe` 传给宿主；宿主 `pipe-transport` 载体在管道上收帧并把请求喂给**真路由表**（外置载体模式），流 lane 直连 `typertGateway.wireStream.open`（无 WebSocket）。**宿主进程零 TCP 监听**（验收断言：netstat 按 PID 过滤 LISTENING 为空） |
| 帧协议 | `u32be 长度 + u8 kind + payload`；`J` = JSON 控制帧（`req/res/res-head/res-chunk/res-end/res-err/stream-*/abort`），`B` = 二进制体帧（`u32be id + bytes`，严格跟随其声明帧）。协议违规一律 fail-closed 断链 |
| 页面的流 | 注入 `openStream` 钩子（`__WORLDSEA_STREAM__`）：页面逻辑流 ⇄ Tauri IPC（`cmd_stream_open/send/end/cancel`，下行走 `__CHANNEL__:<id>` 通道）⇄ 管道 mux。失败标记 `dshRemoteStreamFailure`（`{kind:'remote',code,details}` / `{kind:'carrier'}`）与 dsh 客户端约定逐字一致 |
| 缓存 | index 与 `/plugins/*` 一律 **`no-store`**（每进程内容：宿主 `__DSH_BOOT__` + 壳注入的传输钩子；否则二次启动拿到上一轮注入 → 传输指向上一个进程的管道） |
| 注入 | index 的 `<head>` 后补壳脚本（**只合并不覆盖**；早于宿主 head 行与全部模块脚本）：C2 = 流桥脚本 → `__DSH_TRANSPORT__={ownsHost,openStream}`；legacy = `streamBaseUrl` |
| **legacy 对照口** | `WORLDSEA_TCP_HOST=1`：宿主按端口监听 + 壳走 C1 链（reqwest 转发 + `dsh_relay.rs` WS 中转 + `streamBaseUrl` 注入）。**冻结**，只作对照/回退 |

### Windows 命名管道两条硬约束（C2-b 实测，务必先读）

1. **同步句柄上的并发读写会被文件对象串行化**——后台读线程阻塞在 `ReadFile` 时，另一线程的写**永不落地**（症状＝「hello 收到、请求永不到达、无任何报错」；`try_clone` 复制的是同一文件对象，救不了）。壳的解法：管道侧走**单线程轮询 IO**（`PeekNamedPipe` 判可读才读，写队列先冲；空闲 1ms 休眠）。
2. **带 `FILE_FLAG_OVERLAPPED` 打开的句柄不能交给 std 的 `File`**：std 走同步 NT 调用，遇 `STATUS_PENDING` 直接 `rtabort!`（进程被 abort，std issue #81357）。不要试图用 `custom_flags` 打开重叠模式。

> 排查「Rust 侧写不达宿主」的手动探针：`.workbuddy/c2b-manual-host.mjs`（起带正确管道路径的宿主并写探针文件）、`.workbuddy/c2b-pipe-probe.mjs`（Node 原生管道客户端）、`cargo test -- --ignored --nocapture probe_live_pipe_exchange`（Rust 客户端对活管道）。三者都在 `.workbuddy/`（gitignored）。

### Channel 投递全序（F4，2026-09-30，务必先读）

**机制（真机取证）**：Tauri `Channel` 对 JSON 载荷有**两条投递路径**——<8192B 走同步 `webview.eval`（有序），≥8192B 走异步 `plugin:__TAURI_CHANNEL__|fetch`（`invoke(...).then(runCallback)`）。两者混用时**不保序**：长会话 follow 的开局快照实测 ~420–630KB，会被紧随其后的 ~240B 流式小帧**超车**。而 dsh 客户端流协议要求**全序**（assistant 帧 revision 连续、持久事件 seq 连续）：乱序 → 客户端判定 carrier 故障 → 拆流重启；重启若发生在**回合进行中**，新快照与实时帧再次竞态 → 重试耗尽 → 会话事件流终止（页面报 `历史加载失败：session assistant stream skipped revision 1`）→ **前端流式渲染冻结**（后台照常跑；切会话/刷新重取才「接上」——即用户报告的「流式卡住」）。

**修法**：壳装官方扩展点 `Builder::channel_interceptor`（`apps/tauri/src-tauri/src/channel_order.rs`）——**全部 JSON 消息统一走同步 eval 直投**（`window.__TAURI_INTERNALS__.runCallback(id, {message, index})`，与 Tauri 小载荷分支同形），弃用异步 fetch 路径 → 全序由构造保证。Raw 交回默认。代价（实测）：大消息不再走异步 fetch —— 同窗口实测 fetch 比 eval 迟约 27ms，正常小帧路径零改动。

**确定性复现 / 反证配方**：长文**流式进行中刷新页面**（`location.reload()`）——修前必现上述报错文案 + 冻结（帧先到、快照迟到）；修后正常接续（快照先于帧、revision 连续）。反证开关 `WORLDSEA_NO_CHANNEL_ORDER_FIX=1` 恢复默认双路径 → 配方应再红。

**页重载泄漏流（同批修）**：页重载时旧页已开的流此前无人取消——壳持续向失效 callback id 投递（`[TAURI] Couldn't find callback id` 刷屏），且每次刷新叠加一套 workspace/follow、$events、session/control。修法＝注入桥登记本页未完成流，**`pagehide` 批量 `cmd_stream_cancel`**（终态流自动出集，不重复取消；窗口隐藏/最小化不触发 pagehide，不误伤流式）。

> F4 取证/验收工具（`.workbuddy/`，gitignored）：`_stream-probe.mjs`（CDP 探针：rafΔ/cbΔ/mutΔ/text + **线级帧序 rev/size/entry/GAP 标记** + abort 调用栈与 reason + console 捕获）、`_cdp-send.mjs`（CDP 驱动向输入框发消息）、`_shell-timestamps.log`（壳日志时间戳旁路）。

**壳侧安全面（C3-b/c，2026-09-24，详见 [C3 批计划](../../plans/2026-09-24-C3-壳侧安全面批计划.md)）**：

- **命令面白名单（应用级 ACL）**：`apps/tauri/src-tauri/permissions/worldsea-shell.toml` 只放页面在用的 **10 条**（壳桥 5 + 窗口栏 1 + 流桥 4；C3 起步为 7 条，C4-b/C6 逐条增补）；其余应用命令（旧 Agent 面全族）从「页面可调」降为 **ACL 拒**（`cmd_agent_tool_names not allowed. Command not found`）。**页面新增可调命令必须在此逐条加**（改 `permissions/*.toml` → 重建即生效）。
- **导航/新窗双栅栏**：壳级 WebView2 事件（主框架 `NavigationStarting` + `NewWindowRequested`，`nav_fence.rs`）——只放行自家源（`worldsea.localhost` / `tauri.localhost` 兜底页 / loopback 回退页）、`data:`、`about:`；iframe 走 `FrameNavigationStarting` **不挂**（内置浏览器/预览不受影响）。反证开关 `WORLDSEA_NO_NAV_FENCE=1`。**注意**：`tauri://localhost` 是 `frontendDist`（shell-loading 兜底页）——策略里必须放行（实测拦它会得到空窗口）。

- **凭证与模型配置（C5，2026-09-24）**：Key 的**唯一真源 = `$DSH_HOME/.credentials.yaml`**（页面「设置 → 模型」写入；首启无凭证时页面自带引导会自动弹出）。dsh 的凭据分层是「继承环境（**最高优先**）> 该库 > 项目 `.env` > home `.env`」（`dsh-credentials-local` 头注），所以只要环境里有 Key 就会永久盖住界面配置——壳 spawn 前判一次库：**库里已有该凭据 → 剥离继承的环境变量（界面配置生效）；库里没有 → 保留继承作兜底**。日志逐条留痕（`库（.credentials.yaml）已有 …` / `库中无 …：保留继承的环境变量作兜底`）。旧 Key（本仓 SecureStore / 启动环境）**不迁移**——按裁定在界面里填一次。排查：库文件在 `DSH_HOME/.credentials.yaml`（该文档只存「凭据名 → 字符串」映射）。

- **工作区与「可供给性」（C4，2026-09-24）**：壳 spawn 宿主时把 `cwd` 指到**工作区**（默认 `%USERPROFILE%\WorldSea`；`WORLDSEA_WORKSPACE` 覆盖）——它同时是新会话的默认工作区。**为什么重要**：dsh 默认 `workspace-write` 的 Windows ACL 沙箱在命令启动前要对工作区做一次「DACL + Low 标签」的 `SetNamedSecurityInfoW` 供给，而该操作**要求调用者在目录上有 `WRITE_OWNER`**（上游 `packages/sandbox/sandbox-windows-acl` README「已验证边界」）；本机 **D: 盘继承 ACL 只给 `Authenticated Users:(M)`**（Modify 不含 WRITE_OWNER）→ 供给被拒 `Win32 5` → **该工作区里所有命令都在初始化阶段失败**（前台后台一视同仁，表现为「挂不上后台、秒死」）。壳启动时用**无副作用探针**（`CreateFileW(WRITE_OWNER)` 开目录句柄；`workspace_probe.rs`）判定：可供给 → 一行日志；不可供给 → 日志含修复命令 + 系统通知 + 页面顶部**横幅**（含「修复工作区权限」按钮，点击才执行 `icacls "…" /grant "<用户>:(OI)(CI)F"`；之后 dsh 会在该目录常驻能力 ACE、删除拒绝与 Low 完整性标签——上游设计使然、粘滞）。菜单「设置 → 修复工作区权限（授当前用户完全控制）」同效。反证开关 `WORLDSEA_NO_WORKSPACE_NOTICE=1`。**排查口径**：壳日志 `[DSH-SHELL] 工作区探测：…`；目录 ACL 用 `icacls <dir>` 看是否只有 `Authenticated Users:(M)`。
  **★ Agent 侧另有上游自带的诊断技能（G2 查实，2026-09-29）**：dsh 0.2.0 起 `sandbox-windows-acl` 带一个**给 Agent 用**的技能 `diagnose-windows-sandbox-acl`（`assets/` 下 SKILL.md + 721 行 PS1），声明 `modelInvocable: true, userInvocable: true`。**它开箱即开**：`sandbox-local/src/index.ts:301-303` 在 `process.platform === 'win32' && runnerCommand === undefined` 时无条件 `ctx.inject(['skills'], …)` 注册；`dsh-skill` 与 `dsh-sandbox-local` 均在 base bundle（`packages/bundle/base/cordis.patch.yml:295` / `:227`）；上游另有真打包启动的 e2e（`dsh/apps/desktop/tests/acl-skill.built.e2e.ts`）。**能力远大于我们的按钮**：它对**目标路径＋每一级祖先**做诊断并给 verdict（`CULPRIT` / `PRECONDITION` / `BOTH` / `UNREADABLE` / `INCOMPLETE` / `NOT_THIS_CLASS`），修法可选 `-Fix`（删个别包的 `S-1-15-2-*` allow ACE）或 `-GrantFullControl`（加当前用户 allow ACE），带 `-AllowRoot` 根限定、JSONL 报告与恢复命令。**我们这种症状（目录 ACL 缺 `WRITE_OWNER` → 供给被拒）在上游分类里是 `PRECONDITION`，对应动作正是 `-GrantFullControl` —— 与壳的 `icacls /grant …:(OI)(CI)F` 功能等价**（两者都供给 `WRITE_DAC` + `WRITE_OWNER`）。**为什么壳不改调该 PS1（**G2 结论；2026-09-29 按 rc.2 重估后**）**：① 技能资源目录是 `mkdtempSync(tmpdir(), 'dsh-acl-skill-')` 现建、纤维 dispose 即 `rm -rf`（`acl-skill.ts:47-48`，**rc.2 未改**）→ **无稳定路径**，壳要调只能摸 dsh 源码树内部 `assets/` 布局；② 需 **`pwsh`**（SKILL.md 用 `pwsh -File`，脚本自产的恢复命令也是 `pwsh …`；Windows 只保证 5.1）——而壳的按钮是**不可供给时的第一道自助，必须在裸 Windows 上可用**：`icacls` 恒在、`pwsh` 不保证有；③ **分工互补**：壳的探针/横幅/按钮＝用户侧自助（点一下就好），该 PS1＝Agent 侧深诊（命令已失败后、含别包 ACE 冲突与祖先链问题）——两条路不重叠。**★ rc.2 使两条旧理由作废（如实记）**：rc.2 把 `-Fix` / `-GrantFullControl` / `-Compact` 三个开关**删掉**，改为**一次授权内完成诊断+修复**，且**每次改动前都备份**并产出成对恢复命令 → 原来「要读 JSONL 报告再二次调用」「备份/回滚只服务删 ACE 场景」两条不再成立。**若将来需要「可回滚的工作区修复」**，按 rc.2 形态引入（探测 `pwsh` + 保留 `icacls` 兜底）——已登记在 [F3 批计划](../../plans/2026-09-29-F3-追版0.2.0-rc.2批计划.md) §六 G3 可选小项。
- **G3：一键修复升级为「可回滚修复」（2026-10-01，rc.2 形态；`acl_fix.rs`）**：① **主路径**调上游 rc.2 脚本 `diagnose-windows-sandbox-acl`（pwsh；祖先链 WRITE_DAC/WRITE_OWNER 一并修 + 显式 AppContainer 包 ACE 清理；一次运行含备份/复核/ROLLBACK 命令；**脚本真跑了就以其结论为准**——失败不回退 icacls，拒绝是它的安全判定）；② **兜底**（无 pwsh 或脚本缺）：`icacls /save` 留「修复前 SDDL 存档」→ `/grant` → 回滚命令 **`icacls /remove:g <用户>`**（★ 实测登记：`/save`→`/restore` 在四种变体下全失效「处理 0 个文件」；修复前已有该用户显式项时，恢复文件附 `# ⚠` 警示）；③ 恢复产物落 `<工作区>\.acl-recovery\`（`restore-command.txt` + 各备份/报告），**恢复由用户执行命令**（不做壳内一键回滚——用户 2026-10-01 拍板）；日志 `[DSH-SHELL] acl-fix: mode=…`。真机全周期验收（主路径/兜底/警示三分支 + 活体探针）通过，见 [G3 批计划](../../plans/2026-10-01-G3-可回滚工作区修复批计划.md)。
- **横幅/安全网样式改造（2026-10-01）**：壳注入的**工作区横幅**（`dsh_workspace_notice.js`）与**不白屏安全网**（`dsh_watchdog.js`）改吃 dsh 设计令牌——警告面配色取 `--dsw-alias-state-warn-*`（label / primary / tertiary）、按钮取 `--dsw-alias-button-primary-fill|hover` + `--dsw-alias-label-primary-foreground`、字体 `--dsw-font-family`、圆角 `--dsw-radius-sm`，**取不到令牌时回退自包含色值**（两件都可能出现在 dsh 样式不可用的场景）。横幅**顶部让位壳级窗口栏**：`top:var(--dsh-windows-titlebar-height,32px)` + 全屏 `html[data-fullscreen]{top:0}`——修复前 `top:0` 会被 32px 窗口栏盖住上半。**★ 挂载时序坑（CDP 实测逮到）**：两脚本在 **head 阶段注入**（body 尚不存在）——先把元素挂 `documentElement` 保可见，**`DOMContentLoaded` 后迁入 `body`**；否则 body 级令牌（`--dsw-alias-*` 定义在 `body` / `body[data-ds-dark-theme]`）继承不到、全落回兜底色（实测兜底 `#3f2f0a` ≠ 令牌 `#27241f`）。jsdom 用例 `workspaceNotice.spec.ts` / `bootWatchdog.spec.ts`（10 例，含 body 未就绪→DCL 迁入、令牌 / 让位 / 全屏归零契约）；反证 6/6 报红（`.workbuddy/_banner-falsify.mjs`）。**用户真机走查通过（2026-10-01，位置/观感/忽略/修复/F11 全项）。**
- **CSP 最小子集**：index 响应头 `object-src 'none'; base-uri 'self'; form-action 'none'`（`dsh_proxy.rs` 的 `CSP_INDEX`）；其余面（script/style/connect/frame/img/font + `worker-src blob:`）取证清单见 C3 批计划 §八。
- 页面探针仍是最顺手的取证手段（`WORLDSEA_EVAL_AFTER_READY` + `__WORLDSEA_SHELL__.report`）；脚本化 `location.href` 会被壳级栅栏拦下并落 `[DSH-SHELL] nav_fence: 拦下主框架导航 …` 行。

**排障开关**（壳侧环境变量，详见 `dsh_bridge.rs` / `dsh_proxy.rs` / `dsh_inject.rs` / `dsh_shell.rs` / `nav_fence.rs` 注释）：

| 变量 | 作用 |
|---|---|
| `WORLDSEA_TCP_HOST=1` | **legacy 对照口**：不传 `--ipc-pipe`（宿主按端口监听），壳走 C1 转发链 + WS 中转 + `streamBaseUrl` 注入 |
| `WORLDSEA_SHELL_DIAG=1` | 页内诊断开：注入 console 钩子（error/warn/未捕获异常/资源失败 → 壳日志 `page(diag)`）+ 开 `/__diag` 通道 |
| `WORLDSEA_NO_TRANSPORT_INJECT=1` | 反证用：不注入传输钩子（管道模式下 = 摘 `openStream`，页面退到 WS 路径并进入显式重连循环；HTTP RPC 仍通） |
| `WORLDSEA_NO_SHELL_BRIDGE=1` | 反证用：不注入壳桥 `__WORLDSEA_SHELL__`（「设置→打开设置」必须显式降级为右下角红条） |
| `WORLDSEA_LEGACY_DIRECT=1` | 回退直连 loopback（B2/B3 行为，跳过协议桥） |
| `WORLDSEA_DENY_PATH=<前缀>` | 测试钩子：该前缀一律 404（验「资源失败 → 非白屏」降级链） |
| `WORLDSEA_BRIDGE_OPEN=1` | 逃生口：关闭路径白名单（白名单误伤时先放行排查） |
| `WORLDSEA_RELOAD_AFTER=<秒>` | 核查用：页面就绪后再等 <秒> 做一次 `window.reload`（刷新/二次导航稳定性） |
| `WORLDSEA_EVAL_AFTER_READY=<js>` | 诊断用：页面就绪后注入执行一次指定 JS（结果经壳桥 `__WORLDSEA_SHELL__.report(...)` 落壳日志）。用于**免 UI 自动化取证**——如本次用它判定「外部打开」按钮的 `disabled` 状态与点击链（脚本化点击可绕过命中测试，故与真人点击可能有差异，详见下方「核查」） |
| `WORLDSEA_DSH_ROOT` / `WORLDSEA_DSH_HOME` / `WORLDSEA_NODE` | 指定 dsh 树 / home / node（默认自动探测与应用数据目录隔离 home） |
| `WORLDSEA_WORKSPACE` | **宿主 cwd / 会话默认工作区**（C4）。默认 `%USERPROFILE%\WorldSea`（缺失即创建；POSIX `$HOME/WorldSea`）。**必须落在「可供给」目录**——dsh 的 Windows ACL 沙箱要目录上有 `WRITE_OWNER`（见下） |
| `WORLDSEA_NO_WORKSPACE_NOTICE=1` | 反证用：工作区不可供给时不注入页面横幅（日志与系统通知仍在） |
| `WORLDSEA_KEEP_ENV_KEYS=1` | 反证/逃生口（C5）：强制保留继承的凭据环境变量。默认口径 = **库优先 + env 兜底**：`$DSH_HOME/.credentials.yaml`（页面「设置 → 模型」写入）已有该凭据时，壳 spawn 前剥离继承的 `DEEPSEEK_API_KEY`；库里没有则保留继承作零配置兜底 |
| `WORLDSEA_FRAMED=1` | **回退原生边框（C6）**：运行时 `set_decorations(true)` 且**不注入窗口栏**；缺省 = 无边框 + 窗口栏（旧 `WORLDSEA_FRAMELESS` 已按此语义反转移除） |
| `WORLDSEA_NO_TITLEBAR=1` | 反证用（C6）：不注入窗口栏（无边框下页面顶格、无拖拽——显式缺省，非静默） |
| `WORLDSEA_NO_CHANNEL_ORDER_FIX=1` | **反证用（F4）**：不装 Channel 全序拦截器（交回 Tauri 默认双路径）——「流式进行中刷新页面」的确定性复现应再红 |

> 日志面：宿主的 stdout 现以 **`[DSH-HOST]`** 前缀直出壳日志（管道载体/协议违规行都在那里）；壳的流命令留 `[DSH-SHELL] stream: open id=… endpoint=…` / `cancel id=…` 行——验收「流真的经管道」看这行。

> Git Bash 传这些值时注意 MSYS **路径转换**：`WORLDSEA_DENY_PATH=/assets/index-` 会被改写成 `E:/GIT/Git/assets/index-`——需前缀 `MSYS_NO_PATHCONV=1 MSYS2_ARG_CONV_EXCL='*'`。

**协议面的闸门与白名单（C1-b）**：壳在转发前先判「方法白名单（GET/HEAD/POST）/ 越界段（`.` `..` → 403）/ 路径白名单」，宿主随后仍按自己的语义再判一次。白名单**枚举自 dsh 源码**（`webServer.register`、`connection.fetch.register` 的调用点 + dist 根文件），新增宿主路由时要同步：改 `dsh_proxy.rs` 的 `ALLOWED_PREFIXES` + 补 `allowlist_covers_enumerated_host_routes` 用例。漏掉的路径会在壳日志留 `404（路径白名单外）`。

**HMR 已关闭**：`client-hmr` 的 `/plugins/events` 是 SSE 长连，而壳协议（Tauri `UriSchemeResponder`）只能回缓冲体 → 该行在壳内必然失效。已在 `apps/tauri/dsh-overlay.yml` 禁用；代理对任何 `text/event-stream` 响应显式 502 + 落档。若将来要 HMR，需要一条可流式的传输（C2 的 portless 通道是候选）。

**dsh profile 装配面与可选 bundle（G3 查实，2026-09-29）**：

- **补丁层序（低 → 高，`app-boot/src/profile-context.ts:65-69`）**：① bundle 层（各 `cordis.patch.yml`）→ ② **profile 补丁层**（`<DSH_HOME>/profiles/web/cordis.patch.yml`，由插件管理器/设置面写入）→ ③ home 层（`<DSH_HOME>/cordis.patch.yml`）→ ④ **我方 `--patch` overlay**（`context.overlays`，**最后 = 优先级最高**）。**含义**：我方 overlay 只该用于「覆盖上游默认值」，一旦某 `id` 写进去就**压住** ②③ 层对该 id 的改动——所以不要拿 overlay 去改用户会在 UI 里调的条目（现有两条 `ui-sidebar-browser` / `client-hmr` 都不属此类）。
- **profile 补丁层是活的**（真机证据）：本机 `profiles/web/cordis.patch.yml` 里已有 `ui-settings-general` / `ui-chat` / `ui-theme` / `llm-pi-ai`（含自定义 provider）等条目——由 UI/设置面写入并生效，证明该层在壳内可读可写。
- **可选 bundle = 上游内建的「装但默认关」机制**（`app-boot/src/profile.ts:213` 的 `OPTIONAL_BUNDLES`，注释原文「the bundles the dsh installation **ships for a person to switch on** … offered **switched off** by the plugin manager」）。四项：`dsh-experimental-agent-team-profile` / `voice-input-bundle` / `auto-review` / **`schedule-bundle`**。判定：`listBundles()` 里 `optional = OPTIONAL_BUNDLES.includes(name)`、`enabled = profile.manifest 的 dsh.profile.bundles 是否含它`（`plugin-manager/src/index.ts:280-317`）；本机 `profiles/web/package.json` 的 `bundles` **不含**任何可选 bundle → 默认关 ✓。
- **开关面**：`plugin-manager`（base bundle `cordis.patch.yml:20`）+ agent 工具 `tool-plugin-manager`（`:16`）+ UI `ui-plugin-manager`（web-app `:304`）。**开一个 bundle 的动作**（`plugin-manager/src/index.ts:715-733`）＝写 profile manifest 的 `dsh.profile.bundles` + 从**已安装的 bundle 目录**读其行（`bundlePatchPaths(dir, dsh.bundle)` 经 installAnchor 解析）；**不触发 pnpm 安装、不联网**。
- **`schedule-bundle` 已就位且默认关**：`dsh/apps/cli/package.json:42` 声明 `workspace:*`，符号链接 `dsh/apps/cli/node_modules/@deepseek-ai/dsh-experimental-schedule-bundle → packages/experimental/schedule-bundle/` 在位；开启后 insert 三行 `time-context` + `schedule` + `ui-schedule`（「自动化任务/定时提醒」）。**按需开即可，无需我方施工**（登记项 G3 已据此撤销）。
- **教训（连续三次同型）**：G1（`data-fullscreen` 前提误判）、G2（ACL 技能假缺口）、G3（可选 bundle 假缺口）——**登记「装配/对齐上游 X」之前，先查 `OPTIONAL_BUNDLES`、该包的 apply 接线、以及真机 profile 磁盘**；三次里两次零施工收场。

**壳件与壳桥（C1-c）**：

- **原生菜单**（`menu.rs`）：文件（关闭窗口/退出）· 编辑（撤销/重做/剪切/复制/粘贴/全选，muda 预定义项）· 视图（重新加载 · 放大 · 缩小 · 实际大小 · 全屏）· 设置（打开设置 · 通知自检 · 修复工作区权限）。**菜单项一律不带快捷键标注**（G1-e，2026-09-29 摘除）：原先挂的 `Ctrl+R` / `Ctrl+=` / `Ctrl+-` / `Ctrl+0` / `F11` / `Ctrl+,` 实测**全不生效**（G1-d 查实，理由见下条「菜单改 popup」），标注纯属误导故全部摘除；**不要因为「看起来该有快捷键」而加回去**——即便将来修好加速键路由（例如改调 `set_menu`），`F11` 会与注入脚本的页面侧监听**双重触发**（全屏切两次 = 看似失灵）。真通的键只有 `F11`（`dsh_titlebar.js` 页面侧监听，G1）与 `Ctrl+Shift+W`（`tauri-plugin-global-shortcut`，OS 层）。编辑族的标准键由 WebView2 自行处理，与加速键路由无关。
- **壳桥**（`dsh_shell_bridge.js` 注入 + `shell_bridge.rs` 命令）：页面可用 `globalThis.__WORLDSEA_SHELL__`：
  `notify(title, body)`（原生通知）· `openExternal(url)`（系统浏览器打开；仅 http(s)/mailto）· `report(msg)`（落壳日志 `[DSH-SHELL] bridge(page)`）· `openSettings()`（点开侧栏设置入口）。
  原理：我们的页面在 Tauri `is_local_url` 白名单内，`__TAURI_INTERNALS__.invoke` 直达应用命令（应用命令不属插件 ACL，无需 capability 项）。
- **通知**：壳桥 `notify` 是页面通道（dsh 客户端暂无生产者）；**宿主异常退出**时壳自带一条系统通知（窗口可能在托盘里）。
- **外链守卫（C1-c′，镜像官方 Electron 定义）**：官方 `setWindowOpenHandler` = http(s) 交 `shell.openExternal` + **恒 deny 新窗**；`will-navigate` = 只放行应用自身（同源 http 与 app scheme）。壳内等价实现（注入脚本）：捕获阶段 `click`/`auxclick` 拦截 `<a>`（同源放行、其余 http(s)/mailto → 系统浏览器、其它协议只拦截并落档）+ `window.open` 覆盖（一律返回 null）。**已知不覆盖**：程序化 `location` 赋值、WebView2 原生右键菜单「新窗口打开」（需要时用 WebView2 `NavigationStarting` 钩子补）。
- 注入脚本**四件套**的关停开关：`WORLDSEA_NO_TRANSPORT_INJECT` / `WORLDSEA_NO_SHELL_BRIDGE` / `WORLDSEA_NO_TITLEBAR`（+ 诊断钩子 `WORLDSEA_SHELL_DIAG`）。

**窗口栏（C6，2026-09-24，详见 [C6 批计划](../../plans/2026-09-24-C6-窗口栏形态恢复批计划.md)）**：

- **形态**：缺省**无边框**（`tauri.conf.json` 的 `decorations:false`）+ 壳侧注入的 **32px 窗口栏**（旧 `TitleBar.vue` space 变体：左侧「Agent 空间 ⇄ 工作台」切换胶囊 → 居中标题 → 右侧「⋯」菜单按钮 + 三控制按钮；控制按钮细线 SVG 照搬旧组件）。`WORLDSEA_FRAMED=1` 回退原生边框（同时不注入窗口栏）。
- **dsh 适配**：注入脚本置 `html[data-windows-titlebar]` + `--dsh-windows-titlebar-height: 32px`（**dsh 内置机制**，官方 Electron 桌面端同款，只是官方用 40px）→ dsh 界面自动留白 + `centerCol` 圆角 + 侧栏连色；**dsh 树零改动**。
- **拖拽 / 双击**：JS 方案（窗口栏空白区 `mousedown` → `cmd_shell_window_action start-drag`；`detail===2` → 最大化/还原）。**无系统边缘吸附（snap）**——已知差异；将来可评估 WebView2 non-client（`-webkit-app-region` + `IsNonClientRegionSupportEnabled`）。
- **工作台占位页**：点切换控件 → 「WorldSea · 产品域即将落位」占位页（DOM 覆盖层，dsh 页面保持运行、会话不丢）；产品域（26 芽，原 27——`official.module-builder` 已于 2026-09-25 随「自定义模块」剪除）真正落位时接真页。——**D1 已接真页、占位页退役**（见下节）。
- **菜单改 popup**：`menu.rs` 不再 `set_menu`（无边框下 Win32 菜单栏不可见，见下坑），改为窗口栏「⋯」按钮经 `cmd_shell_popup_menu`（`popup_menu_at` + 页面逻辑坐标）弹出；菜单内容与快捷键零删减（文件/编辑/视图/设置四子菜单）。**★ accelerator 已实测全不生效（G1-d，2026-09-29 查实）**：菜单是 popup 资源而非窗口菜单，而 Windows 下 Tauri 只在 `set_menu` 过的菜单上装加速键（`msg_hook` 遍历 `MenuManager.menus` stash 调 `TranslateAcceleratorW`——该 stash 只由 `AppHandle::set_menu` / `Window::set_menu` / 建窗器显式菜单三处填充）；`menu.rs` 只 `app.manage` 成 popup 资源、**从不 `set_menu`**，托盘菜单（`tray.rs`）各项 accelerator 又全 `None` → 菜单里标的 `Ctrl+R` / `Ctrl+=` / `Ctrl+-` / `Ctrl+0` / `Ctrl+,` **按下去毫无反应，只是标签**（真机双信号：注入标记后按 `Ctrl+R` 未重载；`prefs.json` 始终无 `zoom` 键）。**唯一真通的两个键**：dsh 窗的 `F11`（注入脚本页面侧监听，G1 批新做，不依赖 accelerator）与 `Ctrl+Shift+W`（`tauri-plugin-global-shortcut`，OS 层）。**后续任何键位工作不得走「往菜单项挂 accelerator」这条路**，只剩页面侧监听或 global-shortcut 两条。
- **全屏桥（G1，2026-09-29，详见 [G1 批计划](../../plans/2026-09-29-G1-C6全屏桥批计划.md)）**：`F11`（页面侧**捕获相位**监听）→ `cmd_shell_window_action toggle-fullscreen`；全屏时**隐藏注入的窗口栏**并置 `html[data-fullscreen]` → dsh 把浮层内缩从 `calc(32px + 20px)` 回落到 `20px`、遮罩 `inset` 从 32px 回落到 0；退出后全部还原。**语义要点**：`data-fullscreen` 对齐上游＝「原生窗口控件已隐藏」，**与最大化无关**（上游真源是 Electron 的 `enter/leave-full-screen`；最大化时我方窗口栏照旧在位，52px 内缩必须保住）。上游全屏分支只重置 `--dsh-frame-overlay-top` 与 `--dsh-frame-chrome-top`，**不**重置 `--dsh-windows-titlebar-height` → dsh 自己那条 32px 带仍在，E9 捞回的侧栏开关键在全屏时解除内联钉住、回它的原生定位（落在那条带内）。**三条触发路径**汇聚到 `applyFullscreen`：F11 的壳命令返回值 · 菜单（Rust 发起 `set_fullscreen` 后派发 `worldsea:fullscreen` CustomEvent）· 挂载与 resize 查询的返回值（故**全屏中重载页面能直接落全屏形态**）。事件名是壳两侧共享字面量，`titlebar.spec.ts` 有跨文件契约用例守着。

**工作台窗（D1，2026-09-24，详见 [D1 批计划](../../plans/2026-09-24-D1-产品域落位批计划.md)）**：

- **形态**：两个空间 = **两个窗口**（互斥显隐 + 几何同步）。`main` = Agent 空间（dsh 页，`http://worldsea.localhost/`）；`workspace` = 工作台（产品域页，`http://worldsea.localhost/workspace/`）——**同源**，主题等 localStorage 天然互通。
- **切换入口两条（各窗一条，不叠加）**：dsh 窗 = 注入式窗口栏的「Agent 空间」胶囊（`dsh_titlebar.js` → `cmd_shell_space_switch`）；工作台窗 = **旧前端自带 `TitleBar.vue`（workbench 变体）** 的同名胶囊（`toggleShell()` → index 注入的 `__WORLDSEA_SPACE_SWITCH__` 桥 → 同一命令）。工作台窗**不吃**注入式窗口栏（否则双栏）。切换时目标窗对齐来源窗几何；无桥时（浏览器预览 / 旧壳）回退页内壳切换（开发态行为不变）。
- **懒创建**：点「工作台」才建窗（`workspace_window.rs`；无边框 + `disable_drag_drop_handler` + 隐藏构建后显 + 挂 C3-b 导航栅栏），建后常驻（隐藏不销毁——保住工作台内编辑现场）。工作台窗 ✕ = 隐藏 + 回 Agent 空间（`lib.rs` 的 `CloseRequested` 分支）。
- **★ 建窗命令必须 `async`**（真机踩坑）：同步命令在**主线程**执行，而 `WebviewWindowBuilder::build()` 要在事件循环上等 WebView2 控制器的创建回执 → **自锁**（现象：窗口停在 `about:blank`、此后主线程不再响应任何 IPC、壳日志无后续行）。窗口 getter/动作类命令留同步无碍（C6 的 `cmd_shell_window_action` 先例）。
- **协议 `/workspace` 前缀**（`workspace_dist.rs`）：产物**运行时读盘**（不嵌二进制；`WORLDSEA_WORKSPACE_DIST` 可覆盖，缺省 `<crate>/../workspace-dist`；目录缺失给可辨认错误页 + 构建命令）；只 GET/HEAD（405 带 `allow`）；段级越界 403 + `canonicalize` 包含性复核；`assets/`（内容哈希名）长缓存、index 与其余 `no-store`；index 注入「不白屏」安全网（**root=`#app`**，与 dsh 页的 `#root` 区分）+ 空间切换桥；CSP 与 dsh 页同口径（`dsh_proxy::CSP_INDEX`）。**改产物不需重嵌二进制、不需重启壳**（下次导航即读新文件；当前页要 reload）。
- **构建**（从 `apps/tauri`）：`node node_modules/vite/bin/vite.js build --config workspace/vite.config.ts` → 产物 `apps/tauri/workspace-dist/`（已 gitignore）。
- **★ 桩规则必须按「归一说明符」写**（踩坑）：`resolve.alias` 先于插件 `resolveId` 生效 → 同一模块到本插件有两种写法（裸包名 / alias 后**绝对路径**）；按裸名写会**静默不命中**（实测：真 agent-runtime 注册表进产物，且启动抛 `e.capabilities is not iterable`）。现走 `canonical()` 归一（见 `workspace/vite.config.ts` 头注）。`@worldsea/agent-runtime` 根与 `@agent/index` **有意不桩**（真注册表 + 真 descriptor 自洽；桩掉会连锁缺导出），只桩叶级。
- **ACL（按窗口互斥授权）**：`capabilities/default.json`（main：壳桥 + 流桥）/ `capabilities/workspace.json`（workspace：壳桥 + `allow-product-domain` 116 条产品域命令，**无流桥**）。产品域清单来源 = **产物可达性**（`grep cmd_ 于 workspace-dist/assets/*.js`）∩ **源码归属**（`apps/tauri/src` + 仓根 `packages/*`，剔除 `packages/agent-runtime/**`）。双向反证口径：dsh 窗调 `cmd_fs_stat` → `not allowed … allowed on: [windows: "workspace"]`；工作台窗调 `cmd_stream_open` → `not allowed … allowed on: [windows: "main"]`。
- **探针**：`.workbuddy/d1-probe.mjs`（CDP：`list` / `eval <目标子串> <表达式|@文件>` / `log <子串> <秒> [--reload]` 收控制台 / `shot <子串> <png>`）；起壳带 `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222`。
- **★ 取证坑（UIA 误报）**：无边框下无障碍树**仍报告**「标题栏 / 菜单栏 应用程序」残留节点（而截图证实菜单栏并不存在）——菜单/标题栏是否可见**只能用截图判定**，UIA 树不可信。
- **★ 已知性能问题（顺带定位，非 C6 引入；2026-09-24 已定位到确切点）**：启动后页面约 **40~140 秒**才可用——确切阻塞 = `lib.rs` setup 里 **`block_on(mcp_commands::auto_connect_all(...))`**：**同步**连接 `{app_data}/worldsea/mcp.json` 里 `enabled` 的 MCP 服务器（**旧 Agent 面的 MCP**，dsh 界面不使用它）。当前配置仅一个服务器 **Exa**（`https://mcp.exa.ai/mcp`，streamable-http）；实测到该服务器**单次连接即 10.2 秒**（境外网络）→ 握手多往返累计 40~140 秒（网络状况决定波动：39s / 46s / 138s）。`navigate` 排队等 setup 完成，故页面延迟加载；**原生边框对照实验同样慢（138s）**→ 与本批无关。诊断法：临时在 setup 各阶段插 `Instant::now()` 日志（本轮用后已删）。**处置选项（2026-09-24 已呈报用户，待决定）**：a) 零代码——`mcp.json` 里 Exa `"enabled": false`（或删项，立即见效）；b) 小改——`auto_connect_all` 改后台 `spawn`（不再 block setup；按「旧 Agent 面冻结」纪律需登记）；c) 不动（接受等待）。

- **启动页（splash，2026-09-24 迁移回）**：壳启动期显示**原 Vue 版启动页**（`src/ui/boot/SplashScreen.vue`：双 Canvas 星座 / 鼠标交互 + 四角 HUD + 进度条 + 版本号），**构建入口** `apps/tauri/splash/`（vite 打包 → 产出落 `shell-loading/`，即壳 `frontendDist`）。
  - **构建**：`cd apps/tauri && node node_modules/vite/bin/vite.js build --config splash/vite.config.ts`（~1s）。
  - **★ 重嵌入坑**：改动 `shell-loading/` 产物后**必须 `touch src-tauri/tauri.conf.json` 再 `cargo build`**——否则 tauri-build 不重新嵌入资源，壳内仍是旧版（本轮实测踩坑）。
  - **淡出钩子**：壳导航前触发页面 `__wsSplash.ready()`（splash 桩暴露；→ `bootState='ready'` → 600ms 淡出）+ 700ms 再 navigate；钩子缺失（错误页等）时静默跳过。
  - **★ 为什么此前启动页不可见（根因与修复）**：Tauri 对 frontendDist 的**初始导航排在 setup 之后**，而 setup 曾被 `dsh_shell::install`（spawn 宿主 + 等就绪）**同步阻塞约 12s** → 阻塞期窗口为空文档（黑屏），setup 结束后初始导航又被紧随的 dsh 导航瞬间替换。**修复 = `dsh_shell::install` 后台化**（宿主等待移入线程；setup 秒级结束）→ 窗口秒开即显示启动页。
  - **诊断**：`WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222` 起壳 → `curl http://127.0.0.1:9222/json/list` + CDP `Runtime.evaluate`（node 内置 WebSocket、零新依赖）——「空文档 / 资源缺失 / JS 报错」类问题的标准手法。

**主题单真源（E2，2026-09-24，详见 [E2 批计划](../../plans/2026-09-24-E2-主题单真源批计划.md)）**：

- **真源** = `<app_data>\worldsea\prefs.json` 的 `theme`（`light|dark|system`）——**壳持有**；产品页 index 注入 `__WORLDSEA_THEME__` / `__WORLDSEA_SET_THEME__` / `__WORLDSEA_DARK__`，dsh 页由壳经 `settings/update` 写它的 `ui-theme` 偏好。同步时机 = 启动（种子/写回）+ 产品侧改动（命令内）+ **每次空间切换**（在 dsh 里改过 → 切到工作台时跟随）。
- **命令**：`cmd_theme_get` / `cmd_theme_set`（共用壳桥权限内）；广播事件 `worldsea:theme-changed`（产品 `useTheme` 监听重应用，并顺带刷新两页注入快照）。
- **壳自有面**（HTML 错误页 / 不白屏安全网 / 工作区横幅）按真源取**亮暗两套**（此前三处各自硬编码深色）；模板单点 `app_prefs::error_page_html`。**2026-10-01 起**：横幅与安全网改为**令牌优先**（吃 dsh `--dsw-*`，兜底仍是这亮暗两套）。
- **★ 壳内调 dsh API 的信封**（后续所有壳侧 dsh 调用照此办）：body 必须是
  `{"type":"client-request","rpcId":"…","method":"<路由名>","payload":{"args":{…}}}` —— 缺 body → `400 body is not JSON`；`method` 要与路由名一致（否则 `gateway/bad-request: method … does not match endpoint …`）；`payload` 只能有 `args` 一个对象字段；字段名按端点 schema（`settings/update` 用 **`patch`**）。
- **读 dsh 现值**：走 **index 的 boot-theme 行**（`const preference = "…"`）——`settings/describe` 里 `preference` 同名键多（多个命名空间/schema，实测误读成相邻键），别解析它。
- **排查**：壳日志 `[DSH-SHELL] theme:` 行（真源 / 种子 / 跟随 / 同步失败都留痕）。

**能力桥（A）与视图生命周期（D），2026-09-25，详见 [DA 批计划](../../plans/2026-09-25-双Cordis-DA批计划.md)**：

- **角色**：`product`（工作台窗 = 世界语义提供方）/ `agent`（主窗 = Agent 面）/ `shell`（注册表 + ACL + 中转 + 审计，v1 不做提供方）。这是**双 Cordis 的交界缝**：Agent 面的调用方经壳调产品域能力，反之亦然。
- **命令**（权限 `allow-capability-bridge`，**两窗共用**——它本身就是两窗的缝）：`cmd_capability_register(decls)`（provider = 调用窗口 label，**不可冒名**；同 id 异提供方 → CONFLICT；同提供方重复 → 覆盖）/ `cmd_capability_list()` / `cmd_capability_invoke(id, args)`（`async`，10s 超时）/ `cmd_capability_result(callId, ok, result, error)`（**只有该调用的提供方窗口**能回）。
- **中转**：壳在提供方窗口 `eval` `__WORLDSEA_CAPABILITY_CALL__(callId, id, args)` → 提供方 `Promise.resolve(handler(args))` → 回执。两端同一套派发协议（脚本：`dsh_capabilities.js` 与 `apps/tauri/src/shell/capabilities.ts` 的伺服）；handler 必须**快返回**（eval 跑在主线程；重工作先异步化再回执）。
- **错误码**（结构化前缀）：`CAPABILITY_UNKNOWN` / `CAPABILITY_FORBIDDEN` / `CAPABILITY_CONFLICT` / `CAPABILITY_UNAVAILABLE`（提供方窗口未打开）/ `CAPABILITY_TIMEOUT` / `CAPABILITY_BAD_DECL` / `CAPABILITY_NO_PENDING`。
- **首批能力**：`world.views.list`、`world.project.current`（provider=workspace，acl=[main]）；`agent.face.status`（provider=main，acl=[workspace]）。
- **审计**：壳日志 `[WORLDSEA-CAP] 登记 / 调用 / 回执 / 拒` 行（含 provider、ACL 拒因、耗时）。
- **开关**：`WORLDSEA_NO_CAPABILITY_BRIDGE=1`（不注入 agent 侧伺服 → agent 提供方缺席，跨窗调用报 UNKNOWN；反证用）。产品侧登记面 = `registerWorldCapabilities()`（B/C 批的芽注册自己的能力调它；工作台入口已登记内建两条）。
- **D · 视图生命周期**：真源 = `pluginAPI`（`onViewChange` 派发注册/反注册 + `unregisterView`），显示侧 = `pluginStore`（补 `unregisterView`），装配点**单点** = `plugins/viewSync.ts` 的 `installViewSynchronizer()`（幂等）。两条刻意不做：不删侧栏顺序偏好、不夺当前选中（理由见批计划 §一）。
- **探针**：`__WS_VIEWS_PROBE__`（三面快照 truth/mirror/order + 真源级 `register`/`unregister` + `detach()/attach()` 反证）随**第二棵树的开发探针**装载（`apps/tauri/src/world/dev/probe.ts`；开关仍是 `localStorage['ws:cordis-spike']='1'`）。**取证口径**：窗口隐藏时侧栏 DOM 不重排（轮播靠 rAF）→ 侧栏可见性必须在**切到工作台窗之后**取证；能力调用两窗各自在**自己 ACL 内**发（跨窗只在 ACL 允许方向）。

**第二棵树（B · 世界语义正式化，2026-09-25，详见 [B 批计划](../../plans/2026-09-25-B-正式化第二棵树批计划.md)）**：

- **依赖 = 自 vendor**：`apps/tauri/src/world/vendor/{cordis,cosmokit}/lib/index.js`（= dsh 侧 `@deepseek-ai/cordis@4.0.4` / `@deepseek-ai/cosmokit` 的产物副本，MIT，字节一致）；**不依赖 `dsh/` 目录**（`grep "dsh/vendor" apps/` 应为空）。解析靠别名 `@deepseek-ai/cordis` / `@deepseek-ai/cosmokit` → 产物（`apps/tauri/vite.config.ts` + 根 `vitest.config.ts` 两处同口径）。**npm 无 4.0.4**（公开最新 4.0.0-rc.10），故不可 npm 依赖；同步/升级办法见 `vendor/README.md`。
- **目录**：`apps/tauri/src/world/` —— `manifest.ts`（清单规范+校验）· `loader.ts`（`import.meta.glob` 构建期静态清单 + `assemblePlugins` 纯函数：校验/依赖预检/去重/**失败隔离**）· `registry.ts`（**作用域注册**：`registerViewFor`/`unregisterViewFor`/`registerPluginCleanup`）· `tree.ts`（起树/拆树，句柄镜像 `__WS_WORLD_TREE__`）· `plugins/<id>/index.ts`（插件，`export default { manifest, apply }`）· `dev/probe.ts`（开发探针）。
- **作用域原语**：`pluginAPI.withPluginScope(pluginId, fn)`（进入备份、退出恢复，**同步语义**）——修「`currentPluginId` 全局单值 → 树插件身份错乱」；`PluginManager.activate` 的既有全局 set 语义**未动**（async 跨 await 持全局态风险大）。
- **视图可见性口径**：`stores/viewVisibility.ts` 的 `isViewVisible(pluginId)`——无归属→显示；清单内→按芽启停；**清单外（树插件 id）→显示**（否则树插件的视图会被 `isActive` 恒 false 误隐藏）。
- **起树位置**：工作台入口 `apps/tauri/workspace/main.ts`（`startWorldTree()`，幂等）；`viewSync` 装配时对账一次 → 起树与装配的先后顺序无关。开发期热重载：`src/world/index.ts` 自接受 HMR（更新即拆树→重起）。
- **真机口径**：`__WS_WORLD_TREE__`（started/plugins/rejected/error/dispose）；日志 `[world-tree]`；拆树后 `__WS_VIEWS_PROBE__.snapshot().truth` 与 `mirror` 均无 `ws-*` 残留。

**树内第一个真芽：思维导图（C，2026-09-25，详见 [C 批计划](../../plans/2026-09-25-C-迁真芽-mindmap批计划.md)）**：

- **形态**：`world/plugins/mindmap/`（`index.ts` 插件入口 + `manifest.ts` **轻清单** + `capabilities.ts` 能力面 + 视图/文档/存储四件；清单拆轻是为「装载器/测试不拉起重图」——`mind-elixir` 图在 vitest 并行下导入 >35s）。
- **迁移口径（后续芽照此办）**：搬目录（`git mv`）→ 换入口（清单/作用域注册/能力/清理）→ 能力改桥 → 5 处清单与路径收敛；**组件内部不动**（entity-core / ui-kit / plugin-sdk 是**合法的产品级共享服务**）。官方芽数 **26 → 25**（设置面板不再有「思维导图」启停行；侧栏可见性由 `isViewVisible` 的「清单外→显示」接管）。
- **身份与作用域**：视图 `mindmap` 带 `pluginId='ws.mindmap'`（作用域原语）；`useProjectSwitcher` 的动态 import 改指 `@/world/plugins/mindmap/mindmapStore`。
- **能力面（5 条，acl=[main]）**：`world.mindmap.list/read/create/append/write`（`write` 为破坏性：写前自动备份到项目 KV + 摘要里写明）。返回值 = **结构化对象**（旧描述符回 JSON 字符串）；写后派发 `ws-mindmap-docs-changed`（视图开着即时刷新）。
- **撤登记（C 批新增命令）**：`cmd_capability_unregister(ids)`——只有**登记方窗口**能撤自己的（混入他人能力整批拒）；随插件清理执行（拆树即撤，真机反证：撤后跨窗调用报 `CAPABILITY_UNKNOWN`）。
- **旧面**：`mindmap/agent-descriptor.ts`（旧内部注册表登记）已删；`agent-runtime` 的 13 条 `MINDMAP_ACTIONS`（DOM 事件）与 guide **未动**（旧 Agent 面冻结，属 D2）。
- **真机口径**：主窗 `cmd_capability_invoke('world.mindmap.create', {name, markdown})` → `read` 回读大纲 → `list` 计数；拆树后 `cmd_capability_list` 里 `world.mindmap.*` 计数应回 0。

**批量迁芽（C2，2026-09-25，详见 [C2 批计划](../../plans/2026-09-25-C2-批量迁芽批计划.md)）**：

- **插件 API**（`world/api.ts`）：插件形态 `apply(ctx, api)`；`api` = `registerView` / `registerEntityV2` / `registerEntityType`（旧版自动归一 V2）/ `registerRelationV2` / `registerFacet` / `capabilities.register`。**生命周期口径**：视图与能力**随卸载自动反注册**；实体/关系类型**不注销**（沿用旧语义）。
- **真启停**：启停来源 = 芽清单，判定口径 = `isViewVisible`（与侧栏可见性**同一函数**，清单外视为启用）。`world/index.ts` 的 `installWorldTree()` 起树 + `watch(sprouts)` → `setPluginEnabled(id, on)` 动态装/卸（卸 = 插件清理 → fiber dispose）。探针可直接 `__WS_WORLD_TREE__.enable/disable(id)`。
- **装载过滤**：`assemblePlugins(candidates, services, { isEnabled })`——未启用记 `report.skipped`（**不算拒**），插件仍在 `accepted`（`availablePlugins()` 可取，供随时启停）。
- **迁移三件套（脚本化，`.workbuddy/c2-stage1-migrate.mjs`）**：搬迁目录 → 入口三处改造（`PluginAPIType`→`WorldPluginApi`（`../../api`）· `activate(api)`→`apply(_ctx, api)` · 尾追 `export default { manifest, apply }`）→ 外部引用改径（`@/sprouts/official/〈芽〉/…` → `@/world/plugins/〈芽〉/…`；**跨芽相对引用**如 `graph → ../timeline/…` 也要改绝对别名）。清单两处减条（`bootstrap.ts`、`plugin-manifest.ts`），**芽清单行（`settingsStore.DEFAULT_SPROUTS`）保留**（启停 UI 来源）。
- **注释陷阱（已两次踩到）**：注释里写 `sprouts/official/*/index.ts` 会因 `*/` **提前终结块注释** → 改用全角 `〈〉` 或换措辞。
- **真机口径**：`__WS_WORLD_TREE__.plugins/skipped/rejected`；启停看 `plugins` 计数与侧栏标签同步；视图真源可经能力桥 `world.views.list` 核。

**目录口径（E1，2026-09-25，详见 [E1 批计划](../../plans/2026-09-25-E1-目录口径批计划.md)）**：

- **单一可见根 = `%USERPROFILE%\WorldSea`**（也正是 dsh 工作区）→ 根下 `worlddata\`（默认项目实体）· `agent\`（默认项目 Agent 工作区）· `rules\`（全局规则）· `skills\`（个人技能导入区）；旧 `~/.WorldSea` 退役。
- **一次性搬迁**：启动期 `data_root::migrate_legacy_home_root()` 把旧根四子目录**复制**到新根（旧存在且新不存在才拷；**只拷不删**，日志前缀 `[WORLDSEA-DATA]`）；`WORLDSEA_NO_DATA_MIGRATE=1` 反证关。
- **dsh 首次使用候选（4A）**：壳 spawn 显式导出 `WORLDSEA_WORKSPACE`；overlay 把 `workspace-controller.documentsDirectory` 指向它 → 新候选落在根内（不再倾向 `Documents\deepseek-harness`）。**存量** registry 条目（历史候选）不自动改——由用户在 dsh UI 处置或按 API 改写。
- **写边界裁定（5A）**：产品域 `cmd_fs_*` **保留宽口径**（本地创作工具语义；仅拒 `~/.ssh` / `~/.gnupg` / 系统目录）；dsh 侧严沙箱（cwd + tmp）——**两套写规则并存是显式设计**，非缺陷（`fs_commands.rs` 头注留档）。

**C2 完成态（2026-09-25）**：**25 个官方芽全部在树内**（`world/plugins/**`，插件 id 沿用 `official.*`）；`sprouts/` 目录已删除；**旧芽机器退场**（`PluginManager` / `PluginSandbox` / `plugin-manifest` / 旧 `bootstrap` 全删，含 Phase-3 死代码 `plugins/workflow/`）——产品壳只留 `plugins/{boot.ts,viewSync.ts}`：
- `boot.ts` 的 `bootstrapShell()` = 视图生命周期同步装配 + 首屏默认视图（原 `bootstrapSprouts` 的装载/注册职责归树）；
- 启动顺序：`main.ts`（App 挂载）→ `App.vue` 的 `bootstrapShell()` → 工作台入口的 `installWorldTree()`（树的装载读芽清单）；
- 台账：树 `plugins` = 芽面板里开着的（含 mindmap）+ 清单外的树插件（`ws.spike.panel`），`skipped` = 关掉的（如 `official.custom`）。**修正（走查反馈）**：思维导图原用 `ws.mindmap`（C 批临时口径，离开芽清单）→ C2 走查后**归一为 `official.mindmap` 并加回芽清单行**（芽面板即插件启停台账，26 行；不带 pluginId 的清单外插件仅示例 `ws.spike.panel`）。

**核查与清理**（改壳或复跑前）：
- `taskkill //IM worldsea-tauri-app.exe //T //F` 清干净再起；被强杀的实例会留**孤儿 dsh host**（node 不在 Job Object 里），用 `tasklist | grep -i node` 复核。**本机 `wmic` 已失效（恒返回空）**——进程核查改用 `tasklist` / `powershell Get-CimInstance`。
- 应用日志建议直写（`… > 日志 2>&1`）；本机 `tee` 有块缓冲，短窗口内读会拿到**过期内容**（曾据此误判「页面未加载」）。
- Windows 坑（已修，代码注释留档）：`accept()` 出来的套接字**继承 listener 的非阻塞态**（Unix 不继承），中转若忘了 `set_nonblocking(false)`，握手 101 后会 0 字节即断（`WSAEWOULDBLOCK 10035`）。
- 涉及「点击后看效果」的核查：**本机 computer-use 的合成按键/UIA 动作被分类器拦下**（要求用户逐次确认）→ 自证走 `WORLDSEA_EVAL_AFTER_READY` 页面探针 + 无障碍树。注意探针里的 `element.click()` **绕过命中测试**：探针能点而真人点不动（被遮挡、命中区异常）这类差异只能由用户走查确认（2026-09-24「外部打开」按钮一次实测即为此类边界）。
