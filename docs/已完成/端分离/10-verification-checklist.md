# 10 - 验证清单

> 端分离全流程的可执行验证清单。每个 Phase 完成后逐项检查，全部通过方可进入下一阶段。

> **2026-08-02 状态说明**：
> - Phase 1/2/4/5 已完成（目录结构、包名、依赖链接、构建独立性等结构性项已确认 ✅；curl/dev 启动/产物隔离等运行时项未逐一实测）
> - Phase 3 部分完成（P3-T1~T9 已完成；P3-T10 业务 UI 迁移暂停）
> - Phase 6 暂停（2026-07-31 决策，按 ROADMAP 排期）
> - 具体完成情况以 【`[08-migration-phases.md](./08-migration-phases.md)`】 为准

## 1. 使用说明

- 清单项前的 `[ ]` 在验证通过后改为 `[x]`
- 每项验证需记录：验证人、验证时间、验证结果（通过/失败/不适用）
- 失败项需记录原因与修复计划
- **任何 P0 项失败，不得进入下一 Phase**

## 2. Phase 1 验证：共享代码层抽离

### 2.1 包结构验证

- [ ] `packages/agent-runtime/package.json` 存在，name 为 `@worldsmith/agent-runtime`
- [ ] `packages/agent-runtime/tsconfig.json` 可独立 `tsc --noEmit` 通过
- [ ] `packages/agent-runtime/src/index.ts` 导出完整公共 API
- [ ] `pnpm-workspace.yaml` 包含 `packages/*`

### 2.2 接口与实现验证

- [ ] `IAgentBackend` 接口定义存在，包含 `prompt()`、`subscribe()`、`abort()` 方法
- [ ] `ExecutionAdapter` 接口已迁移到 `packages/agent-runtime/src/execution/adapter.ts`
- [ ] `registerExecutionAdapterFactory` 函数存在，可注册端适配器
- [ ] Agent 核心逻辑（agent.ts、tools、skills、session、orchestrator）已迁移
- [ ] 迁移后无循环依赖（`npx madge --circular packages/agent-runtime/src/` 无输出）

### 2.3 功能不退化验证

- [ ] `worldsmith-agent` 依赖 `@worldsmith/agent-runtime`，`pnpm install` 无报错
- [ ] `worldsmith chat` 命令可正常启动对话（P0）
- [ ] `worldsmith serve` 命令可正常启动服务（P0）
- [ ] CLI 工具执行（shell、git、file）功能正常（P0）
- [ ] 单元测试全部通过（`pnpm test`）

### 2.4 代码质量验证

- [ ] `packages/agent-runtime` 无 `@tauri-apps/api` 依赖
- [ ] `packages/agent-runtime` 无 `ws`、`child_process` 等 Node/Tauri 专属依赖
- [ ] 导出 API 有 JSDoc 注释

## 3. Phase 2 验证：三端目录骨架建立

### 3.1 目录结构验证

- [ ] `apps/web/` 目录存在，包含 package.json、vite.config.ts、tsconfig.json、index.html
- [ ] `apps/cli/` 目录存在，包含 package.json、tsconfig.json、bin/cli.mjs
- [ ] `apps/tauri/` 目录存在，包含 package.json、tauri.conf.json、vite.config.ts
- [ ] `pnpm-workspace.yaml` 包含 `apps/*`

### 3.2 包名验证

- [ ] `apps/web/package.json` name 为 `@worldsmith/web`
- [ ] `apps/cli/package.json` name 为 `@worldsmith/cli`
- [ ] `apps/tauri/package.json` name 为 `@worldsmith/tauri`

### 3.3 独立启动验证

- [ ] `pnpm --filter @worldsmith/web dev` 可启动 Vite，浏览器可见空白页（P0）
- [ ] `pnpm --filter @worldsmith/cli start --help` 可输出帮助信息（P0）
- [ ] `pnpm --filter @worldsmith/tauri dev` 可启动 Tauri 窗口（P0）

### 3.4 依赖链接验证

- [ ] 三端均可 `import { ... } from '@worldsmith/agent-runtime'` 无报错
- [ ] 三端均可 `import { ... } from '@worldsmith/shared-composables'` 无报错
- [ ] 三端均可 `import { ... } from '@worldsmith/shared-ui'` 无报错

### 3.5 原 src/ 完整性验证

- [ ] 原 `src/` 目录未修改，主分支 `pnpm dev` 仍可正常启动（P0）

## 4. Phase 3 验证：前端入口分离与清理

### 4.1 文件迁移验证

- [ ] 8 个 Rust composables 已迁移到 `apps/tauri/src/agent/composables/`
- [ ] `ProjectFS.ts` 已迁移到 `apps/tauri/src/core/`
- [ ) `useFsWatcher.ts` 已迁移到 `apps/tauri/src/composables/`
- [ ] `TauriFsOperations.ts` 已迁移到 `apps/tauri/src/memory-archive/`
- [ ] mindmap Rust composables（2 个）已迁移到 `apps/tauri/src/plugins/mindmap/`
- [ ] workflow Rust 文件（2 个）已迁移到 `apps/tauri/src/plugins/workflow/`
- [ ] `coreBackend.ts` WASM 版已迁移到 `apps/web/src/core/`
- [ ] `worldsmithCore.ts` 已迁移到 `apps/web/src/core/`
- [ ] `wasmWorkerPool.ts` 已迁移到 `apps/web/src/core/`
- [ ] 共享 composables（18 个）已迁移到 `packages/shared-composables/src/`

### 4.2 后端切换逻辑清理验证

- [ ] `grep -r "detectBackend" apps/` 返回空（P0）
- [ ] `grep -r "getBackendType" apps/` 仅出现在各端 `main.ts` 中（P0）
- [ ] `apps/web/src/core/coreBackend.ts` 中 `getBackendType()` 返回 `'wasm'`（硬编码）
- [ ] `apps/tauri/src/core/coreBackend.ts` 中 `getBackendType()` 返回 `'tauri'`（硬编码）
- [ ] `apps/web/src/core/coreBackend.ts` 无 `@tauri-apps/api` import（P0）
- [ ] `apps/tauri/src/core/coreBackend.ts` 无 WASM import（P0）

### 4.3 Tauri 检测清理验证

- [ ] `grep -r "__TAURI__" apps/web/` 返回空（P0）
- [ ] `grep -r "__TAURI_INTERNALS__" apps/web/` 返回空
- [ ] `apps/web/src/types/global.d.ts` 无 `__TAURI__` 声明
- [ ] `apps/tauri/src/types/global.d.ts` 保留 `__TAURI__` 声明

### 4.4 useAgent 改造验证

- [ ] `packages/shared-composables/src/useAgent.ts` 接收 `backend: IAgentBackend` 参数
- [ ] useAgent 内部无 `getBackendType()` 调用（P0）
- [ ] useAgent 内部无 `import` 任何 Rust/Tauri 专属模块（P0）
- [ ] Web 端 main.ts 注入 `WsAgentBackend`
- [ ] Tauri 端 main.ts 注入 `RustAgentBackend`

### 4.5 worldsmith-server 引用清理验证

- [ ] `grep -r "worldsmith-server" apps/tauri/` 返回空（P0）
- [ ] `grep -r "worldsmith-server" apps/cli/` 返回空（P0）
- [ ] Web 端终端连接目标改为 CLI serve（`VITE_CLI_SERVE_URL` 环境变量）
- [ ] Tauri 端终端无 WS 回退分支

### 4.6 编译验证

- [ ] `cd apps/web && npx tsc --noEmit` 通过（P0）
- [ ] `cd apps/tauri && npx tsc --noEmit` 通过（P0）
- [ ] `cd packages/shared-composables && npx tsc --noEmit` 通过（P0）
- [ ] `cd packages/shared-ui && npx tsc --noEmit` 通过

### 4.7 运行时验证

- [ ] Web 端 `pnpm dev` 启动后，浏览器可正常交互（聊天、实体编辑）（P0）
- [ ] Tauri 端 `pnpm dev` 启动后，桌面应用可正常交互（P0）
- [ ] Web 端浏览器 console 无 `__TAURI__` 相关警告
- [ ] Tauri 端 console 无 WASM 加载失败警告

### 4.8 原 src/ 删除验证

- [ ] `grep -r "from '@/src/" apps/` 返回空
- [ ] `grep -r "from '../src/" apps/` 返回空
- [ ] 原 `src/` 目录已删除（或已归档到 `_archive/src/`）

## 5. Phase 4 验证：后端能力整合

### 5.1 CLI serve 能力验证

- [ ] `apps/cli/src/commands/serve.ts` 存在，注册为 `worldsmith serve` 命令
- [ ] `worldsmith serve` 启动后 `curl http://localhost:3100/health` 返回 200（P0）
- [ ] `curl http://localhost:3100/api/capabilities` 返回工具列表（P0）
- [ ] `curl -X POST http://localhost:3100/api/tools/shell_session_exec` 可执行命令（P0）
- [ ] WS 客户端连接 `ws://localhost:3100/ws` 可收到 `connected` 事件（P0）

### 5.2 端点覆盖验证

- [ ] worldsmith-server 所有 HTTP 端点已在 CLI serve 中实现（逐个对比）
- [ ] worldsmith-server 所有 WS 事件类型已在 CLI serve 中支持
- [ ] PTY 会话管理（spawn/write/resize/kill）在 CLI serve 中可用
- [ ] 文件操作（read/write/list）在 CLI serve 中可用

### 5.3 Web 端切换验证

- [ ] Web 端 API 调用层已切换到 CLI serve 地址
- [ ] Web 端终端可通过 CLI serve WS 执行命令（P0）
- [ ] Web 端文件操作可通过 CLI serve HTTP 完成
- [ ] Web 端无 `import` worldsmith-server 相关模块

### 5.4 worldsmith-server 废弃验证

- [ ] `worldsmith-server/package.json` 添加 `deprecated: true` 标记
- [ ] `worldsmith-server/` 目录仍在（保留作为回滚备份），但无端引用
- [ ] `grep -r "worldsmith-server" apps/` 返回空

## 6. Phase 5 验证：构建配置与 CI 独立

### 6.1 构建独立性验证

- [ ] `pnpm --filter @worldsmith/web build` 产物在 `apps/web/dist/`，可独立部署（P0）
- [ ] `pnpm --filter @worldsmith/cli build` 产物在 `apps/cli/dist/`，可独立运行（P0）
- [ ] `pnpm --filter @worldsmith/tauri build` 产物为安装包，可独立安装（P0）

### 6.2 构建产物隔离验证

- [ ] Web 端产物无 `@tauri-apps/api` 代码（`grep -r "tauri" apps/web/dist/` 为空）（P0）
- [ ] Tauri 端产物无 worldsmith-server 代码
- [ ] CLI 端产物无 Vue 组件代码

### 6.3 根 scripts 验证

- [ ] 根 package.json 包含 `dev:web`、`dev:cli`、`dev:tauri` 命令
- [ ] 根 package.json 包含 `build:web`、`build:cli`、`build:tauri` 命令
- [ ] Tauri build 不再触发 Web build（无 `prebuild` 依赖）

### 6.4 CI 验证

- [ ] `.github/workflows/` 包含三端独立 workflow（或单 workflow 分端 job）
- [ ] CI 中三端构建互不依赖
- [ ] CI 中三端测试互不依赖

## 7. Phase 6 验证：端到端验收与清理

### 7.1 Web 端端到端验收

- [ ] 浏览器打开 Web 端，首屏正常加载（P0）
- [ ] 聊天功能可用（发送消息、接收流式响应）（P0）
- [ ] 实体 CRUD 可用（创建、编辑、删除、验证）（P0）
- [ ] 关系图渲染正常
- [ ] 插件加载正常（思维导图用 JS 布局、工作流走 CLI serve）
- [ ] 终端面板可连接 CLI serve 执行命令
- [ ] 无 console error

### 7.2 CLI 端端到端验收

- [ ] `worldsmith chat` 可启动交互式对话（P0）
- [ ] `worldsmith serve` 可启动 HTTP+WS 服务（P0）
- [ ] `worldsmith serve` 启动后 Web 端可连接
- [ ] CLI 工具执行正常（shell、git、file、lint、test、build）
- [ ] 安全守卫功能正常

### 7.3 Tauri 端端到端验收

- [ ] 桌面应用启动正常，窗口显示正确（P0）
- [ ] 聊天功能可用（Rust 后端）（P0）
- [ ] 实体 CRUD 可用（Rust 后端）（P0）
- [ ] 终端面板可用（Tauri PTY）
- [ ] 插件加载正常（思维导图用 Rust 布局）
- [ ] 文件操作正常（Tauri FS）
- [ ] 无 console error

### 7.4 旧目录清理验证

- [ ] `worldsmith-server/` 已删除（或标记 deprecated 并移到 `_archive/`）
- [ ] `worldsmith-agent/` 残留已删除（核心已迁移到 packages/agent-runtime）
- [ ] 原 `src/` 目录已删除
- [ ] `grep -r "worldsmith-server" .` 仅出现在文档中
- [ ] `grep -r "from '@/src/" .` 返回空
- [ ] 数据文件（data/、*.db）未受影响（P0）

### 7.5 文档更新验证

- [ ] 根 README.md 反映新目录结构
- [ ] AGENTS.md 反映新架构
- [ ] `docs/端分离/` 文档库标注各 Phase 完成状态
- [ ] project_memory.md 已更新架构变更记录

### 7.6 最终独立性验证

- [ ] 删除 `apps/web/` 后，CLI 与 Tauri 仍可独立 build（P0）
- [ ] 删除 `apps/cli/` 后，Web 与 Tauri 仍可独立 build（P0）
- [ ] 删除 `apps/tauri/` 后，Web 与 CLI 仍可独立 build（P0）

## 8. 验证记录模板

每个 Phase 验证完成后填写：

```
## Phase N 验证记录

- 验证人：________
- 验证时间：________
- 验证结果：[ ] 全部通过  [ ] 部分失败  [ ] 阻塞

### 通过项
（列出通过的关键项）

### 失败项
| 失败项 | 原因 | 修复计划 | 状态 |
|--------|------|----------|------|
| | | | |

### 备注
________
```

## 9. 快速验证脚本

以下脚本可用于快速验证关键检查点：

### 9.1 清理完整性检查

```bash
#!/bin/bash
# verify-cleanup.sh — 验证前端入口清理完整性

echo "=== 检查 Web 端无 Tauri 残留 ==="
grep -r "@tauri-apps/api" apps/web/src/ && echo "FAIL: Web 端有 Tauri import" || echo "PASS"
grep -r "__TAURI__" apps/web/src/ && echo "FAIL: Web 端有 __TAURI__ 检测" || echo "PASS"

echo "=== 检查 detectBackend 已移除 ==="
grep -r "detectBackend" apps/ && echo "FAIL: 仍有 detectBackend" || echo "PASS"

echo "=== 检查 Tauri 端无 worldsmith-server 引用 ==="
grep -r "worldsmith-server" apps/tauri/ && echo "FAIL: Tauri 端有 worldsmith-server" || echo "PASS"
grep -r "worldsmith-server" apps/cli/ && echo "FAIL: CLI 端有 worldsmith-server" || echo "PASS"

echo "=== 检查原 src/ 已删除 ==="
test -d src/ && echo "FAIL: src/ 目录仍存在" || echo "PASS"
```

### 9.2 三端独立编译检查

```bash
#!/bin/bash
# verify-build.sh — 验证三端独立编译

echo "=== Web 端编译 ==="
cd apps/web && npx tsc --noEmit && echo "PASS" || echo "FAIL"
cd ../..

echo "=== CLI 端编译 ==="
cd apps/cli && npx tsc --noEmit && echo "PASS" || echo "FAIL"
cd ../..

echo "=== Tauri 端编译 ==="
cd apps/tauri && npx tsc --noEmit && echo "PASS" || echo "FAIL"
cd ../..

echo "=== 共享包编译 ==="
cd packages/agent-runtime && npx tsc --noEmit && echo "PASS" || echo "FAIL"
cd ../..
cd packages/shared-composables && npx tsc --noEmit && echo "PASS" || echo "FAIL"
cd ../..
```

### 9.3 端独立性检查

```bash
#!/bin/bash
# verify-independence.sh — 验证三端互相独立

echo "=== 临时重命名 Web 端，验证 CLI/Tauri 可独立 build ==="
mv apps/web apps/web.bak
(cd apps/cli && npx tsc --noEmit) && echo "CLI PASS" || echo "CLI FAIL"
(cd apps/tauri && npx tsc --noEmit) && echo "Tauri PASS" || echo "Tauri FAIL"
mv apps/web.bak apps/web

echo "=== 临时重命名 CLI 端，验证 Web/Tauri 可独立 build ==="
mv apps/cli apps/cli.bak
(cd apps/web && npx tsc --noEmit) && echo "Web PASS" || echo "Web FAIL"
(cd apps/tauri && npx tsc --noEmit) && echo "Tauri PASS" || echo "Tauri FAIL"
mv apps/cli.bak apps/cli

echo "=== 临时重命名 Tauri 端，验证 Web/CLI 可独立 build ==="
mv apps/tauri apps/tauri.bak
(cd apps/web && npx tsc --noEmit) && echo "Web PASS" || echo "Web FAIL"
(cd apps/cli && npx tsc --noEmit) && echo "CLI PASS" || echo "CLI FAIL"
mv apps/tauri.bak apps/tauri
```
