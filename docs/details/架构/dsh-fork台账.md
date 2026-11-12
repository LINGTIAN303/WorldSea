# dsh fork 台账

> **status: 现行**（2026-09-24 建立，D10 口径改判的配套）｜ 用途：`dsh/` 已是**我方 fork**（不再「只读地基」）——本台账登记**我方对 `dsh/` 的每一处改动**，使 ① 任何未登记的改动被门禁拦下；② 将来若要从上游摘取修复，能一眼看出冲突面。
> 口径改判见 [准备方案](../../plans/2026-09-23-dsh接管Agent面-大重构准备.md) §一 D10 / §五；运行口径见 [dsh 运行手册](dsh-运行手册.md)。

## 一、基线

基线提交：`6c7ebbf`

对应上游：tag `dsh-v0.2.2-rc.2`（上游提交 `ddac9676` 的干净树；换树记录见该提交信息）。

**F8 追版后的台账收敛（2026-11-13，rc.1 → rc.2）**：我方从 **21 条减到 13 条**——不是改动减少了工作量，而是**上游把 8 处我方修复吸收进主线**：

| 原条目 | 去向 |
|---|---|
| `apps/cli/src/profile-boot.ts`（`DSH_USER_AGENT_SUFFIX` + `userAgentProfile`） | ✅ 上游 rc.2 已实现同语义（函数与调用点逐字等价） |
| `packages/boot/app-boot/src/index.ts`（home 层 `.env` 放行 `DEEPSEEK_BASE_URL`/`DEEPSEEK_SEARCH_BASE_URL`） | ✅ 上游 rc.2 已实现 `isHomeLayerRouteName` + `HOME_LAYER_ENDPOINT_NAMES`，与「两边都要」融合版一致 |
| `packages/boot/app-boot/tests/app-boot.spec.ts` | ✅ 随上一项同去 |
| `packages/client/ui-settings-account/{README.md,README.zh.md,src/client/index.ts,tests/apply.client.spec.ts}` | ✅ 上游 rc.2 已含等价改动 |
| `packages/host/webserver/tests/webserver.spec.ts` | ✅ 上游 rc.2 已含等价用例 |
| `packages/credentials/deepseek-account-platform/src/index.ts` | ⚠️ **上游删包重构**为 `deepseek-account`（见下条），改动随迁 |

**`deepseek-account-platform` → `deepseek-account`**：上游 0.2.2-rc.1 起把抽象 account 类拆为具体 `DeepSeekAccount` 服务，按职责拆成 `account-tasks` / `client-metadata` / `details` / `logout` / `notifications` / `protocol` / `types`。我方 H2 的「回调 drain 有界等待」迁至新包 `src/index.ts` 的**同名 `finished()` 调用点**（代码逐字相同）。凭据键 `deepseek-account-platform/{default,device}` 保持原样，用户无需重新登录。

- **前次基线**：`d08adf4`（tag `dsh-v0.2.2-rc.1`，上游 `66491b05…`）——追版记录见 [F7 批计划](../../plans/已完成/2026-11-04-F7-追版dsh-0.2.2-rc.1批计划.md)。
- **更早基线**：`a71b4ba`（tag `dsh-v0.2.1-rc.5`，上游 `b830ec95…`）——见 [F6 批计划](../../plans/已完成/2026-11-03-F6-追版dsh-0.2.1-rc.5批计划.md)。
- **更早基线**：`962c6f6`（tag `dsh-v0.2.1-rc.2`，上游 `687f282e…`）——见 [F6 批计划](../../plans/已完成/2026-11-03-F6-追版dsh-0.2.1-rc.5批计划.md)。
- **更早基线**：`096a48c`（tag `dsh-v0.2.0-rc.2`，上游 `639ed015…`）——追版记录见 [F5 批计划](../../plans/已完成/2026-10-17-F5-追版dsh-0.2.1-rc.2批计划.md)。
- **更早基线**：`0c6f8b2`（tag `dsh-v0.2.0-rc.1`，上游 `4878cdab…`）——追版记录见 [F2 批计划](../../plans/已完成/2026-09-29-F2-追版0.2.0-rc.1批计划.md)；`cde62e7`（tag `dsh-v0.1.7-rc.2`，上游 `477b4f42…`）——见 [F1 批计划](../../plans/已完成/2026-09-24-F1-追版rc2批计划.md)。

**追版重放（2026-11-05，0.2.1-rc.5 → 0.2.2-rc.1）**：上游 delta **8,152 路径**（改 4,074 / 增 4,006 / 删 72），实质源码 **1,367 文件 / 145,604 行**（约 F5 的 0.9 倍、F6 的 50 倍）。**我方 16 处改动中 7 处与上游重叠**；`git apply --3way` **4 文件 / 7 处冲突块**（`webserver/src/index.ts` 4 · `app-boot/src/index.ts` 1 · `web-app/package.json` 1 · `webserver.spec.ts` 1），全部按「两边都要」融合：上游 0.2.2 的 `WebResource`/`readResource`/`PeerScope` 资源路由与把 `handle` 抽成 `this.serve()`，与我方 `WebRouteEntry` 包装（G1 闸门 + G5/G7 崩溃归因 `callerPluginName`）+ `external`/`dispatch`/`listPrefixRoutes` 共存。**命脉接缝零改动**：`bundle/web-app/src/`（就绪行 / `--ipc-pipe` 旗标族 / 帧编解码）**与 `apps/desktop/src/preload-windows.ts` 上游零触碰**；C6 窗口栏三处令牌与 E9 捞回键特征全在；overlay 三个目标 id 全在；`webServer.register` 调用点 14=14。**上游面变动**：`vendor/cordis` **4.0.5 → 4.1.0**（`events`/`fiber`/`reflect` 大改）→ 第二棵树自 vendor 副本已同步，`vue-tsc` 0 错、`cordis.d.ts` 无需调整；`boot/app-boot` 结构重写（删 `official-bundles{,-packages}.generated.ts` 三文件、增 `bundle-platform.ts`/`startup-diagnostics.ts`）；Node engines 抬到 **`>=24.9.0`**（本机 v24.22.1 满足）。**换树注意**：上游 14 个 symlink 需物化（含目录型 `.claude/skills` 展开 42 文件）；`web-app/package.json` 的 `dsh-agent-tool-presentation` 是旧版残留（上游已移除），冲突消解时误保留导致 `--frozen-lockfile` 报 OUTDATED，删后与上游依赖集差异只剩我方必需的 `api-gateway` 一条。**非冲突适配**：cordis 4.1.0 类型收紧触发 13 处 lint（`ctx.fiber` 非可选、`Context.get` 返回类型、`no-dynamic-delete`）+ 5 处风格；`ended` 改装箱对象（闭包外赋值 CFA 看不到）。**花名册同步**：上游 0.2.2 标准预设 4 处变更（`tool-fs` 增 `applyPatch:false`、`tool-subagent` 字段改名、`tool-plugin-manager` 的 disabled 改 `!!js` 表达式、无 `list-agents`），`preset-worldsea` 按 22 行全量重建 + worldsea 子行 = 23 行。详见 [F7 批计划](../../plans/已完成/2026-11-04-F7-追版dsh-0.2.2-rc.1批计划.md)。

- **追版重放（2026-11-03，0.2.1-rc.2 → 0.2.1-rc.5）**：上游 delta **676 路径**（改 610 / 增 56 / 删 3 / 重命名 7），扣除版本号 343、快照 71、测试 81、文档与笔记 33、配置 74 后**实质源码仅 71 文件 / 2,906 行**，约为 F5 的 1/13。**我方 11 处改动只与 2 个文件重叠**（上游 `cordis.patch.yml` 在 `ui-agent-preset` 之后新增 `entry-customization` 一行、`web-app/package.json` 新增 `dsh-client-ui-entry-customization` 依赖边）；`git apply --3way` **10 处全部干净应用**（3 处走直接应用；零冲突标记），`cordis.patch.yml` 的 `external`+`ipcPipe` 与上游 `entry-customization` 三处共存，`package.json` 的 `dsh-api-gateway` 与 `dsh-client-ui-entry-customization` 两条依赖边共存。**命脉接缝逐条零改动**：`bundle/web-app/src/{index,startup,pipe-transport}.ts`（就绪行 / `--ipc-pipe` 旗标族 / 帧编解码）· `host/webserver/src/index.ts`（`external`/`dispatch`）· `client/web/src/boot.ts` · `client/connection/src` · `api/gateway/src` · `apps/cli/src` · `apps/desktop/src/preload-windows.ts`。**C6 窗口栏面零改动**：`ui-layout/AppFrame.module.css` 与 `ui-primitives/overlay-top-margin.ts` 均未动，`html[data-windows-titlebar]` / `--dsh-windows-titlebar-height` / `--dsh-frame-overlay-top` 令牌与 E9 捞回键所需的 `button[aria-keyshortcuts]` + `.toggle` + `position:fixed` 特征全部仍在位。**上游面零变动**：`vendor/`（cordis 仍 4.0.5，我方自 vendor 副本无需重同步）· `OPTIONAL_BUNDLES` 逐字相同 · `bundle/base/cordis.patch.yml` 字节相同 · `node engines` 不变 · `webServer.register` 调用点数 14=14（壳白名单无需增补）。**换树新增注意**：上游 rc.5 有 13 个 symlink（`CLAUDE.md` ×3、`.agents/notes/implemented/CLAUDE.md`、`.agents/skills/agent-experience/SKILL.md`、`apps/cli/tests/profiles/acp/cordis.yml`、`snapshots/{acp,sdk,session}` 下 7 个 expected 文件）——本仓 `core.symlinks=false`，按既有口径**物化为实体文件**（`git update-index --cacheinfo 100644`），换树后零 T 类型变更。另：我方 `.claude/skills` 40 个实体副本与上游 `.agents/skills` 逐字节一致，无需同步。详见 [F6 批计划](../../plans/已完成/2026-11-03-F6-追版dsh-0.2.1-rc.5批计划.md)。

- **追版重放（2026-10-18，0.2.0-rc.2 → 0.2.1-rc.2）**：上游 delta **9,058 路径**（改 4,399 / 增 3,426 / 删 1,233），39 个命脉接缝被改，我方 11 处改动 **8 处重叠**。`git apply --3way` **4 文件 / 19 处冲突**：`bundle/web-app/src/startup.ts`（6，新增 `--public-url`/TLS 旗标族与 `--ipc-pipe` 合并）、`bundle/web-app/src/index.ts`（5，上游 `WebApp`/`publicUrl`/就绪行新结构与 pipe carrier 合并）、`host/webserver/src/index.ts`（5，上游 TLS/地址谓词重构与 `external`/`dispatch` 合并，保留 unbound dispose 保护）、`bundle/web-app/cordis.patch.yml`（3，`tls`+`external` 双键、`publicUrl`+`ipcPipe`，保留上游 `harness-dev-context` 行）。`package.json` / `tsconfig.json` / `webserver.spec.ts` 自动合并干净；3 个新增文件无冲突。**非冲突适配**：`TypertGatewayWireStream.open` 的 `peer` 变必填 → 管道改用 `connection.browserPeer`；`trustedHosts` 迁到连接层直接读 `webStartup`（web-app Config 删除该项）；`webServer.port` 保留上游 `number | undefined`，external 模式在 init 写入 `listenedPort`（读到声明端口）。锁文件按既有纪律重放。

- **追版重放（2026-09-29 同日，0.2.0-rc.1 → 0.2.0-rc.2）**：上游 delta **1012 路径**（918 内容改 + 89 增 + 5 删）。**取树走 codeload tarball**——GitHub 的 git 链路本轮不通（`schannel` 握手失败），改用 `curl` 取 tarball；两棵树用同一方法物化后 `diff -rq` 量冲突面（`.gitattributes` 无 `export-ignore`，故 `git archive` 与 tarball 的文件集一致，比较可信）。**我方 11 处改动的冲突面只剩 2 处**：`bundle/web-app/package.json`（上游改动**只是版本号** `0.2.0-rc.1 → 0.2.0-rc.2`）与 `pnpm-lock.yaml`（按硬纪律重放）。`git apply --3way` **10 处全部干净应用**（其中 3 处走直接应用；零冲突标记；`package.json` 的三方合并把「上游版本号」与「我方依赖边」正确组合）。**命脉接缝只有两处被上游动过、且都是加性**：`apps/cli/src/{args,bin,plugin}.ts`（新 `RunCliOptions` / `parseDshArgs` 增第三参 / `plugin` 子命令放宽 desktop profile 管理——围绕 rc.2 新增的「桌面端经菜单栏管理 dsh 命令」；**不碰 `--patch` / `--ipc-pipe`**，两者在未动的 `web-app/src/startup.ts`）与 `api/gateway/src/{index,types}.ts`（新增 `hasLiveClient()` 与 `RemoteEventClient.signal`——加性，消费者不受影响）。**就绪行所在 `bundle/web-app/src/index.ts`**，以及 `host/webserver/src` · `bundle/web-app/src` · `client/web/src/boot.ts` · `client/connection/src` · `apps/desktop/src/preload-windows.ts` **全未动**；我方 overlay 两条目标 id 所在 `bundle/web-app/cordis.patch.yml` 未动。换树同时清掉 330 个 `lib/` 产物目录 + 356 个 `*.tsbuildinfo` + `.dsh-build/` + `apps/web/dist/` + 空壳的陈旧 `examples/`（均被 `dsh/.gitignore` 忽略）。详见 [F3 批计划](../../plans/已完成/2026-09-29-F3-追版0.2.0-rc.2批计划.md)。

- **追版重放（2026-09-29，0.1.7-rc.2 → 0.2.0-rc.1）**：上游 delta **1,109 文件 / +20,374 −77,795**（树 13,850 → 14,004 文件）。我方 11 处改动的冲突面仍只有 **3 处**（`bundle/web-app/cordis.patch.yml` · `bundle/web-app/package.json` · `pnpm-lock.yaml`）——与 rc.1→rc.2 完全同样；`git apply --3way` 重放 **10 处全部干净应用**（3 处重叠由三方合并自动吸收，零手工重贴、无冲突标记），`pnpm-lock.yaml` 由 `pnpm install` 重新生成。**命脉接缝零改动**：`client/web/src/boot.ts` · `client/connection/src` · `api/gateway/src` · `host/webserver/src` · `bundle/web-app/src` · `apps/cli/src` · `apps/desktop/src/preload-windows.ts` → 就绪行格式、`--no-open/--port/--patch/--ipc-pipe` 旗标族、管道传输契约不受影响。换树同时清掉 327 个 `lib/` 产物目录 + 2 个 `*.tsbuildinfo` + `.dsh-build/` + `apps/web/dist/`（均被 `dsh/.gitignore` 忽略），避免 rc.2 陈旧产物与已删包残留。

- **本轮上游对照新增（不改我方条目，仅登记事实）**：① `util/native-command` 给 `runNativeCommand` 加第四参 `window: 'hidden' | 'visible'`，`explorer.exe` 走 `'visible'` —— 原生修掉了「SW_HIDE 连带隐藏 Explorer 文件夹窗口」，与我方壳侧 `try_open_explorer_from_shell` 拦截同一症状（去留见 F2 §四步骤 10）；② `sandbox/sandbox-windows-acl` 新增 Agent 向技能 `diagnose-windows-sandbox-acl`（PS1 + SkillProvider，限定目录内、带备份可回滚、失败即停），与我方 C4 的壳 UI 面（探针/横幅/一键 `icacls`）不同面、不冲突；③ `client/ui-layout/AppFrame.module.css` 为 `html[data-windows-titlebar]` 正式声明 `--dsh-frame-top-clearance: var(--dsh-windows-titlebar-height)` 并新增 `--dsh-frame-overlay-top`（clearance+20px）/`--dsh-frame-chrome-top` 与 fullscreen 分支，`ui-primitives/overlay-top-margin.ts` 随之改为 clearance+20 → 我方 C6 的 32px 壳级窗口栏被上游当一等公民，浮层顶部内缩变 **52px**；④ `time-context`/`schedule`/`ui-schedule` 三行移出 web-app bundle，改由新包 `experimental/schedule-bundle` 提供并进 `OPTIONAL_BUNDLES`（默认关；rc.2 时它们本就 `disabled: true`，我方从未开启）。

- **追版重放（2026-09-24，rc.1 → rc.2）**：我方 11 处改动的冲突面只有 3 处（`bundle/web-app/cordis.patch.yml` · `bundle/web-app/package.json` · `pnpm-lock.yaml`）；实际重放用 `git apply --3way`，**11 处全部干净应用**（无需手工重贴）。`pnpm-lock.yaml` 由 `pnpm install` 重新生成。同次干净换树还移除了 B1 从本地 WIP 副本带入、且 rc.2 中不存在的 37 个文件（含 34 个 `.claude/skills/*`——上游以 symlink 跟踪该目录，技能本体在 `.agents/skills/`）。

## 二、门禁

```sh
node scripts/check-dsh-fork-ledger.mjs        # 或 pnpm fork:check
```

判据：`git diff <基线提交> -- dsh` 的每个文件**都必须出现在下方台账**；台账里有、实际无差异 → 警告（条目过期，需清理）。

**每处改动登记必须写清「上游对照」**（上游同一位置现在是什么 / 是否已有等价实现），这是将来择优摘取上游修复的索引。

## 三、台账（我方对 `dsh/` 的改动）

> 格式：`文件路径 | 状态 | 摘要与理由 | 上游对照`。

```text
dsh/packages/host/webserver/src/index.ts | 改 | C2-a：外部载体模式——`external` 配置（不 bind；`port` 降为声明 authority）+ 抽出 `serve`/`route` 并新增公共 `dispatch` 接缝（供非 TCP 载体喂合成请求）。**G1 增补**：新增只读 `listPrefixRoutes()`——导出前缀路由表键，供壳侧路径闸门按宿主真实路由判定（取代壳内手工记账的插件前缀常量）。**G5 增补**：新增只读 lastActivity() + WebRouteActivity——oute() 在**调 handler 之前**记下命中路由（path / kind / method / url / 自增序号）。动机：插件路由抛异常时调用点已消失，崩溃处理器需要能指名插件命名空间的线索；只读、不改转发语义。**G6 增补**：`register()` 在注册时用 `this.ctx.fiber.name` 记下**注册方插件名**（`WebRouteEntry` 包一层，表值由 `WebRoute` 改为 `WebRouteEntry`），`WebRouteActivity` 增可选 `plugin`；名字取自 cordis 的 shadow 重绑定（方法体内 `this.ctx` 解析为调用方），根 fiber 注册时 `plugin` 整字段省略以免误报「可禁停的插件」。动机：路径前缀 ≠ 包名（如 `/wallpaper-engine` vs `wallpaper-engine`），只给 path 时壳只能猜。**G7 增补**：新增 `recentActivity()` + 导出 `ACTIVITY_HISTORY = 5`——`route()` 除单点 `activity` 外还维护一个环形缓冲（旧→新，满即 shift）。动机：单点只回答「死的那一刻谁在服务」，而那可能是无关的过路请求；环让读方看出「是否某插件密集刷同一路由」 | 上游无外部载体概念：`[Service.init]` 必经 `listen`；worker 预览靠「假 node:http 捕获请求监听器」旁路，无此公共接缝。上游亦无路由表只读访问器（`prefixes` 恒为 `private`），更无「路由归属」概念
dsh/packages/bundle/web-app/src/pipe-transport.ts | 新 | C2-a：IPC 管道载体——帧编解码（`u32be 长度 + kind`，J/B 两类；B 帧背 `u32be id`）+ 合成请求/响应对（req 以真 Readable 为基座）+ 流 lane（直连 `gateway.wireStream.open`，无 WebSocket）。**G1 增补**：`PipeCarrierOptions.routePrefixes` 为**函数**（非数组）——每条连接 `start()` 时求值，壳重连即拿到当下路由表；`HelloFrame.routePrefixes?` 可选，未提供时**整字段省略**（空数组会被读成「表为空」）。**G2 增补**：新增可选 `openSseStream` + 导出 `readSseResponse`——流 lane 的 `stream-open` 端点以 `sse:` 前缀分流到该读取器（合成 req/res 走 `dispatch`，按 `\n\n` 拆帧、只取 `data:` 行）；无该前缀时仍走 `gateway.wireStream.open`。动机：壳自定义协议应答是缓冲体，SSE 无法经 `dispatch` 到达页面 | 上游无；worker 隧道（experimental）是同构形态但走 postMessage 且在实验包内，不可跨组依赖。上游无该字段与 SSE 读取器
dsh/packages/bundle/web-app/src/index.ts | 改 | C2-a：web-app 组合增 `ipcPipe` 配置 + `installPipeMode`（注入 typertGateway、装载体、接 `webserver.dispatch`；失败经树日志不抛）。**G1 增补**：`installPipeCarrier` 传入 `routePrefixes: () => ctx.webServer.listPrefixRoutes()`。**G2 增补**：传 `openSseStream: (path, signal) => readSseResponse(path, dispatch, signal)` | 上游无该配置与装配
dsh/packages/bundle/web-app/src/startup.ts | 改 | C2-a：CLI 增 `--ipc-pipe <path>`（同族 flag；空值判用法错误；`--port` 帮助文案补「声明 authority」语义） | 上游 flag 族仅 `--host/--port/--trusted-host/--no-open`
dsh/packages/bundle/web-app/cordis.patch.yml | 改 | C2-a：webserver 行 `external: !!js ctx.webStartup.ipcPipe !== undefined`；web-runtime 行传 `ipcPipe: !!js ctx.webStartup.ipcPipe` | 上游两行无 `external`/`ipcPipe` 键
dsh/packages/bundle/web-app/package.json | 改 | C2-a：增依赖 `@deepseek-ai/dsh-api-gateway`（读 `typertGateway` 的 Context 增强与 `wireStream` 类型） | 上游无此依赖边（web-app 原先只挂网关的客户端行）
dsh/packages/bundle/web-app/tsconfig.json | 改 | C2-a：增项目引用 `../../api/gateway/tsconfig.host.json`（新依赖边所需；同 worker 运行时的做法） | 上游无
dsh/pnpm-lock.yaml | 改 | C2-a：上述 workspace 依赖的锁文件条目——**只有 3 行**（web-app importer 内按字母序插入 `'@deepseek-ai/dsh-api-gateway': specifier: workspace:* / version: link:../../api/gateway`）。**追版纪律（F2 实测）**：换树后一律「还原上游原版锁 → 手插这 3 行 → `pnpm install --frozen-lockfile`」，**绝不让 pnpm 全量重解析**——我方那条依赖边会让上游原版锁「与 package.json 不同步」，触发 pnpm 以默认 `resolution-mode=highest` 重解析全图，把 `ui-primitives` 的 caret 范围升到最新（micromark 家族 2.0.3→2.0.4 / 2.0.1→2.1.0 / 2.0.2→2.0.3）而传递依赖仍锁旧版 → **同一包两个版本并存 → `tsc` TS2769 构建失败**。另一坑：锁文件改回原版后 `pnpm install`（含 `--force`）会短路成 `Already up to date`（1.6s）而不重链，须把 `dsh/node_modules` 移走后全新安装。**F3 复核（rc.2，2026-09-29）**：同一做法再次生效——上游原版锁手插这 3 行后 `pnpm install --frozen-lockfile` **21.8s 通过**（1685 条过供应链策略、实际 resolve/reused/downloaded，未短路、未全量重解析）；插入位置仍是 web-app importer 块内 `dsh-api-account-controller` 与 `dsh-api-job-controller` 之间（字母序）。**注意**：`@deepseek-ai/dsh-api-gateway` 作为依赖名在上游锁里另有 15 处（别的 importer 的 dependencies/devDependencies）——判「我方条目是否已在位」**只能看 web-app importer 块内**（rc.2 的 web-app 块 = 2364–2787 行），扫全文件会误判 | 上游原版锁无此条目（`link:` 条目不参与版本解析，故手插安全）
dsh/packages/host/webserver/tests/webserver-external.spec.ts | 新 | C2-a：外部模式用例——不 bind + 声明端口可被他人绑定 + `dispatch` 服务注册路由/回退座/400 错误包含 + 未 bind 下 dispose 不挂 | 上游无
dsh/packages/bundle/web-app/tests/pipe-transport.spec.ts | 新 | C2-a：管道载体用例 11 条（hello / 一元 GET+POST 体 / 流式响应 head+chunk+end / res-err / 流 item+uplink+end / 失败映射 / abort / 四类协议违规 fail-closed）；客户端侧为独立实现以免同源套套逻辑 | 上游无
dsh/packages/bundle/web-app/tests/pipe-sse.spec.ts | 新 | G2：SSE 流 lane 用例 6 条（跨块拆帧拼接 / 注释与 event 行被忽略 / 无 data 路由产出零帧 / `sse:` 前缀分流到 SSE 读取器 / 未装 `openSseStream` 时流错误且原因点名 / 长连只 write 不 end 时 abort 收尾并触发路由 close）；同样走真实管道 + 独立客户端编解码 | 上游无
dsh/packages/bundle/web-app/tests/pipe-response-contract.spec.ts | 新 | G4：合成响应的 pipe 目的地契约用例 2 条（路由把真 Readable pipe 进 res 后请求以 res-end 正常收尾且 body 完整 / 连续两次请求都不崩、pipe 的 close 与 finish 监听不泄漏）；真实管道 + 真 `Readable.pipe`，覆盖「插件 `stream.pipe(res)` 触发 `dest.removeListener is not a function` 使宿主崩溃」的回归 | 上游无
dsh/packages/credentials/deepseek-account/src/index.ts | 改 | H2（退出登录挂死修复）：`attempt.done` 收尾处的 `await streamPromises.finished(attempt.callback)` 改**有界等待**（`CALLBACK_DRAIN_TIMEOUT_MS = 5_000`，定时器随 race 结束即 abort 释放）。动机：该 await 原意只是「拆路由前让浏览器收完响应」，但壳的回调经**管道合成响应**送达（非真 socket），`eos` 既不对它报完成也不报错 → `attempt.done` 永不结算 → 用户 `signOut` 因 `await cancelSignIn` 永久挂住（真机实测：`phase='succeeded'` 时 30s+ 无响应，`attempt` 为空时 98ms 成功；修复后同一场景 94ms）。有界等待把「载体不报完成」退化成多等 5s 而非卡死，真 socket 载体不受影响。**注**：曾尝试在壳侧把合成响应做成真 Writable 从根上满足 `eos`，但那要动 C2 的 pipe 契约与 20 条既有用例，风险大于收益，已放弃并还原 | **上游 0.2.2-rc.1 起把 `deepseek-account-platform` 重构为 `deepseek-account`**（删抽象基类、拆 account-tasks/client-metadata/details/logout/notifications/protocol/types 多文件）；本改动随迁至新包 `index.ts` 的同名 `finished()` 调用点（代码逐字相同）。上游仍隐含「回调由真 socket 承载、响应可感知结束」，无「载体不报完成」的分支
```

> **曾登记已撤（2026-10-07）**：`client/ui-commands` 的 `commandUi.face()` 挂载点（contract / service / 测试 3 文件）曾为 `/entity` 指令行样式引入并登记——**同日改判纯插件形态后整体撤出**（客户端贡献位 `commandUi.register` 原生支持图标/中文名/短提示呈现，呈现面无需动 dsh；行为链路改走壳 IPC，见 console 插件 README）。上游对照结论留档：上游非内建指令行固定渲染「注册名 + catalog 描述」（`builtinRowFace` 仅覆盖 6 个写死 definitionId），无第三方呈现面机制；若将来 WorldSea 需要「宿主指令 + 客户端呈现」，此撤撤销记录即是现成设计稿。

## 四、纪律（D10）

1. **收敛**：改动优先落在少量「接缝」文件（例如 `packages/client/connection`、`packages/host/webserver`、`packages/bundle/web-app`、`packages/boot/app-boot`），避免大面积铺开。
2. **登记即提交**：改动的**同一提交**内更新本台账；未登记即被门禁拦下。
3. **保留 dsh 自带门禁**：改了 dsh 源码后，它自带的 typecheck / lint / test / keyless 快照回放是我们最便宜的回归网（跑法与策略见 `dsh/AGENTS.md`、`dsh/docs/testing.md`）；不得以「反正是 fork」为由跳过。
4. **摘取上游**：上游修复按「先 diff 本台账 → 定位冲突面 → 单独立批引入」处理；台账的「上游对照」列即索引。
5. **追版选靶规则（2026-11-04 用户拍板）**：上游 tag 的**必追点**是两个——① **新 RC 线的首个版本**（如 `0.2.2-rc.1`：新 minor 的 RC 起点，承载该线的全部破坏性变更）；② **RC 线的末尾版本**（界定 = **下一个 minor 的首个 alpha 发布之前**的最后一个 RC，如 `0.2.1-rc.5`：该 minor 稳定线的收尾，与上游桌面版通常同代）。**中间 RC 不单独追**（同一发布线的连续收尾，合并成本几乎相同，取终版一次到位更省）。**例外**：若新 alpha 已发布、而旧 RC 线**仍在补发新版本**，则该线是否再追需按「冲突面大小 + 该版本内容是否有我方需要的修复」逐次判断，不机械执行。判据实例：F5 取 `0.2.1-rc.2`（当时最新 RC，尚无 alpha 线）、F6 取 `0.2.1-rc.5`（alpha 线已出但 rc 线仍在补，按例外判断后取末版）、F7 取 `0.2.2-rc.1`（新 RC 线首版）。
6. **不改基线**：本文件的「基线提交」只在追版（换树）时更新，并同步 [运行手册](dsh-运行手册.md) 的追版记录。
