# dsh fork 台账

> **status: 现行**（2026-09-24 建立，D10 口径改判的配套）｜ 用途：`dsh/` 已是**我方 fork**（不再「只读地基」）——本台账登记**我方对 `dsh/` 的每一处改动**，使 ① 任何未登记的改动被门禁拦下；② 将来若要从上游摘取修复，能一眼看出冲突面。
> 口径改判见 [准备方案](../../plans/2026-09-23-dsh接管Agent面-大重构准备.md) §一 D10 / §五；运行口径见 [dsh 运行手册](dsh-运行手册.md)。

## 一、基线

基线提交：`962c6f6`

对应上游：tag `dsh-v0.2.1-rc.2`（上游提交 `687f282e8625c6b8d11ff58211a90524be2e4317` 的干净树；换树记录见该提交信息）。
**前次基线**：`096a48c`（tag `dsh-v0.2.0-rc.2`，上游 `639ed015…`）——追版记录见 [F5 批计划](../../plans/2026-10-17-F5-追版dsh-0.2.1-rc.2批计划.md)。
**更早基线**：`0c6f8b2`（tag `dsh-v0.2.0-rc.1`，上游 `4878cdab…`）——追版记录见 [F2 批计划](../../plans/已完成/2026-09-29-F2-追版0.2.0-rc.1批计划.md)；`cde62e7`（tag `dsh-v0.1.7-rc.2`，上游 `477b4f42…`）——见 [F1 批计划](../../plans/已完成/2026-09-24-F1-追版rc2批计划.md)。

**追版重放（2026-10-18，0.2.0-rc.2 → 0.2.1-rc.2）**：上游 delta **9,058 路径**（改 4,399 / 增 3,426 / 删 1,233），39 个命脉接缝被改，我方 11 处改动 **8 处重叠**。`git apply --3way` **4 文件 / 19 处冲突**：`bundle/web-app/src/startup.ts`（6，新增 `--public-url`/TLS 旗标族与 `--ipc-pipe` 合并）、`bundle/web-app/src/index.ts`（5，上游 `WebApp`/`publicUrl`/就绪行新结构与 pipe carrier 合并）、`host/webserver/src/index.ts`（5，上游 TLS/地址谓词重构与 `external`/`dispatch` 合并，保留 unbound dispose 保护）、`bundle/web-app/cordis.patch.yml`（3，`tls`+`external` 双键、`publicUrl`+`ipcPipe`，删除上游已移除的 `harness-dev-context`）。`package.json` / `tsconfig.json` / `webserver.spec.ts` 自动合并干净；3 个新增文件无冲突。**非冲突适配**：`TypertGatewayWireStream.open` 的 `peer` 变必填 → 管道改用 `connection.browserPeer`；`trustedHosts` 迁到连接层直接读 `webStartup`（web-app Config 删除该项）；`webServer.port` getter 返回声明端口兜底。锁文件按既有纪律重放。

**追版重放（2026-09-29 同日，0.2.0-rc.1 → 0.2.0-rc.2）**：上游 delta **1012 路径**（918 内容改 + 89 增 + 5 删）。**取树走 codeload tarball**——GitHub 的 git 链路本轮不通（`schannel` 握手失败），改用 `curl` 取 tarball；两棵树用同一方法物化后 `diff -rq` 量冲突面（`.gitattributes` 无 `export-ignore`，故 `git archive` 与 tarball 的文件集一致，比较可信）。**我方 11 处改动的冲突面只剩 2 处**：`bundle/web-app/package.json`（上游改动**只是版本号** `0.2.0-rc.1 → 0.2.0-rc.2`）与 `pnpm-lock.yaml`（按硬纪律重放）。`git apply --3way` **10 处全部干净应用**（其中 3 处走直接应用；零冲突标记；`package.json` 的三方合并把「上游版本号」与「我方依赖边」正确组合）。**命脉接缝只有两处被上游动过、且都是加性**：`apps/cli/src/{args,bin,plugin}.ts`（新 `RunCliOptions` / `parseDshArgs` 增第三参 / `plugin` 子命令放宽 desktop profile 管理——围绕 rc.2 新增的「桌面端经菜单栏管理 dsh 命令」；**不碰 `--patch` / `--ipc-pipe`**，两者在未动的 `web-app/src/startup.ts`）与 `api/gateway/src/{index,types}.ts`（新增 `hasLiveClient()` 与 `RemoteEventClient.signal`——加性，消费者不受影响）。**就绪行所在 `bundle/web-app/src/index.ts`**，以及 `host/webserver/src` · `bundle/web-app/src` · `client/web/src/boot.ts` · `client/connection/src` · `apps/desktop/src/preload-windows.ts` **全未动**；我方 overlay 两条目标 id 所在 `bundle/web-app/cordis.patch.yml` 未动。换树同时清掉 330 个 `lib/` 产物目录 + 356 个 `*.tsbuildinfo` + `.dsh-build/` + `apps/web/dist/` + 空壳的陈旧 `examples/`（均被 `dsh/.gitignore` 忽略）。详见 [F3 批计划](../../plans/已完成/2026-09-29-F3-追版0.2.0-rc.2批计划.md)。

**追版重放（2026-09-29，0.1.7-rc.2 → 0.2.0-rc.1）**：上游 delta **1,109 文件 / +20,374 −77,795**（树 13,850 → 14,004 文件）。我方 11 处改动的冲突面仍只有 **3 处**（`bundle/web-app/cordis.patch.yml` · `bundle/web-app/package.json` · `pnpm-lock.yaml`）——与 rc.1→rc.2 完全同样；`git apply --3way` 重放 **10 处全部干净应用**（3 处重叠由三方合并自动吸收，零手工重贴、无冲突标记），`pnpm-lock.yaml` 由 `pnpm install` 重新生成。**命脉接缝零改动**：`client/web/src/boot.ts` · `client/connection/src` · `api/gateway/src` · `host/webserver/src` · `bundle/web-app/src` · `apps/cli/src` · `apps/desktop/src/preload-windows.ts` → 就绪行格式、`--no-open/--port/--patch/--ipc-pipe` 旗标族、管道传输契约不受影响。换树同时清掉 327 个 `lib/` 产物目录 + 2 个 `*.tsbuildinfo` + `.dsh-build/` + `apps/web/dist/`（均被 `dsh/.gitignore` 忽略），避免 rc.2 陈旧产物与已删包残留。

**本轮上游对照新增（不改我方条目，仅登记事实）**：① `util/native-command` 给 `runNativeCommand` 加第四参 `window: 'hidden' | 'visible'`，`explorer.exe` 走 `'visible'` —— 原生修掉了「SW_HIDE 连带隐藏 Explorer 文件夹窗口」，与我方壳侧 `try_open_explorer_from_shell` 拦截同一症状（去留见 F2 §四步骤 10）；② `sandbox/sandbox-windows-acl` 新增 Agent 向技能 `diagnose-windows-sandbox-acl`（PS1 + SkillProvider，限定目录内、带备份可回滚、失败即停），与我方 C4 的壳 UI 面（探针/横幅/一键 `icacls`）不同面、不冲突；③ `client/ui-layout/AppFrame.module.css` 为 `html[data-windows-titlebar]` 正式声明 `--dsh-frame-top-clearance: var(--dsh-windows-titlebar-height)` 并新增 `--dsh-frame-overlay-top`（clearance+20px）/`--dsh-frame-chrome-top` 与 fullscreen 分支，`ui-primitives/overlay-top-margin.ts` 随之改为 clearance+20 → 我方 C6 的 32px 壳级窗口栏被上游当一等公民，浮层顶部内缩变 **52px**；④ `time-context`/`schedule`/`ui-schedule` 三行移出 web-app bundle，改由新包 `experimental/schedule-bundle` 提供并进 `OPTIONAL_BUNDLES`（默认关；rc.2 时它们本就 `disabled: true`，我方从未开启）。

**追版重放（2026-09-24，rc.1 → rc.2）**：我方 11 处改动的冲突面只有 3 处（`bundle/web-app/cordis.patch.yml` · `bundle/web-app/package.json` · `pnpm-lock.yaml`）；实际重放用 `git apply --3way`，**11 处全部干净应用**（无需手工重贴）。`pnpm-lock.yaml` 由 `pnpm install` 重新生成。同次干净换树还移除了 B1 从本地 WIP 副本带入、且 rc.2 中不存在的 37 个文件（含 34 个 `.claude/skills/*`——上游以 symlink 跟踪该目录，技能本体在 `.agents/skills/`）。

## 二、门禁

```sh
node scripts/check-dsh-fork-ledger.mjs        # 或 pnpm fork:check
```

判据：`git diff <基线提交> -- dsh` 的每个文件**都必须出现在下方台账**；台账里有、实际无差异 → 警告（条目过期，需清理）。

**每处改动登记必须写清「上游对照」**（上游同一位置现在是什么 / 是否已有等价实现），这是将来择优摘取上游修复的索引。

## 三、台账（我方对 `dsh/` 的改动）

> 格式：`文件路径 | 状态 | 摘要与理由 | 上游对照`。

```text
dsh/packages/host/webserver/src/index.ts | 改 | C2-a：外部载体模式——`external` 配置（不 bind；`port` 降为声明 authority）+ 抽出 `serve`/`route` 并新增公共 `dispatch` 接缝（供非 TCP 载体喂合成请求） | 上游无外部载体概念：`[Service.init]` 必经 `listen`；worker 预览靠「假 node:http 捕获请求监听器」旁路，无此公共接缝
dsh/packages/bundle/web-app/src/pipe-transport.ts | 新 | C2-a：IPC 管道载体——帧编解码（`u32be 长度 + kind`，J/B 两类；B 帧背 `u32be id`）+ 合成请求/响应对（req 以真 Readable 为基座）+ 流 lane（直连 `gateway.wireStream.open`，无 WebSocket） | 上游无；worker 隧道（experimental）是同构形态但走 postMessage 且在实验包内，不可跨组依赖
dsh/packages/bundle/web-app/src/index.ts | 改 | C2-a：web-app 组合增 `ipcPipe` 配置 + `installPipeMode`（注入 typertGateway、装载体、接 `webserver.dispatch`；失败经树日志不抛） | 上游无该配置与装配
dsh/packages/bundle/web-app/src/startup.ts | 改 | C2-a：CLI 增 `--ipc-pipe <path>`（同族 flag；空值判用法错误；`--port` 帮助文案补「声明 authority」语义） | 上游 flag 族仅 `--host/--port/--trusted-host/--no-open`
dsh/packages/bundle/web-app/cordis.patch.yml | 改 | C2-a：webserver 行 `external: !!js ctx.webStartup.ipcPipe !== undefined`；web-runtime 行传 `ipcPipe: !!js ctx.webStartup.ipcPipe` | 上游两行无 `external`/`ipcPipe` 键
dsh/packages/bundle/web-app/package.json | 改 | C2-a：增依赖 `@deepseek-ai/dsh-api-gateway`（读 `typertGateway` 的 Context 增强与 `wireStream` 类型） | 上游无此依赖边（web-app 原先只挂网关的客户端行）
dsh/packages/bundle/web-app/tsconfig.json | 改 | C2-a：增项目引用 `../../api/gateway/tsconfig.host.json`（新依赖边所需；同 worker 运行时的做法） | 上游无
dsh/pnpm-lock.yaml | 改 | C2-a：上述 workspace 依赖的锁文件条目——**只有 3 行**（web-app importer 内按字母序插入 `'@deepseek-ai/dsh-api-gateway': specifier: workspace:* / version: link:../../api/gateway`）。**追版纪律（F2 实测）**：换树后一律「还原上游原版锁 → 手插这 3 行 → `pnpm install --frozen-lockfile`」，**绝不让 pnpm 全量重解析**——我方那条依赖边会让上游原版锁「与 package.json 不同步」，触发 pnpm 以默认 `resolution-mode=highest` 重解析全图，把 `ui-primitives` 的 caret 范围升到最新（micromark 家族 2.0.3→2.0.4 / 2.0.1→2.1.0 / 2.0.2→2.0.3）而传递依赖仍锁旧版 → **同一包两个版本并存 → `tsc` TS2769 构建失败**。另一坑：锁文件改回原版后 `pnpm install`（含 `--force`）会短路成 `Already up to date`（1.6s）而不重链，须把 `dsh/node_modules` 移走后全新安装。**F3 复核（rc.2，2026-09-29）**：同一做法再次生效——上游原版锁手插这 3 行后 `pnpm install --frozen-lockfile` **21.8s 通过**（1685 条过供应链策略、实际 resolve/reused/downloaded，未短路、未全量重解析）；插入位置仍是 web-app importer 块内 `dsh-api-account-controller` 与 `dsh-api-job-controller` 之间（字母序）。**注意**：`@deepseek-ai/dsh-api-gateway` 作为依赖名在上游锁里另有 15 处（别的 importer 的 dependencies/devDependencies）——判「我方条目是否已在位」**只能看 web-app importer 块内**（rc.2 的 web-app 块 = 2364–2787 行），扫全文件会误判 | 上游原版锁无此条目（`link:` 条目不参与版本解析，故手插安全）
dsh/packages/host/webserver/tests/webserver.spec.ts | 改 | C2-a：配置解析断言补 `external: false` 默认项（既有用例精确比对 Config 结果） | 上游无该默认项
dsh/packages/host/webserver/tests/webserver-external.spec.ts | 新 | C2-a：外部模式用例——不 bind + 声明端口可被他人绑定 + `dispatch` 服务注册路由/回退座/400 错误包含 + 未 bind 下 dispose 不挂 | 上游无
dsh/packages/bundle/web-app/tests/pipe-transport.spec.ts | 新 | C2-a：管道载体用例 11 条（hello / 一元 GET+POST 体 / 流式响应 head+chunk+end / res-err / 流 item+uplink+end / 失败映射 / abort / 四类协议违规 fail-closed）；客户端侧为独立实现以免同源套套逻辑 | 上游无
```

> **曾登记已撤（2026-10-07）**：`client/ui-commands` 的 `commandUi.face()` 挂载点（contract / service / 测试 3 文件）曾为 `/entity` 指令行样式引入并登记——**同日改判纯插件形态后整体撤出**（客户端贡献位 `commandUi.register` 原生支持图标/中文名/短提示呈现，呈现面无需动 dsh；行为链路改走壳 IPC，见 console 插件 README）。上游对照结论留档：上游非内建指令行固定渲染「注册名 + catalog 描述」（`builtinRowFace` 仅覆盖 6 个写死 definitionId），无第三方呈现面机制；若将来 WorldSea 需要「宿主指令 + 客户端呈现」，此撤撤销记录即是现成设计稿。

## 四、纪律（D10）

1. **收敛**：改动优先落在少量「接缝」文件（例如 `packages/client/connection`、`packages/host/webserver`、`packages/bundle/web-app`、`packages/boot/app-boot`），避免大面积铺开。
2. **登记即提交**：改动的**同一提交**内更新本台账；未登记即被门禁拦下。
3. **保留 dsh 自带门禁**：改了 dsh 源码后，它自带的 typecheck / lint / test / keyless 快照回放是我们最便宜的回归网（跑法与策略见 `dsh/AGENTS.md`、`dsh/docs/testing.md`）；不得以「反正是 fork」为由跳过。
4. **摘取上游**：上游修复按「先 diff 本台账 → 定位冲突面 → 单独立批引入」处理；台账的「上游对照」列即索引。
5. **不改基线**：本文件的「基线提交」只在追版（换树）时更新，并同步 [运行手册](dsh-运行手册.md) 的追版记录。
