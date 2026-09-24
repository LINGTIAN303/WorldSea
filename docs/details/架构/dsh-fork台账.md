# dsh fork 台账

> **status: 现行**（2026-09-24 建立，D10 口径改判的配套）｜ 用途：`dsh/` 已是**我方 fork**（不再「只读地基」）——本台账登记**我方对 `dsh/` 的每一处改动**，使 ① 任何未登记的改动被门禁拦下；② 将来若要从上游摘取修复，能一眼看出冲突面。
> 口径改判见 [准备方案](../../plans/2026-09-23-dsh接管Agent面-大重构准备.md) §一 D10 / §五；运行口径见 [dsh 运行手册](dsh-运行手册.md)。

## 一、基线

基线提交：`cde62e7`

对应上游：tag `dsh-v0.1.7-rc.2`（上游提交 `477b4f420553e8a52c2fbccc464d7561b239c443` 的干净树；换树记录见该提交信息）。
**前次基线**：`25a4fc8`（tag `dsh-v0.1.7-rc.1`，上游 `46a7f68b…`）——追版记录见 [运行手册](dsh-运行手册.md) 与 [F1 批计划](../../plans/2026-09-24-F1-追版rc2批计划.md)。

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
dsh/pnpm-lock.yaml | 改 | C2-a：上述 workspace 依赖的锁文件更新（+1 包，离线复用） | —
dsh/packages/host/webserver/tests/webserver.spec.ts | 改 | C2-a：配置解析断言补 `external: false` 默认项（既有用例精确比对 Config 结果） | 上游无该默认项
dsh/packages/host/webserver/tests/webserver-external.spec.ts | 新 | C2-a：外部模式用例——不 bind + 声明端口可被他人绑定 + `dispatch` 服务注册路由/回退座/400 错误包含 + 未 bind 下 dispose 不挂 | 上游无
dsh/packages/bundle/web-app/tests/pipe-transport.spec.ts | 新 | C2-a：管道载体用例 11 条（hello / 一元 GET+POST 体 / 流式响应 head+chunk+end / res-err / 流 item+uplink+end / 失败映射 / abort / 四类协议违规 fail-closed）；客户端侧为独立实现以免同源套套逻辑 | 上游无
```

## 四、纪律（D10）

1. **收敛**：改动优先落在少量「接缝」文件（例如 `packages/client/connection`、`packages/host/webserver`、`packages/bundle/web-app`、`packages/boot/app-boot`），避免大面积铺开。
2. **登记即提交**：改动的**同一提交**内更新本台账；未登记即被门禁拦下。
3. **保留 dsh 自带门禁**：改了 dsh 源码后，它自带的 typecheck / lint / test / keyless 快照回放是我们最便宜的回归网（跑法与策略见 `dsh/AGENTS.md`、`dsh/docs/testing.md`）；不得以「反正是 fork」为由跳过。
4. **摘取上游**：上游修复按「先 diff 本台账 → 定位冲突面 → 单独立批引入」处理；台账的「上游对照」列即索引。
5. **不改基线**：本文件的「基线提交」只在追版（换树）时更新，并同步 [运行手册](dsh-运行手册.md) 的追版记录。
