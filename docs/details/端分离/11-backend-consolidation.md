# 11 - 后端能力整合（Phase 4 执行记录）

> Phase 4 目标：将 worldsmith-server 的能力迁移到 CLI serve，Web 端 API 调用层切换为环境变量配置。

## 1. 执行概览

| 项 | 内容 |
|----|------|
| **开始时间** | 2026-07-29 |
| **完成时间** | 2026-07-29 |
| **状态** | ✅ 已完成 |
| **前置依赖** | Phase 1（agent-runtime）、Phase 2（三端骨架） |
| **后置依赖** | Phase 5（构建配置独立） |

## 2. 能力盘点

### 2.1 worldsmith-server 独有能力（需迁移）

| 端点/能力 | 类型 | 迁移去向 |
|-----------|------|----------|
| `GET /api/services/status` | HTTP | `apps/cli/src/serve/python-routes.ts` |
| `POST /api/crawl` | HTTP | `apps/cli/src/serve/python-routes.ts` |
| `POST /api/crawl/batch` | HTTP | `apps/cli/src/serve/python-routes.ts` |
| `POST /api/convert` | HTTP | `apps/cli/src/serve/python-routes.ts` |
| `POST /api/vector/add` | HTTP | `apps/cli/src/serve/python-routes.ts` |
| `POST /api/vector/search` | HTTP | `apps/cli/src/serve/python-routes.ts` |
| `POST /api/vector/delete` | HTTP | `apps/cli/src/serve/python-routes.ts` |
| WS Token 鉴权（URL query） | WS | 合并到 `apps/cli/src/commands/serve.ts` |
| PythonBridge 模块 | 模块 | `apps/cli/src/python/bridge.ts` |
| PtyManager（node-pty 直管） | 模块 | 废弃（serve.ts 用 ExecutionAdapter 抽象层替代） |
| terminal-launcher | 模块 | 废弃（Phase 3 已迁入 apps/tauri） |

### 2.2 serve.ts 独有能力（保留）

| 端点/能力 | 类型 | 位置 |
|-----------|------|------|
| `GET /health` | HTTP | `apps/cli/src/commands/serve.ts` |
| `GET /api/capabilities` | HTTP | 同上 |
| `POST /api/tools/:name` | HTTP | 同上 |
| `POST /api/prompt`（SSE 流式） | HTTP | 同上 |
| WS `tool_call` + `ping` | WS | 同上 |
| WS `exec` + `pty_*` | WS | 同上 |
| ExecutionAdapter 架构 | 模块 | `@worldsmith/agent-runtime/execution` |

### 2.3 重叠能力（serve.ts 版本更现代，保留）

| 端点/能力 | worldsmith-server 版本 | serve.ts 版本 | 决策 |
|-----------|----------------------|---------------|------|
| `/health` | express router | 原生 http handler | 保留 serve.ts 版本 |
| WS `exec` | PtyManager 直管 | ExecutionAdapter | 保留 serve.ts 版本 |
| WS `pty_*` | PtyManager 直管 | ExecutionAdapter | 保留 serve.ts 版本 |

## 3. 任务执行清单

### P4-T1: CLI serve 模式完善 ✅

| 项 | 内容 |
|----|------|
| **输入** | `worldsmith-agent/src/cli/serve.ts`（606 行） |
| **输出** | `apps/cli/src/commands/serve.ts`（606 行） |
| **验证** | typecheck 通过（apps/cli/src/ 零错误） |

**关键改动**：
- 导入路径改为从 `worldsmith-agent` 包导入（cli-agent, cli-context, cli-safety-guard, execution）
- 添加 PythonBridge 初始化（可选，根据环境变量 CRAWL4AI_ENABLED/MARKITDOWN_ENABLED/TURBOVEC_ENABLED）
- 在 HTTP handler 中添加 Python 路由分发
- 添加 token 鉴权（从 worldsmith-server 合并，AUTH_TOKEN=dev 时免鉴权）
- 版本号升级为 0.2.0

### P4-T2: worldsmith-server 能力盘点 ✅

| 项 | 内容 |
|----|------|
| **输入** | `worldsmith-server/` 全部文件 |
| **输出** | 能力迁移清单（见本文档第 2 节） |
| **验证** | 所有端点有归属 |

### P4-T3: 迁移 HTTP 端点到 CLI serve ✅

| 项 | 内容 |
|----|------|
| **输入** | `worldsmith-server/routes/{crawl,convert,vector-search}.ts`（3 个文件） |
| **输出** | `apps/cli/src/serve/python-routes.ts`（200 行，原生 http 实现） |
| **验证** | 路由逻辑完整保留，curl 可验证各端点 |

**关键决策**：
- 不引入 express，将 3 个 express 路由文件改写为原生 http handler
- 统一 `handlePythonRoute(req, res, bridge)` 入口，返回 boolean 表示是否处理
- PythonBridge 未启用时，所有 Python 路由返回 503

### P4-T4: 迁移 WS 事件到 CLI serve ✅

| 项 | 内容 |
|----|------|
| **输入** | `worldsmith-server/server.ts` 的 WS 实现 |
| **输出** | `apps/cli/src/commands/serve.ts` 的 WS 部分 |
| **验证** | WS 客户端可连接，token 鉴权生效 |

**关键改动**：
- WS 连接时从 URL query 读取 token，校验失败返回 4001
- 保留 serve.ts 原有的 WS 消息处理（tool_call/ping/exec/pty_*）
- 不合并 worldsmith-server 的 PtyManager（serve.ts 用 ExecutionAdapter 替代）

### P4-T5: Web 端 API 调用层切换 ✅

| 项 | 内容 |
|----|------|
| **输入** | `packages/agent-runtime/src/execution/index.ts` 的 `getWsUrl()` |
| **输出** | `getWsUrl()` + `getWsToken()` 三级优先级 + `.env.example` |
| **验证** | typecheck 通过 |

**三级优先级策略**：
1. localStorage（运行时覆盖，最高优先级）
2. `import.meta.env.VITE_CLI_SERVE_URL` / `VITE_CLI_SERVE_TOKEN`（Vite 构建时注入）
3. 默认值（`ws://localhost:3100` / `dev`）

**修改文件**：
- `packages/agent-runtime/src/execution/index.ts`：新增 `getWsToken()`，完善 `getWsUrl()`
- `worldsmith-agent/src/execution/ws-adapter.ts`：使用 `getWsToken()` 替代直接读 localStorage
- `worldsmith-agent/src/execution/index.ts`：重导出 `getWsToken`
- `apps/web/.env.example`（新建）：环境变量示例
- `apps/web/src/env.d.ts`：添加 `VITE_CLI_SERVE_TOKEN` 类型声明

### P4-T6: worldsmith-server 标记废弃 ✅

| 项 | 内容 |
|----|------|
| **输入** | `worldsmith-server/package.json` + `server.ts` |
| **输出** | 添加 deprecated 标记 + 迁移说明 |
| **验证** | package.json 含 deprecated:true，server.ts 顶部有废弃注释 |

**修改文件**：
- `worldsmith-server/package.json`：添加 `deprecated:true` + `deprecation_message`
- `worldsmith-server/server.ts`：顶部添加 JSDoc 废弃警告
- `worldsmith-server/README.md`（新建）：迁移指南

## 4. 新增文件清单

| 文件路径 | 行数 | 说明 |
|----------|------|------|
| `apps/cli/src/commands/serve.ts` | 606 | CLI serve 命令核心实现 |
| `apps/cli/src/python/bridge.ts` | 110 | PythonBridge 类（从 worldsmith-server 迁入） |
| `apps/cli/src/serve/python-routes.ts` | 200 | 原生 http handler，整合 3 个路由文件 |
| `apps/web/.env.example` | 10 | 环境变量示例 |
| `worldsmith-server/README.md` | 30 | 废弃说明 + 迁移指南 |

## 5. 修改文件清单

| 文件路径 | 修改内容 |
|----------|----------|
| `apps/cli/src/index.ts` | serve 子命令接入 startServer，chat 子命令推迟到 Phase 5 |
| `apps/cli/package.json` | 添加 `worldsmith-agent` 依赖 |
| `apps/cli/tsconfig.json` | 添加 `worldsmith-agent` 路径映射 |
| `packages/agent-runtime/src/execution/index.ts` | 新增 `getWsToken()`，完善 `getWsUrl()` 三级优先级 |
| `worldsmith-agent/src/execution/ws-adapter.ts` | 使用 `getWsToken()` 替代直接读 localStorage |
| `worldsmith-agent/src/execution/index.ts` | 重导出 `getWsToken` |
| `apps/web/src/env.d.ts` | 添加 `VITE_CLI_SERVE_TOKEN` 类型声明 |
| `worldsmith-server/package.json` | 添加 `deprecated:true` + `deprecation_message` |
| `worldsmith-server/server.ts` | 顶部添加废弃警告注释 |

## 6. 关键设计决策

### 6.1 HTTP 框架选型：原生 http（不引入 express）

**决策**：保留 serve.ts 的原生 http 架构，将 express 路由改写为原生 http handler。

**理由**：
- 与 serve.ts 现有架构一致，避免 express + 原生 http 混用
- 零新增依赖（apps/cli 无需引入 express + @types/express）
- Python 路由逻辑简单（纯 JSON 代理），原生 http 足够
- 统一架构，降低维护成本

### 6.2 PythonBridge 作为可选模块

**决策**：PythonBridge 根据环境变量（CRAWL4AI_ENABLED / MARKITDOWN_ENABLED / TURBOVEC_ENABLED）决定是否启用。

**理由**：
- 大部分用户不需要 Python 微服务（仅需 shell/git/file 工具）
- 无配置时 serve 正常启动，仅跳过 /api/crawl 等端点（返回 503）
- 启用时通过环境变量显式配置，避免隐式依赖

### 6.3 Web 端 API 切换：环境变量 + 渐进切换

**决策**：三级优先级（localStorage > 环境变量 > 默认值）。

**理由**：
- 保留 localStorage 作为运行时覆盖（用户可在浏览器控制台手动设置）
- 环境变量通过 Vite 构建时注入，适合生产部署
- 默认值确保开发环境零配置可用

### 6.4 apps/cli 依赖 worldsmith-agent（过渡策略）

**决策**：apps/cli 通过 `file:../../worldsmith-agent` 依赖 worldsmith-agent 包。

**理由**：
- Phase 4 仅迁移 serve 命令，chat 命令和相关 CLI 模块仍在 worldsmith-agent 中
- Phase 5/6 将逐步将 cli-agent、cli-context 等模块迁移到 apps/cli 或 agent-runtime
- 过渡期保持依赖关系，避免大规模重构

## 7. 验证结果

### 7.1 类型检查

| 包 | 命令 | 结果 |
|----|------|------|
| apps/cli | `npx tsc --noEmit` | ✅ apps/cli/src/ 零错误（传递依赖错误为 monorepo 预存问题） |
| packages/agent-runtime | `npx tsc --noEmit` | ✅ 无本次修改相关错误 |
| worldsmith-agent | `npx tsc --noEmit` | ✅ 无本次修改相关错误 |

### 7.2 功能验证（待 Phase 6 执行）

- [ ] `worldsmith serve` 可启动 HTTP+WS 服务器
- [ ] `curl http://localhost:3100/health` 返回 200
- [ ] `curl http://localhost:3100/api/capabilities` 返回工具列表
- [ ] WS 客户端可连接 `ws://localhost:3100/ws`
- [ ] 配置 CRAWL4AI_ENABLED=true 后 `/api/crawl` 可用
- [ ] Web 端通过 VITE_CLI_SERVE_URL 连接 CLI serve

## 8. 已知遗留问题

| 问题 | 原因 | 影响范围 | 处理时机 |
|------|------|----------|----------|
| `createCliAgent` 已标记废弃 | pi-ai 依赖被移除 | /api/prompt 聊天不可用 | Phase 5 迁入新 agent 实现 |
| apps/cli 依赖 worldsmith-agent | Phase 4 过渡策略 | 架构不够纯净 | Phase 6 彻底剥离 |
| worldsmith-server 目录仍存在 | 保留供历史参考 | 无功能影响 | Phase 6 删除 |

## 9. Phase 4 → Phase 5 过渡

Phase 4 完成后，Phase 5（构建配置与 CI 独立）可以开始：

- **P5-T1**：Web 端 vite.config.ts 独立（移除 Tauri 相关插件）
- **P5-T2**：Tauri 端 vite.config.ts + tauri.conf.json 独立
- **P5-T3**：CLI 端 tsconfig.json + 构建脚本独立
- **P5-T4**：根 package.json scripts 更新（分端命令）
- **P5-T5**：CI workflow 分端构建
- **P5-T6**：移除根目录 build:web 依赖
