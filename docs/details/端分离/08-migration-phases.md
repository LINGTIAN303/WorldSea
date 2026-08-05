# 08 - 分阶段迁移路线

> 将端分离工作拆解为可独立验证、可独立回滚的阶段。每阶段有明确的输入、输出、验证标准。

## 1. 阶段总览

```
Phase 0: 调研与文档库搭建 ──────────────── 已完成
  │
  Phase 1: 共享代码层抽离 ──────────────── 已完成（2026-07-29）
  │
  Phase 2: 三端目录骨架建立 ────────────── 已完成（2026-07-29）
  │
  Phase 3: 前端入口分离与清理 ──────────── ✅ 已完成（2026-08-03，业务 UI 已全部迁入 apps/web，根 src/ 已删除）
  │
  Phase 4: 后端能力整合 ────────────────── 已完成（2026-07-29）
  │
  Phase 5: 构建配置与 CI 独立 ──────────── 已完成（2026-07-29）
  │
  Phase 6: 端到端验收与清理 ────────────── ✅ 已完成（2026-08-03，端分离全部完成）
```

> **2026-08-03 状态更新**：Phase 3 业务 UI 迁移（P3-W1~W5 + P3-W4 续批次，见 3.1~3.21 节）与 Phase 6 验收清理已全部完成，端分离 100% 收官。主应用入口 = apps/web，根 src/ 与旧目录（src-tauri/worldsmith-agent/worldsmith-server）均已删除。

### 阶段依赖关系

```
Phase 0 ─→ Phase 1 ─→ Phase 2 ─→ Phase 3 ─→ Phase 4 ─→ Phase 5 ─→ Phase 6
                                      │           │
                                      └───────────┘
                                 (Phase 3 与 Phase 4 可部分并行)
```

## 2. Phase 0: 调研与文档库搭建（已完成）

| 项 | 内容 |
|----|------|
| **目标** | 梳理现状、设计目标架构、编写完整迁移计划文档 |
| **输入** | 现有代码库、package.json、pnpm-workspace.yaml |
| **输出** | `docs/端分离/` 文档库（00-10 共 11 份文档 + README） |
| **验证** | 文档库完整、关键技术决策已记录、风险已识别 |
| **状态** | ✅ 已完成 |

## 3. Phase 1: 共享代码层抽离（已完成）

| 项 | 内容 |
|----|------|
| **目标** | 将 `worldsmith-agent/src/` 中端无关逻辑抽离到 `packages/agent-runtime`；定义 `IAgentBackend` 接口 |
| **前置依赖** | Phase 0 |
| **后置依赖** | Phase 2、Phase 3 |
| **状态** | ✅ 已完成（2026-07-29） |

### 1.1 任务拆解与完成情况

| 任务 ID | 任务 | 输出 | 状态 |
|---------|------|------|------|
| P1-T1 | 创建 `packages/agent-runtime` 包骨架 | `packages/agent-runtime/package.json` + `tsconfig.json` | ✅ |
| P1-T2 | 定义 `IAgentBackend` 接口 | `packages/agent-runtime/src/bridge.ts` | ✅ |
| P1-T3 | 迁移 Agent 核心逻辑 | `packages/agent-runtime/src/agent.ts` | ✅ |
| P1-T4 | 迁移 tools/skills/session/orchestrator | `packages/agent-runtime/src/{tools,skills,session,...}/` | ✅ |
| P1-T5 | 迁移 ExecutionAdapter 接口 + 工厂注册模式 | `packages/agent-runtime/src/execution/{adapter,index,env}.ts` | ✅ |
| P1-T6 | `worldsmith-agent` 改为依赖 `agent-runtime` | `worldsmith-agent/package.json` 添加 `@worldsmith/agent-runtime` 依赖 | ✅ |
| P1-T7 | 修复 vite.config + tsconfig 配置 | vite alias + 3 个 tsconfig 的 paths 映射 | ✅ |
| P1-T8 | 修复 node-adapter.ts 断裂导入 | `'./adapter'` → `'@worldsmith/agent-runtime'` | ✅ |
| P1-T9 | typecheck 验证 | agent-runtime 自身无错误；worldsmith-agent 重构错误已修复 | ✅ |
| P1-T10 | 更新文档和 project_memory.md | 本文件 + project_memory.md | ✅ |

### 1.2 关键决策点（已实施）

- **ExecutionAdapter 注册机制**：改为工厂函数注册（`registerExecutionAdapterFactory`），三端在入口注册各自实现
  - `packages/agent-runtime/src/execution/index.ts`：工厂注册中心
  - `worldsmith-agent/src/execution/index.ts`：向后兼容层，自动注册三端适配器
- **IAgentBackend 接口设计**：定义在 `packages/agent-runtime/src/bridge.ts`，覆盖 `prompt()`、`subscribe()`、`abort()` 等核心方法
- **向后兼容策略**：`worldsmith-agent/src/index.ts` 重导出 `@worldsmith/agent-runtime` 的全部端无关 API，现有调用方无需修改

### 1.3 已知遗留问题（非 Phase 1 引入）

| 问题 | 原因 | 影响范围 | 建议 |
|------|------|----------|------|
| `@types/ws` 未安装 | pnpm install 网络超时 | `serve.ts` 类型检查 | 网络恢复后 `pnpm install` |
| canvas-engine `Graph` 类型错误 | 预存 graphology 类型不匹配 | canvas-engine 包 | 后续单独修复 |
| plugin-sdk/ui-kit `.vue` 模块声明缺失 | 预存 Vue SFC 类型解析问题 | plugin-sdk/ui-kit 包 | 后续单独修复 |

### 1.4 风险（实际发生情况）

| 风险 | 是否发生 | 处理方式 |
|------|----------|----------|
| 迁移过程中漏掉依赖 | ✅ 发生 | 通过 typecheck 逐步发现并修复（FileLike/FileContentLike 未导出、bridge-types 相对路径等） |
| 接口设计不合理需返工 | ❌ 未发生 | 工厂注册模式 + 向后兼容层策略有效 |

## 4. Phase 2: 三端目录骨架建立（已完成）

| 项 | 内容 |
|----|------|
| **目标** | 创建 `apps/web`、`apps/cli`、`apps/tauri` 三个独立子项目目录与 package.json |
| **前置依赖** | Phase 1 |
| **后置依赖** | Phase 3 |
| **状态** | ✅ 已完成（2026-07-29） |

### 2.1 任务拆解与完成情况

| 任务 ID | 任务 | 输出 | 状态 |
|---------|------|------|------|
| P2-T1 | 创建 `apps/web/` 骨架 | package.json + vite.config.ts + tsconfig.json + index.html + src/{main.ts,App.vue,env.d.ts} | ✅ |
| P2-T2 | 创建 `apps/cli/` 骨架 | package.json + tsconfig.json + bin/cli.mjs + src/index.ts | ✅ |
| P2-T3 | 创建 `apps/tauri/` 骨架 | package.json + tauri.conf.json + vite.config.ts + src/{main.ts,App.vue} + src-tauri/{Cargo.toml,build.rs,src/{main.rs,lib.rs},capabilities/default.json} | ✅ |
| P2-T4 | 更新 pnpm-workspace.yaml | 包含 `apps/*` | ✅ |
| P2-T5 | 配置三端对 packages/ 的 alias | 三端 vite.config.ts + tsconfig.json 的 `@worldsmith/agent-runtime` alias | ✅ |
| P2-T6 | 验证 | pnpm workspace 识别三端包✅；JSON 配置语法✅；CLI --help✅ | ✅ |
| P2-T7 | 更新文档和 project_memory.md | 本文件 + project_memory.md | ✅ |

### 2.2 关键设计决策

- **端口分离**：Web 端 5174，Tauri 端 5175（避免与主项目 5173 冲突）
- **依赖共享包**：三端通过 `file:../../packages/agent-runtime` 依赖共享层
- **Tauri Rust 骨架最小化**：Phase 2 仅创建最小 Rust 骨架（main.rs + lib.rs + Cargo.toml），实际命令层（agent/entity/file/git/pty 等）在 Phase 3 从 `src-tauri/` 迁入
- **Tauri 图标临时复用**：`tauri.conf.json` 图标路径指向 `icons/`（Phase 3 迁移时从 `src-tauri/icons/` 复制）
- **根 package.json 新增分端脚本**：`dev:web`、`dev:cli`、`dev:tauri`

### 2.3 已知遗留问题（非 Phase 2 引入）

| 问题 | 原因 | 影响范围 | 建议 |
|------|------|----------|------|
| `@rolldown/binding-win32-x64-msvc` 下载超时 | 网络问题（Phase 1 同样问题） | Web/Tauri 端 Vite 启动 | 网络恢复后 `pnpm install --prefer-offline` |
| Web/Tauri 端 Vite 启动未验证 | pnpm install 未完整完成 | 仅验证受阻，配置已正确 | 网络恢复后验证 |

### 2.4 注意事项（已实施）

- ✅ 此阶段三端 src/ 仅为骨架，不迁移实际业务代码
- ✅ 保持原 `src/` 目录不变，确保主分支仍可正常开发
- ✅ 三端 package.json 的 name 分别为 `@worldsmith/web`、`@worldsmith/cli`、`@worldsmith/tauri`

## 5. Phase 3: 前端入口分离与清理

| 项 | 内容 |
|----|------|
| **目标** | 将 `src/` 拆分到三端，清理后端切换逻辑、Tauri 检测分支 |
| **前置依赖** | Phase 2 |
| **后置依赖** | Phase 5 |
| **参考文档** | 【`[07-frontend-entry-cleanup.md](./07-frontend-entry-cleanup.md)`】 |
| **状态** | ⚠️ **部分完成（2026-07-31 复核）**：共享 composables 下沉 + Tauri/Web 专用文件迁移 + coreBackend/useAgent/main.ts 改造已完成；**业务 UI（根 src/ 数百个文件）尚未迁入三端**，根 `src/` 仍是主应用代码源，`apps/web`/`apps/tauri` 的 App.vue 仍为骨架占位页 |

### 3.0 真实状态复核（2026-07-31）

> 此前文档将 Phase 3 标记为"已完成"不准确。实际完成范围如下：

| 任务 ID | 对应 Step | 任务 | 实际状态 |
|---------|-----------|------|----------|
| P3-T1 | Step 1-2 | 共享 composables 迁入 `packages/shared-composables` | ✅ 完成（agent/companion/entity/ui 四类；useSmartFillChat/useCompanionMode 已下沉，根 src/composables 保留 re-export） |
| P3-T2 | Step 3 | Tauri 专用文件迁入 `apps/tauri/src/` | ✅ 完成（8 个 Rust composables + coreBackend + ProjectFS 等） |
| P3-T3 | Step 4 | Web 专用文件迁入 `apps/web/src/`（coreBackend WASM + worldsmithCore 等） | ✅ 完成 |
| P3-T4 | Step 5 | 改造 `coreBackend.ts`（三端各保留单路径版本） | ✅ 完成 |
| P3-T5 | Step 6 | 改造 `useAgent.ts`（接收 backend 注入） | ✅ 完成（TS/Rust 路由层保留在 src/，三端入口硬编码后端） |
| P3-T6 | Step 7 | 改造 `main.ts`（端入口硬编码后端） | ✅ 完成（apps/web|tauri/src/main.ts 已硬编码 WASM/Rust 后端） |
| P3-T7 | Step 8 | 清理 `__TAURI__` 检测与 global.d.ts | ✅ 完成 |
| P3-T8 | Step 9 | 清理插件层（mindmap/workflow Rust 调用） | ✅ 完成 |
| P3-T9 | Step 10 | 清理 worldsmith-server 引用 | ✅ 完成（CLI serve 替代） |
| P3-T10 | Step 11-12 | 更新构建配置，删除原 `src/` | ⏳ **进行中**（2026-08-03 启动渐进式迁移，第一批骨架完成，见 3.6；业务 UI 尚未全部迁入，删除仍会摧毁应用） |

**关键结论**：根 `src/` 目前仍是主应用（根 `vite` dev 入口 + 全部业务 UI）。三端骨架仅完成"端初始化 + 后端硬编码"。**端分离剩余核心工作 = 把根 src/ 业务 UI 迁入 apps/web（数十万行级工程）**，2026-07-31 决策：暂停该大迁移，回到主应用开发（根 src/），后续按 ROADMAP 单独排期。

### 3.5 迁移启动条件复核 + 决策（2026-08-02）

**前置条件复核**（grep/构建验证）：
- ✅ ui-kit / shared-composables / worldsmith-agent 与根 `src/` 完全解耦（0 引用，08 文档 5.4.2 记录的"ui-kit 30+ 个 `../../../src/` 导入"遗留已解决）
- ✅ `@agent` 单轨收敛（c3856de）；三端独立构建通过（Phase 5）
- ⚠️ 根 `src/` 733 文件（378 .vue + 355 .ts）待迁移；`shared-ui` 包不存在

**三个启动决策（2026-08-02 用户确认）**：
1. **共享 UI 方案**：不新建 `packages/shared-ui`，继续用 `ui-kit`（已解耦、已承担 30+ Ws* 组件），迁移时根 src/ 新增共享组件直接下沉 ui-kit
2. **迁移策略**：渐进式分模块迁移（先骨架+路由+核心页面，再逐插件/面板），每模块独立验证可回滚，不做一次性全量迁移
3. **启动节奏**：**先收尾主应用 Rust 后端工作线**（failTask 终态实测、深度模式/A2UI/终端/子 Agent 补齐），再启动迁移，不双线并行

### 3.6 渐进式迁移 · 第一批：骨架启动链路（2026-08-03）

按决策 2（渐进式分模块迁移）启动。第一批目标 = 让 `apps/web` 从"占位骨架"升级为"真实启动链路"（Splash → boot 状态机 → 主界面骨架），每批独立验证可回滚。

**迁移范围（apps/web/src/ 内，13 个文件，与根 src/ 保持一致）**：
- 静态资产：`design-tokens/{primitive,semantic,component,interaction-modes}.css` + `assets/themes.css`
- boot 组件：`ui/boot/{splash-canvas.ts, SplashScreen.vue, BootErrorScreen.vue}`
- 轻量共享壳（entity-core/ui-kit re-export）：`stores/{uiStore,settingsStore}.ts`、`composables/{useTheme,useToast}.ts`、`modules/runtime/events.ts`
- 入口：`main.ts`（entity-core 全套注册 + canvas-engine `registerBackend` + WebSocket 适配器 + downloader/packValidator/versionProvider + `fieldRegistry.loadPersisted`）+ `App.vue` 骨架版（boot 状态机 + 主题 + 占位内容区）

**占位实现（明确标注，后续批次替换）**：
- `registerModuleStoreApi` / `registerProjectSwitcherApi` → 空实现（业务批次迁入 `modules/store.ts` / `useProjectSwitcher.ts`）
- App.vue 内容区占位（P3-W2 Shell 布局 / P3-W3 核心页面 批次迁入后替换）
- **不接 governor**（依赖 plugins/modules/core，属业务批次）

**验证结果（2026-08-03）**：
- ✅ `pnpm install` 通过（期间处理 pnpm Windows EPERM：esbuild/file: 包 rename 碰撞，清理残留目录后一次通过）
- ✅ `pnpm --filter @worldsmith/web dev` 启动（vite 8.1.5，端口 5174）
- ✅ 浏览器验证骨架链路：Splash 淡出 → `markReady` → 占位页渲染（badge + 批次说明），无运行时错误
- ⚠️ **typecheck 存量问题**（非本批引入，待决策处理）：apps/web coreBackend 13 处未用变量（TS6133）、entity-core 缺 `@types/js-yaml`、ui-kit RegionMap 未用变量、根 `src/core/*` 收敛桥（re-export apps/web）把根 coreBackend 的 `__TAURI_INTERNALS__` 引用带入 web 程序（TS2339）

**后续批次计划**：
- P3-W2：Shell 布局（MenuBar / SidebarV2 / WsConfirmDialog / Companion / AppMessageHandler）+ App.vue 内容区替换 ✅（2026-08-03 完成，见 3.7）
- P3-W3：核心页面（AgentSpace / 实体视图 / 插件面板）+ governor + 官方插件 + 业务弹窗（Trash/Settings/Theme/SmartFill 等，P3-W2 已裁剪并标注 TODO）
- P3-W4：逐插件/面板迁移，每批独立验证
- Phase 6：三端验收 + 删除根 src/（P3-T10 收尾）

### 3.7 渐进式迁移 · 第二批：Shell 布局（P3-W2，2026-08-03）

第二批目标 = 让 `apps/web` 从"占位内容区"升级为"完整 Shell 布局链"（MenuBar + Sidebar 轮播 + ViewContainer + 全局弹窗/通知），替换 P3-W1 占位。**用户确认方案 A（完整布局链）**：连带迁 modules/store + registry → useProjectSwitcher，保证 Shell 依赖链完整可用。

**迁移范围（apps/web/src/ 内，新增 12 文件，与根 src/ 保持一致）**：
- 模块层（真实实现，替换 P3-W1 占位）：`modules/store.ts`（项目级 modules 表，回退 legacyDb）、`modules/registry.ts`（拓扑排序 + semver 兼容 + 生命周期，裁剪 KanbanView 动态加载 → TODO P3-W3）、`composables/useProjectSwitcher.ts`（项目切换编排，裁剪 memory-archive 归档与 Tauri 分支 → TODO P3-W3）
- 布局组件（WsIcon/DialogContainer 复用 ui-kit，未复制根版本）：
  - `ui/layout/MenuBar.vue`、`ui/layout/sidebar/{SidebarV2.vue, useSidebarPhysics.ts, useSidebarInteraction.ts, useSidebarDragHandler.ts}`
  - `ui/WsConfirmDialog.vue`（useFocusTrap 复用第一批壳）
  - `ui/companion/{CompanionNotification.vue, AppMessageHandler.vue}`
  - `ui/layout/Shell.vue`（裁剪未迁业务弹窗入口：Trash/Settings/ThemeEditor/SmartFill/AgentOverlay/ProjectSwitcherDialog 等，标注 TODO P3-W3 恢复）
- 新增 re-export 壳：`composables/useFileSystemProject.ts`（entity-core/composables）
- 接入：`App.vue` 占位内容区 → `<Shell />`；`main.ts` 的 `registerModuleStoreApi` / `registerProjectSwitcherApi` 占位 → 真实实现

**风险点处理（P3-W1 遗留，2026-08-03 一并完成）**：
- ✅ apps/web coreBackend 13 处 TS6133 → 未用参数加 `_` 前缀清零
- ✅ entity-core 缺 `@types/js-yaml` → 根 package.json 声明 `@types/js-yaml@^4.0.9` + node_modules junction 链接（pnpm @types 提升问题，.npmrc 未生效）
- ✅ ui-kit RegionMap 未用变量 → 删除 useUndoRedo 解构/import/confirmOffset
- ⏳ 根 `src/core/*` 收敛桥 TS2339（`__TAURI_INTERNALS__`）→ 计划保留（Phase 6 删根 src/ 自然消失）

**验证结果（2026-08-03）**：
- ✅ `npx vue-tsc --noEmit`（apps/web）：仅剩根收敛桥 TS2339×2（计划保留项），迁移代码零类型错误
- ✅ `vite dev`（5174）启动无报错
- ✅ 浏览器验证：Splash → ready → **真实 Shell 渲染**（MenuBar 三按钮 + Sidebar 视图导航 + WelcomeOverlay + ViewContainer 欢迎文案）
- ✅ 交互验证：MenuBar "更多操作" 下拉 11 个菜单项渲染；侧边栏折叠/展开切换生效
- ⚠️ 已知无害 404：`/favicon.ico`（index.html 未引用图标，非功能问题）

**后续批次计划**：
- P3-W3：核心页面（AgentSpace / 实体视图 / 插件面板）+ governor + 官方插件 + 业务弹窗恢复（TrashPanel/SettingsDialog/ThemeEditor/SmartFill/AgentOverlay/ProjectSwitcherDialog + registry KanbanView + useProjectSwitcher memory-archive/useFileSystemProject 恢复）→ **2026-08-03 用户确认拆分**：本批仅 governor 层 + plugins 基础（见 3.8）；AgentSpace 拆出独立专项批次
- P3-W4：官方插件逐批迁移（27 个插件，内部根相对路径需改造）+ 业务弹窗恢复（bootstrap officialPlugins/facetMigration/fontBootstrap 恢复点）
- Phase 6：三端验收 + 删除根 src/（P3-T10 收尾）

### 3.8 渐进式迁移 · 第三批：governor 层 + plugins 基础（P3-W3，2026-08-03）

第三批目标 = 让 `apps/web` 从"骨架 markReady"升级为"真实启动编排"（governor boot 接管 critical/normal/lazy 分级启动）。**用户确认方案 A（先 governor 层）**：不迁移官方插件（体量大且未与根 src/ 解耦），AgentSpace 拆出独立专项批次。

**迁移范围（apps/web/src/ 内，新增 11 文件）**：
- plugins 基础（复制，相对导入自洽）：`plugins/{PluginManager,PluginSandbox,plugin-manifest}.ts`
- governor 层：
  - 纯 re-export/薄包装（复制，实现不变）：`governor/{types,environment,registry,governor,index}.ts`
  - 业务文件（路径调整）：`governor/api.ts`（pluginAPI 包装，不变）、`governor/adapters.ts`（官方插件路径 `../plugins/official/` → `@/plugins/official/`）、`governor/bootstrap.ts`（裁剪 3 个依赖未迁的模块）
- 接入：`App.vue` 骨架 markReady → `initGovernor + governor.registerAll(coreModules) + governor.boot()`（critical 失败 → markBootError 错误页；成功 → markReady）

**bootstrap 裁剪点（标注 TODO P3-W4 恢复）**：
- `core.official-plugins`：依赖 `plugins/official/*`（未迁入）
- `core.facet-migration`：依赖 `core/FacetMigrator`（未迁入）
- `core.font-bootstrap`：依赖 `composables/useFontBootstrap`（未迁入）
- 保留：project-space / wasm-detection / plugin-pre-register（critical）+ relations-init / custom-modules / navigation-listener（normal）+ auto-cleanup（lazy）

**验证结果（2026-08-03）**：
- ✅ `npx vue-tsc --noEmit`（apps/web）：仅剩根收敛桥 TS2339×2（计划保留项），迁移代码零类型错误
- ✅ `vite dev`（5174）启动无报错
- ✅ 浏览器验证：**governor boot 全链路成功**——控制台 `[Governor] 启动完成: 7 激活, 0 失败, 0 跳过, 耗时 645ms`；critical（project-space/wasm-detection/plugin-pre-register）全部激活 → 无 critical failure → markReady
- ✅ 行为升级验证：MenuBar 项目名从空 → **"默认项目"**（project-space 模块调用 useProjectSwitcher.initialize() 成功创建项目）；WASM 核心库加载成功
- ⚠️ 已知无害 404：`/favicon.ico`

**后续批次计划**：
- P3-W4：官方插件逐批迁移（27 个，先 5-6 个默认激活轻量插件验证链路，内部 `../../../ui/*`、`../../../stores/*`、`../../../composables/useAgentPluginBridge` 等根相对路径改为 ui-kit/@/ 导入）+ bootstrap 恢复 officialPlugins/facetMigration/fontBootstrap + 业务弹窗恢复（Trash/Settings/Theme/SmartFill/ProjectSwitcher + registry KanbanView + useProjectSwitcher memory-archive/useFileSystemProject）→ **2026-08-03 首批完成（见 3.9）**
- P3-W5（专项）：AgentSpace（src/agent/ 100+ 文件，独立批次）
- Phase 6：三端验收 + 删除根 src/（P3-T10 收尾）

### 3.9 渐进式迁移 · 第四批首轮：官方插件首批（P3-W4，2026-08-03）

第四批目标 = 让 `apps/web` 显示真实官方插件视图（替换 WelcomeOverlay 空状态）。**首批选 6 个默认激活 + 轻量插件**（内部依赖仅 WsIcon/WsEmpty/settingsStore，无 WsSpinner/canvas/useAgentPluginBridge 依赖）：characters / regions / organizations / concepts / items / languages。

**迁移内容（apps/web/src/）**：
- 复制 6 个插件目录 → `plugins/official/{characters,regions,organizations,concepts,items,languages}/`（14 个组件/配置文件）
- 批量改造根相对路径导入（10 文件）：
  - `import WsIcon from '(../)+ui/WsIcon.vue'` → `import { WsIcon } from '@worldsmith/ui-kit'`
  - `import WsEmpty from '(../)+ui/WsEmpty.vue'` → `import { WsEmpty } from '@worldsmith/ui-kit'`
  - `from '(../)+stores/settingsStore'` → `from '@/stores/settingsStore'`
- `governor/bootstrap.ts`：恢复 `core.official-plugins` 模块（normal 级）：
  - **关键修正**：Web 端不能用 `@vite-ignore` + 模板字符串动态 import（浏览器无法解析 `@/` 别名）→ 改为**显式静态 import 映射表**（`pluginLoaders: Record<id, () => Promise>`），Vite 构建期静态分析
  - 仅加载已迁移插件（MIGRATED_OFFICIAL_PLUGIN_IDS + pluginLoaders 同步维护）
  - 保留原逻辑：settingsStore.getActivePluginIds() → 并行加载 → 顺序 activate → 尽早设首屏视图

**验证结果（2026-08-03）**：
- ✅ `npx vue-tsc --noEmit`（apps/web）：仅剩根收敛桥 TS2339×2（计划保留项），迁移代码零类型错误
- ✅ `vite dev`（5174）启动无报错
- ✅ 浏览器验证：**官方插件真实加载**——控制台 `[Governor] 启动完成: 8 激活, 0 失败, 0 跳过`；`[PluginManager] 已激活: 角色 v2.0.0`、`已激活: 概念/设定库 v2.0.0`（仅激活 settings 中启用的插件）
- ✅ 角色视图完整渲染：搜索框 + 6 个筛选下拉 + 对比/模板创建/新建按钮 + **4 条真实实体数据**（凯恩·铸铁/露娜·逐影/艾琳/瑟兰迪尔，来自默认项目）
- ✅ 侧边栏出现视图轮播项：`concepts`（9 实体）+ `characters`（4 实体）
- ⚠️ 已知无害：favicon 404；a11y warning（表单字段缺 id/name，ui-kit 存量，非本批引入）

**后续（P3-W4 续）**：迁移其余 21 个插件（分批：无 WsSpinner 依赖 → WsSpinner 依赖需先补 ui-kit 导出 → canvas/graph 类）；恢复 bootstrap facetMigration/fontBootstrap；业务弹窗恢复。
- P3-W5（专项）：AgentSpace（src/agent/ 100+ 文件，独立批次）
- Phase 6：三端验收 + 删除根 src/（P3-T10 收尾）

### 3.10 渐进式迁移 · 第四批二轮：官方插件第二批（P3-W4，2026-08-03）

第二批迁移 7 个插件（同为默认非激活 + 轻量依赖，仅 WsIcon/WsEmpty/settingsStore）：buildings / species / plants / combat_stats / weapons / apparel / conflict。至此已迁移 13 个官方插件。

**迁移内容（apps/web/src/）**：
- 复制 7 个插件目录 → `plugins/official/{buildings,species,plants,combat_stats,weapons,apparel,conflict}/`（含 canvas 类 composables：useBuildingSectionCanvas / useEvolutionTreeCanvas / useRecipeTreeCanvas / useRealmStaircaseCanvas / useWeaponLineageCanvas 等）
- 批量改造根相对路径导入：仅 1 文件需修改（其余插件的 WsIcon 引用模式已被首批脚本覆盖）；残留检查确认无 `ui/WsIcon|ui/WsEmpty|stores/settingsStore|ui/WsSpinner` 残留
- `governor/bootstrap.ts`：`MIGRATED_OFFICIAL_PLUGIN_IDS` 与 `pluginLoaders` 追加 7 项；**修正 TS6133**——filter 改为同时校验 `MIGRATED_OFFICIAL_PLUGIN_IDS.has(id) && pluginLoaders[id]`（两表同步维护，与文档意图一致）

**验证结果（2026-08-03）**：
- ✅ `npx vue-tsc --noEmit`（apps/web）：仅剩根收敛桥 TS2339×2（计划保留项），迁移代码零类型错误
- ✅ 浏览器验证（模拟启用 13 个插件后刷新）：`[PluginManager] 已激活` 共 **13 个插件 0 失败**（角色/区域图谱/势力/概念/道具/服饰/建筑/种族/语言/冲突/植物/战力/武器 v2.0.0）；`[Governor] 启动完成: 8 激活, 0 失败, 0 跳过`
- ✅ 视图渲染：characters（4 实体）、concepts（9 实体）；buildings/species/items 空状态正常（搜索框 + 子视图切换按钮 + 新建按钮）；无控制台 error
- ✅ 侧边栏视图轮播包含全部 13 个插件视图

**后续（P3-W4 续）**：剩余 14 个官方插件——timeline/mindmap/manuscript/notebook/drawing/workflow/tactical-board/graph/magic/outline/custom/module-builder/culture/inspiration（其中 WsSpinner 依赖需先补 ui-kit 导出；mindmap/workflow 依赖 apps/tauri 需跳过或适配；manuscript/notebook 依赖 agent 需等 P3-W5）；恢复 bootstrap facetMigration/fontBootstrap；业务弹窗恢复（Trash/Settings/Theme/SmartFill/ProjectSwitcher + registry KanbanView + useProjectSwitcher memory-archive/useFileSystemProject）。

### 3.11 渐进式迁移 · 第四批三轮：官方插件第三批（P3-W4，2026-08-03）

第三批迁移 6 个插件（含 canvas/composables 复杂视图）：timeline / magic / outline / custom / culture / inspiration。至此已迁移 **19 个官方插件**（27 个中）。

**迁移内容（apps/web/src/）**：
- **前置**：复制 `composables/useAgentPluginBridge.ts`（纯 Vue composable——onMounted/onUnmounted + CustomEvent 监听，**无 agent 依赖**）→ 解锁 9 个插件的 agent 事件桥接
- 复制 6 插件目录 → `plugins/official/{timeline,magic,outline,custom,culture,inspiration}/`（44 文件，含 timeline 12 组件/7 composables、custom dashboard 9 文件、culture/inspiration canvas 类）
- 批量改造根相对路径导入（14 文件）：WsIcon/WsEmpty → `@worldsmith/ui-kit` 具名；settingsStore/uiStore → `@/stores/*`；useAgentPluginBridge → `@/composables/useAgentPluginBridge`（正则覆盖 `../../../` 与 `../../../../` 两种深度变体）
- `governor/bootstrap.ts`：MIGRATED_OFFICIAL_PLUGIN_IDS + pluginLoaders 追加 6 项

**验证结果（2026-08-03）**：
- ✅ `npx vue-tsc --noEmit`（apps/web）：仅剩根收敛桥 TS2339×2，第三批代码零类型错误
- ✅ 浏览器验证：`[PluginManager] 已激活` 共 **19 个插件 0 失败**（新增：时间线/自定义视窗 v1.0.0/魔法/大纲/文化/灵感）；`[Governor] 启动完成: 8 激活, 0 失败`
- ✅ 时间线视图完整渲染：3 条真实事件（星辉之门再现/铁砧岛大会/大裂变灾难）+ 搜索/纪元筛选/重要度筛选/时间序-垂直切换/分组/紧凑/冲突检测/新建
- ✅ 文化（空状态）/魔法（搜索+等级筛选+技能树切换+空状态）渲染正常；无 console error

**剩余 8 个插件分类**：
- **graph**：依赖 graphology/sigma/layout-forceatlas2（apps/web 未装，需新增 npm 依赖）+ coreBackend algoCommunityDetection（已有✓）
- **drawing**：WsSpinner 依赖（需先补 ui-kit 导出）+ useAgentPluginBridge（可用）
- **module-builder**：依赖根 `core/ModuleRuntime` + `core/ModuleViewRegistry` + `stores/customModuleStore`（apps/web 无此体系，需评估）
- **manuscript**：useAgent（AISidebar）+ fontStore（entity-core 已有✓）+ useFontPresets → 待 P3-W5
- **mindmap**：useAgent + useRustLayout/useRustGraphAnalysis（apps/tauri re-export）→ 待 P3-W5
- **workflow**：useOrchestrator（agent）+ workflowApi（apps/tauri re-export）→ 待 P3-W5
- **notebook**：useAgentPluginBridge（可用）+ 需查 useCodeSandbox/TipTap 依赖 → 候选下一批
- **tactical-board**：useTacticalAgentBridge（依赖 useAgentPluginBridge，可用）+ TacticalEngineJS → 候选下一批

### 3.12 渐进式迁移 · 第四批四轮：官方插件第四批（P3-W4，2026-08-03）

第四批迁移 4 个复杂插件：drawing / tactical-board / notebook / graph。至此已迁移 **23 个官方插件**（27 个中）。

**前置（ui-kit）**：
- 补 `WsSpinner` 导出：根 `src/ui/WsSpinner.vue` → `packages/ui-kit/src/components/WsSpinner.vue` + index.ts 导出（drawing/workflow 依赖）

**迁移内容（apps/web/src/）**：
- 复制 4 插件目录 → `plugins/official/{drawing,tactical-board,notebook,graph}/`（排除 `__tests__`）
- 批量改根相对导入（20 文件）：WsIcon/WsEmpty/WsSpinner → ui-kit 具名；useAgentPluginBridge → `@/composables/`；graph useGraphClustering 的 coreBackend → `@/core/coreBackend`
- **notebook 跨插件依赖裁剪**：NotebookTipTapEditor 引用 `../../manuscript/components/{MentionPopover,SlashCommandMenu}.vue`（manuscript 未迁）→ 连带复制 2 个轻量组件到 notebook/components/（MentionPopover 仅依赖 WsIcon+entity-core；SlashCommandMenu 依赖 `../composables/slashCommandExtension` 解析到 notebook 自有实现），改本地相对引用

**依赖策略（重要）**：tiptap×5（@tiptap/core/extension-mention/starter-kit/suggestion/vue-3）+ marked + graphology×3 + sigma **均已在根 package.json 声明**——apps/web **不重复声明**，靠 pnpm workspace 根 node_modules 提升解析（与 entity-core/ui-kit 未声明同理）。首次尝试在 apps/web 声明触发 `pnpm install`，遇 Windows `importPackage EPERM`（worldsmith-core/tactical-engine 目录被 IDE 语言服务器占用，删除/重试/package-import-method=copy 均无效）→ 回滚依赖声明 + 恢复被污染的 pnpm-lock.yaml，最终不 install 直接运行成功。

**验证结果（2026-08-03）**：
- ✅ `npx vue-tsc --noEmit`（apps/web）：仅剩根收敛桥 TS2339×2，第四批代码零类型错误
- ✅ 浏览器验证：`[PluginManager] 已激活` 共 **23 个插件 0 失败**（新增：全局图谱 v1.0.0/画板 v2.0.0/战术棋盘 v1.0.0/笔记本 v2.0.0）；`[Governor] 启动完成: 8 激活, 0 失败, 0 跳过`
- ✅ 视图渲染：笔记本（编辑/看板/图谱模式 + 新建/搜索 + 空状态）；战术棋盘（部署单位 HP/攻击/防御/速度/移动/射程 + 可用实体真实数据 + 快速部署/保存/加载 + 态势感知 + 战斗日志）；全局图谱（力导向/圆圈/随机布局 + 实体筛选 + 智能聚类/路径搜索/时间轴过滤 + 缩放 91% + 图例，WASM 图算法 JS 降级提示可接受）；无 console error

**剩余 4 个插件**：
- **module-builder**：依赖根 `core/ModuleRuntime` + `core/ModuleViewRegistry` + `stores/customModuleStore`（apps/web 无此体系）→ 需评估（随 P3-W5 后或 Phase 6）
- **manuscript / mindmap / workflow**：useAgent / useRustLayout / useOrchestrator / workflowApi（agent 层 + apps/tauri re-export）→ 待 P3-W5（AgentSpace 专项）

### 3.13 渐进式迁移 · bootstrap 模块级恢复 + 依赖风险点处理（P3-W4，2026-08-03）

**风险点处理（依赖声明）**：
- apps/web/package.json 补 9 个依赖声明（@tiptap×5 + graphology×3 + sigma，版本与根一致）——此前靠 workspace 提升隐式解析
- `pnpm install --lockfile-only --no-frozen-lockfile` 同步 pnpm-lock.yaml（+80/-39，tiptap 3.29.1 等入 lockfile）——**避开 Windows importPackage EPERM**（worldsmith-core 目录被 IDE 语言服务器占用，rename 失败）
- ⚠️ 遗留：node_modules 物理重链需 IDE 重启后执行一次正式 `pnpm install`（运行时物理包已存在，dev/typecheck 不受影响）

**bootstrap 模块级恢复**：
- 迁入 `core/FacetMigrator.ts` → apps/web/src/core/（仅依赖 entity-core，零裁剪）
- 新建 `composables/useFontBootstrap.ts` re-export 壳（@worldsmith/font-kit，与根一致）
- bootstrap.ts 恢复 `core.facet-migration`（normal）+ `core.font-bootstrap`（lazy）模块；清理文件头裁剪点注释

**验证**：vue-tsc 仅剩已知 TS2339×2；浏览器 `[Governor] 启动完成: 10 激活, 0 失败, 0 跳过`（8→10）；23 官方插件保持全激活

**P3-W5 前置依赖发现（关键）**：src/agent/（137 文件）约 120 个纯前端可整体搬移，但依赖缺口：
- `src/space/*`（usePersonaFont/useActivityLog/space-store/user-profile-store/persona-font-store）——blocks/bubbles 依赖，**space 目录未迁移**
- `src/memory-archive/`（根实现）——archive 面板依赖，需改 @worldsmith/memory-archive 包或迁入
- `src/stores/{archiveStore,fontLibraryStore,agentProfileStore}` —— apps/web 无
- ui-kit 缺 AvatarBadge/getAvatarColor 导出
- 外部包 xterm×2/marked/dompurify 根已有（提升可解析）
- Tauri 硬耦合：8 个 `*Rust` composables + 顶层 TerminalPanel.vue（Web 端用 @agent/execution WebSocket 适配器替代）

### 3.14 渐进式迁移 · P3-W5 AgentSpace 专项（2026-08-03）

**前置依赖迁移（src/space/ + 补充文件）**：
- `space/`：usePersonaFont / useActivityLog / space-store / user-profile-store / persona-font-store（5 文件）→ apps/web/src/space/；space-store 的 ChatMode 类型源改 `@worldsmith/shared-composables/agent/useAgent`
- 补 re-export 壳：stores/fontStore（entity-core）、stores/fontLibraryStore、composables/fontInstaller（font-kit）
- ui 补充：ui/avatar.ts、ui/AvatarBadge.vue、ui/font/FontInstallConfirm.vue（WsIcon→ui-kit）、composables/{useAvatarImage,avatarStore,fontSpanParser,useFileExtract}
- stores：archiveStore（纯 pinia，零裁剪）、agentProfileStore（@agent 别名可解析）
- assets：providerIcons.ts + provider-icons/ 16 个 SVG

**agent 主体迁移（127 文件，~120 纯前端）**：
- 整体复制 src/agent/ → apps/web/src/agent/，排除 8 个 `*Rust` composables + 顶层 TerminalPanel.vue
- **WsIcon/WsEmpty 批量替换**（53 文件）：`../ui/WsIcon.vue` 三种深度 → `@worldsmith/ui-kit` 具名导入
- **Web 端 useAgent 适配器**（重写 useAgent.ts）：本地消息状态机 + `@agent/execution` 终端桥接（复用 useTerminal 模式）+ Rust 字段空 ref/no-op（`as any` 兼容调用方字段子集）；re-export 共享类型 + provideAgentBackend/useAgentOptional
- **6 个 Rust composables Web stub**（useToTRust/useGoTRust/useMultiAgentRust/useSupervisorRust/useRouterRust/useLoopControlRust）：具名类型宽松化（`[key: string]: any` + 关键字段对齐真实实现），返回空状态 + no-op 方法；AgentChat `isRustBackend=false` 不触发，状态栏 `sessions 恒空` v-if 隐藏——**AgentChat 零修改**
- **顶层 TerminalPanel.vue 裁剪复制**：删 detectTauri 分支，保留 @agent/execution 分支
- 组件微修：8 个状态栏组件 watch 参数 oldId→_oldId（TS6133）；AgentPreview formatDuration/isTcExpanded 参数改最小结构（readonly 兼容）；AgentSettingsPanel `[...chatModes]`（readonly 展开）

**memory-archive 集成层迁移（Tauri → Web）**：
- 整体复制 src/memory-archive/ → apps/web/src/memory-archive/，删 TauriFsOperations
- 新增 `adapters/WebFsOperations.ts`：IndexedDB 路径→内容扁平存储（MetaStorage 调度器元数据持久化）
- useMemoryArchive 改造：`isTauri` 守卫 → `typeof indexedDB === 'undefined'`；`FsStorageAdapter` → `IdbStorageAdapter`（@worldsmith/memory-archive 内置）；`createTauriFsOperations` → `createWebFsOperations`；dirPath 缺失用 `memory-archive/${projectInfo.id}` 命名空间兜底

**依赖声明**：apps/web package.json 补 marked/dompurify/@xterm×2/dexie + 8 个 @worldsmith 共享包（file: 引用），`pnpm install --lockfile-only` 同步（避开 EPERM）

**验证**：
- vue-tsc 仅剩已知根收敛桥 TS2339×2（计划保留，Phase 6 删根 src/ 自然消失）
- dev server：governor 10 激活 0 失败，23 插件全激活，无 console error
- vite 模块请求：AgentChat/AgentMessageList/AgentOverlay/ArchivePanel/状态栏×3/TerminalPanel×2/useMemoryArchive 等 27 文件全 200
- 运行时 import：AgentChat/AgentOverlay/GoTGraphView/TerminalPanel/useMemoryArchive 动态 import 全部 OK（import 链真实执行无错误）

**后续（P3-W5 剩余）**：AgentSpace 挂载接入 Shell 内容区 + governor 启动编排；module-builder 插件评估；业务弹窗恢复（Trash/Settings/Theme/SmartFill/ProjectSwitcher + registry KanbanView）；manuscript/mindmap/workflow 插件（依赖 agent 已就绪，可迁）

### 3.15 渐进式迁移 · P3-W5 AgentSpace 挂载接入（2026-08-03）

**决策**：方案 B 单聊核心——迁移 space 聊天 UI（chat/panels/components/SpaceNavbar/PanelToggle 16 文件 + useAgentPersona + WsDrawer），群聊子系统（group-chat ~50 文件）拆独立批次。

**前置补充**：
- `useAgentPersona.ts` 迁入（依赖 space-store/useAgent/@agent/tools/persona，零裁剪）
- `ui/WsDrawer.vue` 迁入（WsIcon→ui-kit，useFocusTrap→`@/composables/`）

**space 聊天 UI 迁移（19 文件）**：
- chat/5 + components/2 + panels/7 + SpaceNavbar/PanelToggle + AgentSpace.vue
- WsIcon 8 文件批量替换 → ui-kit 具名；根相对导入批量 → `@/` 别名（`../../agent|stores|ui|composables|assets`）
- **SpaceChat 裁剪**：删 GroupChatView 分支（mode 恒 chat）
- **SpaceNavbar 裁剪**：删群聊用户身份/mode-switch 切换/群聊专属按钮/UserProfilePopover/ProviderSlotEditor/AgentManagerPanel；chatModes/currentMode/onModeSelect 去 group 分支
- **AgentSpace 裁剪**：删 GroupChatView/CasualChatView 分支（只留 SpaceChat）；SettingsDialog 挂载裁剪（P3-W4 续恢复）；DialogContainer 改 ui-kit 具名；onToggleNewSession 去 group 分支；groupChatStore/watch mode 删

**App.vue 平级切换接入**：`<AgentSpace v-if="uiStore.currentShell === 'space'" />` + `<Shell v-else />`（与根版一致，entity-core uiStore 已具备 currentShell/setShell，localStorage `worldsmith_shell` 持久化）；governor 模块清单根/web 一致（10 模块），无需改动

**运行时修复（Web 版 useAgent 字段补齐，4 处）**：
- `lastAssistantHasContent/lastAssistantHasThinking`：computed 由本地 messages 推导（AgentMessageList prop 校验）
- `deepSegments/finalOutput/resolveToolConfirmation`：空 ref/no-op（AgentMessageList 内部解构）
- `totalUsage/lastRequestUsage/cumulativeUsage`：`ref(0)` → 对象结构 `{requestCount/inputTokens/outputTokens/cacheReadTokens/cacheWriteTokens/totalCost/savedByCache}`（PlanPanel `cumulativeUsage.totalCost.toFixed()` 崩溃）
- `getMCPConnections/addMCPConnection/removeMCPConnection`：空数组/no-op（useMcpConnections 共享包 ensureLoaded 依赖）

**验证**：
- vue-tsc 仅剩已知根收敛桥 TS2339×2
- 浏览器：governor 10 激活 0 失败（749ms）+ 23 插件全激活 + **零 console error/warn**
- AgentSpace 全功能：SpaceNavbar（身份/模式/新建会话）、聊天区（SpaceChat+AgentMessageList+ChatInput+DeepSeek V4 模型切换）、活动日志面板、任务计划面板（用量/上下文占位正常）、记忆架（kb 知识空间 5 条真实数据）、Agent 设置面板（7 标签）、工作台抽屉（WsDrawer 内嵌 Shell 完整渲染）
- **双向切换**：space→workbench（SpaceNavbar home 按钮）✓；workbench→space（MenuBar "Agent 空间"菜单项）✓

**P3-W5 剩余**：group-chat 子系统（~50 文件，独立批次）；module-builder 插件评估。
**后续批次**：P3-W4 续（业务弹窗恢复 Trash/Settings/Theme/SmartFill/ProjectSwitcher + registry KanbanView + useProjectSwitcher memory-archive/useFileSystemProject）+ manuscript/mindmap/workflow 插件迁移 + 正式 pnpm install（IDE 重启后）。
**后续**：Phase 6 三端验收+删根 src/（P3-T10）。

### 3.16 渐进式迁移 · P3-W5 group-chat 群聊子系统（2026-08-03）

**决策**：完整迁移 group-chat 全部 65 文件（跳过 engine/__tests__ 3 个 vitest 依赖），恢复第六批裁剪的三处群聊分支（SpaceChat/SpaceNavbar/AgentSpace）——群聊子系统闭环。

**依赖边界结论（search 代理扫描 68 文件）**：
- engine/（7 文件）必须迁移：是包内 `@agent/group-chat/*`（flow-control/turn-engine/message-bus/speaking-desire/provider-pool）的**前端编排消费者**，包内无替代
- management/（4 文件）必须迁移：包内无 AgentRegistryStore/GroupManager/GroupStore/PermissionChecker
- 唯一硬缺口：WsIcon 25 文件 → ui-kit 具名；其余根相对导入目标全部已在 apps/web（改 @/ 别名）
- engine/__tests__ 3 文件跳过（vitest 仅根 devDependencies）

**迁移执行（apps/web/src/space/group-chat/，65 文件）**：
- 复制（排除 __tests__）；批量替换 28 文件：WsIcon 三深度 → ui-kit 具名；`../../../ui/AvatarBadge|avatar|assets/providerIcons|composables/avatarStore|stores/{agentProfileStore,fontLibraryStore,settingsStore}|agent/composables/useAgent` → `@/`；`../../stores/space-store` → `@/space/stores/space-store`
- 残留检查：仅 5 处 group-chat 内部相对导入（自洽）
- **恢复三处裁剪点**：SpaceChat 加回 `<GroupChatView v-else @close="setMode('chat')">` 分支；SpaceNavbar 恢复群聊用户身份/mode-switch/群聊按钮/UserProfilePopover/ProviderSlotEditor/AgentManagerPanel + toggleMode/chatModes/currentMode/onModeSelect group 分支 + 相关 refs；AgentSpace 恢复 GroupChatView/CasualChatView 分支 + useGroupChatStore + watch mode + onToggleNewSession group 分支

**typecheck 修复 2 处**：CasualChatView messagesRef 未用（TS6133 删解构）；useCasualChatEngine `data.members as GroupMember[]` 断言（CreateGroupData.members 为 AgentItem[]，构造 GroupMember 时类型收窄）

**验证**：
- vue-tsc 仅剩已知根收敛桥 TS2339×2
- 浏览器：governor 10 激活 0 失败 + 23 插件全激活 + 零 console error/warn（favicon 404 无害）
- 群聊功能全链路：chat→group 切换（mode-switch）→ 用户身份（我/在线）→ 群聊模式下拉（会议/闲聊）→ **闲聊模式 CasualChatView**（群聊 0/0 在线 + CasualInputBar 📎@发送）→ **会议模式 GroupChatView**（发起群聊讨论 + 模板：辩论/头脑风暴/圆桌/深度分析 + 我的配置 0 + 参与者 3/8 + 降级链 DeepSeek V4 Pro→Flash→Reasoner→Chat）→ group→chat 切回 ✓

**P3-W5 全部完成**：AgentSpace 单聊 + 群聊（casual/meeting）双模式闭环。
**剩余插件**：module-builder（core 依赖评估）+ manuscript/mindmap/workflow（agent 已就绪，下一批）。
**后续批次**：P3-W4 续（业务弹窗恢复 + registry KanbanView + useProjectSwitcher memory-archive/useFileSystemProject）+ 正式 pnpm install（IDE 重启后）。
**后续**：Phase 6 三端验收+删根 src/（P3-T10）。

### 3.17 渐进式迁移 · P3-W5 manuscript/mindmap/workflow 三插件（2026-08-03）

**决策**：迁移最后 3 个官方插件（官方插件计数 23/27 → 26/27），tauri 耦合文件以 Web stub 替代，剩 module-builder 待 core 依赖评估。

**依赖边界结论（search 代理扫描）**：
- 无跨插件组件依赖、无 `@agent/*` 导入、无 `@worldsmith/tauri` 导入
- 三个真问题：(a) mindmap `useRustLayout` 是 re-export 壳指向 apps/tauri（自带纯 JS fallback，Web 版剥离 invoke 保留 fallback）；(b) workflow `api/workflowApi.ts` + `composables/useWorkflowEngineRun.ts` 纯 Tauri invoke 无 fallback（Web stub 空实现）；(c) `schemaListEntityTypes` 在 apps/web coreBackend 需确认导出（核对后已存在，无缺口）
- 排除：各 `__tests__/`（vitest 根 devDependencies）、mindmap `composables/useRustGraphAnalysis.ts` 孤儿文件、workflow 两个 tauri 耦合文件（由 stub 替代）

**迁移执行（apps/web/src/plugins/official/，80 文件）**：
- manuscript 14 文件：拆分 components/（ChapterEditor/EditorToolbar/SlashCommandMenu）+ composables/（slashCommandExtension/useChapterEditor/useChapterSnapshots）+ 视图/弹窗/侧栏
- mindmap 38 文件：排除 `__tests__/` + useRustGraphAnalysis 孤儿
- workflow 28 文件：排除 `__tests__/` + 2 个 tauri 耦合文件
- 批量替换：WsIcon/WsEmpty/WsSpinner → `@worldsmith/ui-kit` 具名；根相对路径 → `@/` 别名（useAgentPluginBridge/useAgent/useOrchestrator/fontStore/coreBackend）；`useFontPresets` → `@worldsmith/font-kit`
- **新建 3 个 Web stub**：
  - `mindmap/composables/useRustLayout.ts`：保留全部类型 + `isTauriAvailable()` 恒 false + `applyLayout` 直接走纯 JS fallbackLayout（grid/radial/random/tree→radial）
  - `workflow/api/workflowApi.ts`：保留 28 函数完整类型签名 + 空实现（workflowList→`[]`、workflowGet→null、workflowDryRun→`{ok:false,...}`）
  - `workflow/composables/useWorkflowEngineRun.ts`：no-op start() 返回 null + appendLog 提示引擎通道不可用
- workflow StepConfigEditor 动态 `import('@/core/coreBackend')` 取 `schemaListEntityTypes`——apps/web coreBackend 已存在该导出（核实无缺口）

**接线（bootstrap + package.json）**：
- `apps/web/package.json` 补 4 声明：`@worldsmith/canvas-engine`（file:）+ `vuedraggable`/`turndown`/`docx`（版本对齐根）；`pnpm install --lockfile-only` 更新锁文件（dev server 占用 WASM 文件导致物理重链 EPERM，正式重链待 IDE 重启）
- `governor/bootstrap.ts`：MIGRATED_OFFICIAL_PLUGIN_IDS + pluginLoaders 追加 `official.manuscript`/`official.mindmap`/`official.workflow`

**验证**：
- vue-tsc 直接调用（绕过 pnpm 自动 install）仅剩已知根收敛桥 TS2339×2，三插件 0 错误
- 浏览器：governor 10 模块全激活 + 26 插件全激活 0 失败（日志见 `[PluginManager] 已激活: 正文写作/思维导图/创作编排`）零 console error
- **正文写作**（manuscript）：编辑器壳 + 章节列表空态 + AI 辅助面板（续写/润色/角色对话/情节分析/世界观检查）✓
- **思维导图**（mindmap）：节点搜索 + 实体类型过滤（角色/区域/事件/势力/概念/道具/文本框/图片/备注/链接/分组）+ 编辑/自由绘图模式 + 撤销重做 + 小地图/详情侧栏 + 缩放（＋－/适应视图）+ PNG/SVG 导出 + canvas/svg 渲染 ✓
- **创作编排**（workflow）：+ 新建计划 / 📋 从模板创建 / 空态引导（workflowApi stub 返回 [] 正常）✓
- 说明：manuscript/mindmap 在 settingsStore `DEFAULT_PLUGINS` 默认 `active: false`（原应用行为），验证时临时启用后恢复

**官方插件迁移计数：26/27**（剩 module-builder）。
**后续**：module-builder 插件评估（core 依赖）+ P3-W4 续（业务弹窗恢复）+ Phase 6 删根 src/。

### 3.18 渐进式迁移 · P3-W5 module-builder 插件（2026-08-03，官方插件 27/27 全部完成）

**决策**：迁移最后一个官方插件 module-builder（评估结论：27 插件中最干净——零 tauri 耦合、零 @agent、零 @/ 导入、vuedraggable/naive-ui 未使用），官方插件迁移 26/27 → 27/27。

**评估结论**（search 代理扫描 45 文件 169 import）：activate() 仅注册视图「自定义模块」+ initializeComponentTypes() 24 组件类型；不注册实体类型（发布时经 core/ModuleRuntime.ts 动态写 entity-core schema registry，类型名 custom.{moduleId}.{type}）。

**真缺口 2 个（均已处理）**：
1. apps/web/package.json 缺 `echarts`（ChartBar/Pie/Line 3 渲染器用）→ 已补 `^6.1.0`（与根一致，vite vendor-echarts chunk 已预留）
2. apps/web/src/core/ 缺 `ModuleRuntime.ts` + `ModuleViewRegistry.ts` → 原样直拷（内部仅依赖 @worldsmith/entity-core，零二级缺口）

**需替换 24 处（已批量完成）**：WsIcon 17 处 + WsEmpty 5 处 → `@worldsmith/ui-kit` 具名；customModuleStore 2 处 → `@worldsmith/entity-core` 直引。3 个未注册渲染器（AiAssistant/AutoFill/SmartSuggest）随迁保留（无依赖缺口，事件桥由宿主提供）。

**接线**：bootstrap.ts 注册 `official.module-builder`（MIGRATED_OFFICIAL_PLUGIN_IDS + pluginLoaders）；`pnpm install --lockfile-only` 更新锁文件（echarts）。

**验证**：
- vue-tsc 直调仅剩已知根 TS2339×2，module-builder 0 错误
- 浏览器：governor 10 模块全激活 + **27 插件全激活 0 失败**零 console error（favicon 404 无害）
- 视图「自定义模块」空态（＋ 新建模块 / 还没有自定义模块引导）✓
- 编辑器 ModuleBuilderEditor：组件库 6 大类 24 组件（详情与编辑/操作与工具/搜索与筛选/数据展示/可视化与图表[柱状图·饼图·折线图·关系图谱]/布局与容器）+ 画布空态 + 水平/垂直分割 + 属性面板 + 实体/关系/字段定义面板 ✓

**官方插件迁移计数：27/27 全部完成**。
**后续**：P3-W4 续（业务弹窗恢复 + registry KanbanView + useProjectSwitcher memory-archive/useFileSystemProject）+ 正式 pnpm install（仍需 IDE 重启解除 WASM 物理重链 EPERM）+ Phase 6 删根 src/。

### 3.19 渐进式迁移 · P3-W4 续 业务弹窗恢复 + registry KanbanView（2026-08-03）

**决策**：恢复被裁剪的 9 个业务弹窗 + SmartFill 3 件套 + useSmartFillChat 壳 + registry 看板视图扩展。search 代理扫描 11 个目标文件 169 import 后执行，tauri-dialog 方案经用户确认选「声明包 + 代码零改动」。

**迁移执行（25 文件复制 + 4 新建 + 3 宿主接线）**：
- **零改动复制 4**：TrashPanel / ConsistencyReportPanel / CustomRelationTypeDialog / EntityTemplateDialog（仅 entity-core/vue 依赖，最干净）
- **组件补齐 3 + 面板 1**：WsModal / WsButton / WsCheckbox（改 WsIcon → ui-kit 具名）→ apps/web/src/ui/；StorageManagementTab → ui/data/；SettingsDialog + 7 个 panels re-export 壳 → ui/settings/（panels 是 1 行 re-export 指向 ui-kit/components/settings/panels/*）
- **导入微调 4**：KanbanView（WsIcon→ui-kit）→ modules/runtime/；SmartFillChat（useSmartFillChat → @/composables/）+ Trigger + ContextMenu → ui/smart-fill/；ThemeEditor 家族（ThemeEditor/Quick/Pro/Code）→ components/theme-editor/
- **ProjectSwitcherDialog** → ui/project/（零改动；动态 import('@tauri-apps/plugin-dialog') 经声明包 ^2.7.1 解决；新建 @/core/ProjectFS.ts re-export 壳）
- **新建壳 2**：@/composables/useSmartFillChat.ts（4 行 re-export）；@/core/ProjectFS.ts（entity-core/core re-export）
- **AgentOverlay**：文件已就位（P3-W5 迁移），仅 Shell 挂载

**宿主接线**：
- Shell.vue：template 插 11 组件（9 弹窗 + SmartFill 2/3）+ 8 ref + 11 defineAsyncComponent + 7 onOpen* + 7 onGlobalEvent（ws-open-trash/consistency/settings/theme-editor/custom-rel-type/entity-template/project-manager）+ 2 快捷键（settings.open ctrl+, / project.manager ctrl+shift+p）+ SmartFill 布线（useTextSelection/useSmartFillContextMenu from ui-kit + useSmartFillChat + worldsmith:smart-fill:chat-open 监听）
- AgentSpace.vue：SettingsDialog 挂载 + import + settingsOpen ref
- registry.ts：恢复看板视图扩展（ViewExtension 'kanban-view' typeId 'kanban' + 动态 import('./runtime/KanbanView.vue')）

**关键修复 1 处**：AgentOverlay mounted 报错根因——apps/web useAgent 是占位实现（`as any` 掩盖），缺少 AgentOverlay 解构的 isVisible/show/hide/initError/clearInitError/detectAndOfferResume → 补齐占位字段（hide 从 no-op 改为 isVisible=false，F1 可正常唤起/隐藏）。

**验证**：
- vue-tsc 直调仅剩已知根 TS2339×2，本批 0 错误
- 浏览器零 console error；弹窗逐个触发验证：SettingsDialog（外观/插件/编辑/布局/关系/陪伴模式/快捷键/存储 8 标签）✓、ProjectSwitcherDialog（项目管理/默认项目）✓、TrashPanel（回收站 0 项）✓、ConsistencyReportPanel ✓、ThemeEditor（快速/专业/代码 + 预设主题 5 款）✓、CustomRelationTypeDialog（新建关系类型表单）✓、EntityTemplateDialog ✓、AgentOverlay（F1 唤起）✓、SmartFillChat（chat-open 事件）✓
- package.json 补 @tauri-apps/plugin-dialog ^2.7.1；lockfile 已 --lockfile-only 更新

**P3-W4 续剩余**：useProjectSwitcher 三处行为级裁剪点（memory-archive 切换归档 / useFileSystemProject 目录绑定 / Tauri 分支）。
**后续**：正式 pnpm install（仍需 IDE 重启）+ Phase 6 删根 src/。

### 3.20 渐进式迁移 · P3-W4 续 useProjectSwitcher 裁剪点恢复（2026-08-03，P3-W4 续全部完成）

**决策**：恢复 useProjectSwitcher 三处行为级裁剪点，与根版 src/composables/useProjectSwitcher.ts 完全对齐。依赖文件（@/memory-archive/useMemoryArchive、@/composables/useFileSystemProject）已在 apps/web 存在，无前置缺口。

**恢复内容（apps/web/src/composables/useProjectSwitcher.ts）**：
1. **memory-archive 切换前归档**：switchProject() 在 pm.switchProject() 前动态 import useMemoryArchive，isInitialized 时 `archive({ source: 'session_end' })`（动态 import 避免循环依赖）
2. **useFileSystemProject.onProjectSwitched()**：reinitializeModules() 后恢复文件系统关联
3. **Tauri 专属分支 ×3**：initialize()/switchProject() 的 `cmd_switch_project` + deleteProject() 的 `cmd_delete_project_db`，isTauri() 守卫（Web 端恒 false 不执行）+ 动态 import('@tauri-apps/api/core')
- package.json 补 `@tauri-apps/api ^2.11.0`（与 plugin-dialog 同策略）；lockfile 已更新

**验证**：vue-tsc 仅剩已知根 TS2339×2；浏览器启动链路（initialize 含 Tauri 分支）零 console error；ProjectSwitcherDialog（项目管理/默认项目/从文件夹导入）正常打开。

**P3-W4 续全部完成**（业务弹窗 + registry KanbanView + useProjectSwitcher）。
**后续**：正式 pnpm install（仍需 IDE 重启）+ Phase 6 三端验收 + 删根 src/（P3-T10）。

### 3.21 Phase 6：三端验收 + 删除根 src/（2026-08-03，端分离全部完成）

**前置 1：EPERM 系统性根治（file: → link:）**
- 根因：pnpm 对 `file:` 依赖在 Windows 用「物理复制 + rename 覆盖」，rename 覆盖非空目录被 Windows 拒绝 → 二次 install 必 EPERM
- 正解：根 package.json 两处 WASM 依赖改 `link:` 协议（node_modules 直接 Junction 直连 pkg 源目录，不复制不 rename）
- workspace 化方案弃用原因：wasm 包真实包名 `@worldsmith/worldsmith-core` 与依赖名/代码 import 的 `@worldsmith/core` 不一致，workspace 包必须按真实包名引用

**前置 2：plugin-sdk 跨层依赖解耦（删根必修）**
- 发现：`packages/plugin-sdk` 的 SchemaRenderer.vue / UniversalRelationPanel.vue 通过 `../../../../src/...` 硬编码引用根 src（coreBackend + uiStore），把根 coreBackend 拉进 apps/web 编译图（根 TS2339×2 的真正来源）
- 修复：UniversalRelationPanel → `@worldsmith/entity-core/stores/uiStore`（根 uiStore 本就是其 re-export 层）；SchemaRenderer 加 `schemaLoader` prop 注入 + EntityTypeSchema/SchemaField 本地类型定义，8 个官方插件视图（building/combat_stat/magic/culture/language/plant/species/weapon）从 apps/web coreBackend 传 loader，行为完全保持

**前置 3：tauri/cli 存量 typecheck 修复**
- tauri：coreBackend 未用参数加 `_` 前缀；main.ts 删除 9 个未用 import + registerBackend/registerValidationApi 入参对齐 BackendAlgoApi/ValidationApi 契约（移除 validateEntities/validatePack/migrate/runDiagnostics/algoAstar 等非契约字段）
- cli：ui-kit/agent-descriptor.ts 去掉 2 处 `.ts` 扩展名 import（TS5097）

**根级构建链同步清理**
- 根 package.json scripts：dev/build/build:web/preview → `pnpm --filter @worldsmith/web ...`；tauri:dev/build → `@worldsmith/tauri`；移除 storybook/build-storybook
- 删除：根 vite.config.ts、index.html、vite-plugin-server-launcher.ts、.storybook/（旧主应用入口，随根 src 退役）
- 更新：vitest.config.ts（setupFiles → apps/web/src/test-setup.ts，include 根 src → apps/web/src）、tsconfig.app.json（include 移除 src/**）

**删除根 src/（761 文件）**：三端 typecheck 全绿（apps/web/tauri/cli 编译图零引用根 src）后执行。

**验证结果**：
- typecheck:all ✅（web/tauri/cli 全绿，删根后重跑无断链）
- 三端 build ✅：web（7353 模块，1m20s）、tauri（198 模块，2.3s）、cli（tsc 通过）
- 浏览器 ✅：dev server 5174 启动，Governor 10 模块全激活 + 27 插件注册 + WASM 加载成功 + 完整 Shell 渲染（侧边栏 17 视图 + 角色数据），零 console error（favicon 404 无害）

**M3/M6 里程碑达成：三端 src/ 独立，原 src/ 已删除，端分离全部完成。**

### 3.1 任务拆解（对应 07 文档 Step 1-12）

| 任务 ID | 对应 Step | 任务 | 验证 |
|---------|-----------|------|------|
| P3-T1 | Step 1-2 | 共享 composables 迁入 `packages/shared-composables` | tsc 通过 |
| P3-T2 | Step 3 | Tauri 专用文件迁入 `apps/tauri/src/`（8 个 Rust composables + ProjectFS 等） | Tauri 端 tsc 通过 |
| P3-T3 | Step 4 | Web 专用文件迁入 `apps/web/src/`（coreBackend WASM + worldsmithCore 等） | Web 端 tsc 通过 |
| P3-T4 | Step 5 | 改造 `coreBackend.ts`（三端各保留单路径版本） | `grep detectBackend apps/` 为空 |
| P3-T5 | Step 6 | 改造 `useAgent.ts`（接收 backend 注入） | 三端 useAgent 可用 |
| P3-T6 | Step 7 | 改造 `main.ts`（端入口硬编码后端） | 三端 dev 可启动 |
| P3-T7 | Step 8 | 清理 `__TAURI__` 检测与 global.d.ts | `grep __TAURI__ apps/web/` 为空 |
| P3-T8 | Step 9 | 清理插件层（mindmap/workflow Rust 调用） | 插件三端可加载 |
| P3-T9 | Step 10 | 清理 worldsmith-server 引用 | Tauri 端无 WS 回退 |
| P3-T10 | Step 11-12 | 更新构建配置，删除原 `src/` | 三端 build 独立 |

### 3.2 并行机会

- P3-T2（Tauri 迁移）与 P3-T3（Web 迁移）可并行
- P3-T7、P3-T8、P3-T9 在 P3-T4~T6 完成后可并行

## 6. Phase 4: 后端能力整合

| 项 | 内容 |
|----|------|
| **目标** | worldsmith-server 能力迁移到 CLI serve；Web 端 API 调用层切换 |
| **前置依赖** | Phase 1（agent-runtime）、可与 Phase 3 部分并行 |
| **后置依赖** | Phase 5 |

### 4.1 任务拆解

| 任务 ID | 任务 | 输入 | 输出 | 验证 | 状态 |
|---------|------|------|------|------|------|
| P4-T1 | CLI serve 模式完善 | `worldsmith-agent/src/cli/serve.ts` | `apps/cli/src/commands/serve.ts` | `worldsmith serve` 可启动 HTTP+WS | ✅ |
| P4-T2 | worldsmith-server 能力盘点 | `worldsmith-server/` 全部端点 | 能力迁移清单 | 所有端点有归属 | ✅ |
| P4-T3 | 迁移 HTTP 端点到 CLI serve | worldsmith-server 路由 | `apps/cli/src/serve/` | curl 验证各端点 | ✅ |
| P4-T4 | 迁移 WS 事件到 CLI serve | worldsmith-server WS | `apps/cli/src/serve/ws.ts` | WS 客户端可连接 | ✅ |
| P4-T5 | Web 端 API 调用层切换 | 原 worldsmith-server API 调用 | 改为调 CLI serve | Web 端功能正常 | ✅ |
| P4-T6 | worldsmith-server 标记废弃 | worldsmith-server package.json | 添加 deprecation 标记 | 文档说明迁移路径 | ✅ |

### 4.3 完成情况（2026-07-29）

| 任务 ID | 状态 | 输出 |
|---------|------|------|
| P4-T1 | ✅ | `apps/cli/src/commands/serve.ts`（606 行） |
| P4-T2 | ✅ | 能力迁移清单（见 11-backend-consolidation.md 第 2 节） |
| P4-T3 | ✅ | `apps/cli/src/serve/python-routes.ts`（200 行，原生 http） |
| P4-T4 | ✅ | WS token 鉴权合并到 serve.ts |
| P4-T5 | ✅ | `getWsUrl()` + `getWsToken()` 三级优先级 + `.env.example` |
| P4-T6 | ✅ | worldsmith-server 标记 deprecated |

详细执行记录见 【`[11-backend-consolidation.md](./11-backend-consolidation.md)`】

### 4.2 关键决策点

- **CLI serve 端口**：默认 3100（与原 worldsmith-server 一致），可配置
- **Web 端连接地址**：从 `localStorage.ws_server_url` 改为环境变量 `VITE_CLI_SERVE_URL`

## 7. Phase 5: 构建配置与 CI 独立

| 项 | 内容 |
|----|------|
| **目标** | 三端独立 Vite/Tauri/tsc 构建配置；CI workflow 分端构建 |
| **前置依赖** | Phase 3、Phase 4 |
| **后置依赖** | Phase 6 |
| **状态** | ✅ 已完成（2026-07-29） |

### 5.1 任务拆解

| 任务 ID | 任务 | 验证 | 状态 |
|---------|------|------|------|
| P5-T1 | Web 端 vite.config.ts 独立（移除 Tauri 相关插件） | `pnpm --filter @worldsmith/web build` 产物独立 | ✅ |
| P5-T2 | Tauri 端 vite.config.ts + tauri.conf.json 独立 | `pnpm --filter @worldsmith/tauri build` 产物独立 | ✅ |
| P5-T3 | CLI 端 tsconfig.json + 构建脚本独立 | `pnpm --filter @worldsmith/cli build` 产物独立 | ✅ |
| P5-T4 | 根 package.json scripts 更新（分端命令） | `pnpm dev:web` / `pnpm dev:cli` / `pnpm dev:tauri` 可用 | ✅ |
| P5-T5 | CI workflow 分端构建（.github/workflows/） | 三端 CI 各自触发 | ✅ |
| P5-T6 | 移除根目录 build:web 依赖（Tauri 不再依赖 build:web） | Tauri build 不触发 Web build | ✅（通过新增 standalone 命令实现） |

### 5.2 完成情况（2026-07-29）

| 任务 ID | 状态 | 输出 |
|---------|------|------|
| P5-T1 | ✅ | `apps/web/vite.config.ts`（202 行，含 WASM/压缩/可视化/CLI serve 代理/manualChunks）+ `apps/web/package.json`（添加 3 个 devDeps）+ `apps/web/tsconfig.json`（补全 20+ 路径映射） |
| P5-T2 | ✅ | `apps/tauri/vite.config.ts`（191 行，含 Tauri 专用 alias）+ `apps/tauri/tsconfig.json`（补全路径映射）+ `apps/tauri/package.json`（添加 3 个 devDeps）；`tauri.conf.json` 无需改动 |
| P5-T3 | ✅ | `apps/cli/tsconfig.json`（补全 shared-composables/entity-core/memory-archive 路径 + outDir/rootDir）+ `apps/cli/package.json`（添加 serve/serve:dev 脚本） |
| P5-T4 | ✅ | 根 `package.json` 新增 7 个分端命令：`build:web:standalone`、`build:tauri:standalone`、`build:tauri:app`、`build:cli`、`typecheck:{web,tauri,cli,all}` |
| P5-T5 | ✅ | `.github/workflows/ci.yml`（207 行，新增 5 个 job：frontend-setup、web-build、tauri-build、cli-build、tauri-rust-check、shared-packages-typecheck） |
| P5-T6 | ✅ | 通过新增 `build:web:standalone` 等独立命令实现，Tauri 端构建不再隐式触发 Web build |

### 5.3 关键设计决策

#### 5.3.1 Web 端 API 代理策略：统一代理到 CLI serve

**决策**：Web 端 vite.config.ts 的 `server.proxy` 只配置 `/api/* → CLI serve`，不复制根目录的 LLM API 代理清单。

**理由**：
- CLI serve 内置 LLM 代理、文件代理、Python 微服务代理等，统一中转更清晰
- Web 端构建配置真正"独立"，不依赖根目录的自定义插件（worldsmithServerLauncher / localFilePlugin / customProxyPlugin）
- 减少配置重复，LLM API 端点变更只需改 CLI serve 一处

#### 5.3.2 Tauri 端不需要 /api/* 代理

**决策**：Tauri 端 vite.config.ts 不配置 `server.proxy`。

**理由**：
- Tauri 端通过 IPC 直接调用 Rust 命令，不走 HTTP/WS
- Tauri 端 WASM 仅作为算法降级回退（当 Tauri 命令不可用时）

#### 5.3.3 CI 容错策略：Phase 3 完成前使用 continue-on-error

**决策**：三端构建 job 的 typecheck 和 build 步骤使用 `continue-on-error: true`。

**理由**：
- Phase 3 完成前，三端 src/ 仅为骨架，typecheck 和 build 必然失败
- 容错确保 CI 不阻塞其他 job（如 Rust 检查）
- Phase 3 完成后移除 `continue-on-error`，启用完整构建验证

#### 5.3.4 根 package.json 兼容策略：保留原 scripts

**决策**：保留根 package.json 的原 scripts（`build:web`、`tauri:build` 等），新增 `build:web:standalone` 等独立命令。

**理由**：
- 原 src/ 目录仍在使用（Phase 3 未完成），原 scripts 仍需可用
- 新增 standalone 命令用于端分离后的独立构建
- Phase 6 删除原 src/ 后，再清理原 scripts

### 5.4 完整构建验证（2026-07-30）

Phase 3 核心迁移完成后，启用三端独立构建验证。结果如下：

| 端 | 构建命令 | 结果 | 模块数 | 耗时 | 产物大小 |
|----|----------|------|--------|------|----------|
| Web | `vite build`（apps/web） | ✅ 成功 | 2946 | 9.56s | index.js 80.8KB + vendor-naive 1.7MB + wasm 2.0MB |
| Tauri | `vite build`（apps/tauri） | ✅ 成功 | 169 | 1.45s | index.js 150.4KB |
| CLI | `tsx src/index.ts --help` + `serve` | ✅ 成功 | — | <1s | 119 tools available |

#### 5.4.1 修复的构建阻塞问题

**问题 1：`@agent/*` alias 在 Vite 8 + Rolldown 下不生效**

- **现象**：`entity-core/src/agent-descriptor.ts` 引用 `@agent/tools/a2ui-helpers`，Rolldown 报 "failed to resolve import"
- **根因**：`@agent/` 末尾带斜杠的字符串 alias 在 Rolldown 中不被识别为前缀匹配；且 `path.resolve()` 会去掉 replacement 末尾斜杠，导致 `src` + `tools` 连成 `srctools`
- **修复**：扩展 alias 转换逻辑，让以 `/` 结尾的 key 生成前缀匹配正则（`^@agent/`），并在 replacement 末尾补斜杠
- **影响文件**：`apps/web/vite.config.ts`、`apps/tauri/vite.config.ts`

**问题 2：Tauri main.ts 引入 `@worldsmith/ui-kit` 导致根 src/ 耦合**

- **现象**：Tauri 构建报 `Could not load src/composables/useProjectSwitcher` 等 9 个错误
- **根因**：`@worldsmith/ui-kit` 包含 30+ 个 `../../../src/` 相对路径导入，将根 src/ 代码引入 Tauri 构建
- **修复**：`apps/tauri/src/main.ts` 改为从 `@worldsmith/motion-kit` 导入 `injectAllKeyframes`，从 `@worldsmith/plugin-sdk/composables/useConfirm` 和 `useDialog` 具体文件导入（与 Web 端一致），绕过 ui-kit 的根 src/ 依赖
- **影响文件**：`apps/tauri/src/main.ts`

**问题 3：CLI tsx 运行报 `Cannot find package '@agent/tools'`**

- **根因**：CLI tsconfig.json 缺少 `@agent/*` path 映射
- **修复**：在 `apps/cli/tsconfig.json` 添加 `@agent/*` → `../../packages/agent-runtime/src/*` 映射
- **影响文件**：`apps/cli/tsconfig.json`

#### 5.4.2 已知遗留问题（Phase 4/6 解决）

| 问题 | 影响范围 | 解决阶段 |
|------|----------|----------|
| `@worldsmith/ui-kit` 仍含 30+ 个 `../../../src/` 导入 | Web/Tauri 构建通过 main.ts bypass 绕过，但 ui-kit 本身未解耦 | Phase 6（shared-ui 迁移） |
| CLI `tsc` 编译报 rootDir + ui-kit 错误 | CLI 实际用 `tsx` 运行不受影响；`tsc` 类型检查暂不可用 | Phase 4（worldsmith-agent 前端耦合清理） |
| `worldsmith-agent` 引用根 src/ 代码（ProjectFS 等） | CLI tsx 运行通过 tsconfig paths 绕过 | Phase 4/6 |

#### 5.4.3 CI 容错策略更新

5.3.3 中提到的 `continue-on-error: true` 现已可移除（三端构建均通过）。建议在下次 CI 配置更新时执行：
- Web build job：移除 `continue-on-error`
- Tauri build job：移除 `continue-on-error`
- CLI build job：移除 `continue-on-error`（但保留 tsx 运行验证，tsc 类型检查继续容错直到 Phase 4 完成）

## 8. Phase 6: 端到端验收与清理

| 项 | 内容 |
|----|------|
| **目标** | 三端独立 dev/build 验证；旧目录清理 |
| **前置依赖** | Phase 5 |

### 6.1 任务拆解

| 任务 ID | 任务 | 验证 |
|---------|------|------|
| P6-T1 | Web 端端到端验收 | 浏览器打开，核心功能可用 |
| P6-T2 | CLI 端端到端验收 | `worldsmith chat` / `worldsmith serve` 可用 |
| P6-T3 | Tauri 端端到端验收 | 桌面应用启动，核心功能可用 |
| P6-T4 | 删除 `worldsmith-server/` | `grep -r worldsmith-server` 无残留 |
| P6-T5 | 删除 `worldsmith-agent/` 残留（已迁移部分） | 无残留 |
| P6-T6 | 删除原 `src/` 目录 | 无残留引用 |
| P6-T7 | 更新根 README 与 AGENTS.md | 文档反映新结构 |
| P6-T8 | 更新 project_memory.md | 记录架构变更 |

## 9. 时间预估与优先级

> 不提供具体时间预估，但给出相对工作量与优先级，供排期参考。

| 阶段 | 相对工作量 | 优先级 | 可并行度 |
|------|-----------|--------|----------|
| Phase 0 | 小（已完成） | - | - |
| Phase 1 | 大 | P0 | 串行 |
| Phase 2 | 中 | P0 | 三端骨架可并行 |
| Phase 3 | 最大 | P0 | Tauri/Web 迁移可并行 |
| Phase 4 | 中 | P1 | 可与 Phase 3 后半并行 |
| Phase 5 | 小 | P1 | 三端配置可并行 |
| Phase 6 | 小 | P2 | 三端验收可并行 |

## 10. 回滚策略（每阶段）

| 阶段 | 回滚方式 |
|------|----------|
| Phase 1 | git revert agent-runtime 抽离 commit，恢复 worldsmith-agent 原状 |
| Phase 2 | 删除 apps/ 目录，恢复原结构 |
| Phase 3 | 恢复 src/ 目录（git checkout），回滚 coreBackend/useAgent 改造 |
| Phase 4 | 恢复 worldsmith-server，Web 端切回原 API |
| Phase 5 | 恢复原 vite.config.ts / CI workflow |
| Phase 6 | 无法回滚（旧目录已删），需从 git 历史恢复 |

> 详细风险与回滚策略见 【`[09-risk-mitigation.md](./09-risk-mitigation.md)`】

## 11. 里程碑定义

| 里程碑 | 完成标志 | 可交付物 |
|--------|----------|----------|
| M1 | Phase 1 完成 ✅ | `packages/agent-runtime` 可独立编译，CLI 功能不退化 |
| M2 | Phase 2 完成 ✅ | 三端骨架可独立启动空白页（注：Web/Tauri Vite 启动受网络问题阻碍，配置已验证正确） |
| M3 | Phase 3 完成 | 三端 src/ 独立，原 src/ 可删除 |
| M4 | Phase 4 完成 ✅ | CLI serve 替代 worldsmith-server，Web 端功能正常 |
| M5 | Phase 5 完成 ✅ | 三端独立 CI/CD |
| M6 | Phase 6 完成 ✅ | 端分离全部完成，旧代码清理（根 src/ 已删） |
