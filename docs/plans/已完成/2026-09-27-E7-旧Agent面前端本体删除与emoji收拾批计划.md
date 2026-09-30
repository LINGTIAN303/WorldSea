---
status: 已完成
---

# E7 批计划：旧 Agent 面前端本体删除 + emoji 收拾

> **来源**：用户 2026-09-27 走查 E6 后裁定遗留项——①「旧Agent面本体可删」②「顺手收拾了 emoji」；并交代「做完后可以收个尾，我要切换到其他 Agent 中去，当前会话也会归档」。
> **口径**：本轮删**前端本体**（`apps/tauri/src/{agent,space,subagent,terminal}`）；包与 Rust 面（agent-runtime / agent-core / Rust Agent 命令面与 crates）留**精确清单**待下一批（见 §四——与保留项/产品在用模块交织，需逐条处置）。

## 一、emoji 收拾（图标一律回 ui-kit 图标集）

| 位置 | 原 | 现 |
|---|---|---|
| 魔法芽 · 技能树（`useSkillTreeData` + `SkillTreeView`） | 🔥🧠✨💀🌿🔣⚗️🥋⚡🔮（10 体系） | ui-kit 图标名（sun / eye / sparkle / skull / plant / tag / palette / weapon / lightning / magic）；细节面板与四个关系列表改 `WsIcon` 渲染 |
| 魔法芽 · 技能树画布 | `ctx.fillText(emoji)` | 色相实心小圆（画布不吃 SVG 图标） |
| 战力芽 · 境界阶梯（数据 + 视图 + 画布） | 🧘🔮🥋⚡🔬🌀 | star / magic / weapon / lightning / wrench / grid / activity + 小圆 |
| 画板芽 | 🎨（空态与卡片占位）· 👁/🚫（图层可见）· 🔒（图层锁定） | `palette` · `eye` + 降透明度表示隐藏 · **新增 ui-kit `lock` 字形**（`assets/icons/action.ts`，Material 基线同族） |
| 植物芽 · 配方树画布 | 🌿📦🔮（类型角标） | 单字（植 / 物 / 法） |
| 物种芽 · 演化树画布 | `👥 人口数` | 纯数字 |
| 一致性报告面板 | 🔗📝⚠️🏝️（分类）· ❌⚠️ℹ️（严重度） | link / edit / warning / location · close / warning / info（`WsIcon` 渲染） |

（`✕` / `✎` / `✓` 一类**文字符号**沿用旧约定未动；`sentenceText.spec` 内的 emoji 为测试数据。）

## 二、前端本体删除（含文件搬迁）

**先搬出仍在用的**（目标目录深度与源一致 → 相对引用天然保持）：
- `space/files/**` → `components/files/**`（笔记本在用：FileTreeBrowser / FilePreview / pdfjsSetup / cmBasicSetup，及四渲染器与代码编辑器全套）
- `space/workspace.ts` → `composables/workspace.ts`（路径解析：notebook / imageAssets 等）
- `agent/composables/transport.ts` → `composables/transport.ts`（产品域 invoke 封装 + HTTP 桥）
- **shared-ui 抽产品级 markdown 模块**：`agent/bubbles/{markdownStream, codeHighlight, agent-markdown.css}` → `shared-ui/src/markdown/`（+ 新 `index.ts`：`renderMarkdownHtml` / `handleCodeCopyClick` / 内核再导出 / Prism 副作用注入）；`bubbles/index.ts` 改为自 `../markdown` 再导出（旧调用面不变）；`package.json` 增 `./markdown` 子路径导出

**删除**（`git rm`）：`apps/tauri/src/agent/**` · `apps/tauri/src/space/**` · `apps/tauri/src/subagent/**` · `apps/tauri/src/terminal/**`（零消费者的孤儿模块）；连带 `src/agent/rules/*.md` 规则模板（唯一消费者是已删的 RulesPanel 与旧面 spec）。

**接线收口**：`App.vue`（删 AgentSpace 挂载与跳转链接分支，Shell 单壳）；`main.ts`（cmBasicSetup 新径）；`useSystemBridge`（transport 新径）；`workspace/vite.config.ts` 的**桩插件整体退役**（旧面已无引用 → 构建即验证，不再静默替换）；`architecture-baseline.json` 重生成（存量超限 215 → 179，环豁免按当前显形 8 条）。

**注释文档同步**：删 8 份已退场代码的注释文档（tauri/{useAgentRust, useLoopControlRust, useLongTaskRust, LoopControlStatus, SubAgentSection, useSubagentRust, SubAgentView, templates}.md）+ 索引行；markdown 两份文档随模块搬迁改径。

## 三、验收门（本轮）

- **门禁**：vue-tsc 0 · vitest **81 文件 / 1024**（旧面 spec ×8 随删）· arch 0（179 冻结文件 / 8 环豁免）· 断链 0 · **工作台产物构建通过（无桩规则）**。
- **真机**：重载工作台 → 树 26 · 侧栏/标题栏/视图正常（截图 `.workbuddy/e7-workbench.png`）· 控制台 0 条 · 空间切换往返正常。

## 四、交给下一批（范围已探明，勿重复摸底）

**A. 包面**（删前须先解开的交织）：
- `packages/agent-runtime`：`ui-kit` 的 `CompanionPanel.vue`（**产品在用**：设置「视频」页）与 `BuiltinToolsPanel.vue` / `agent-descriptor.ts` 仍 import 它（模型注册表 `MODEL_REGISTRY` 等）→ 先把模型注册表抽到产品级模块，再删 agent-runtime 其余。
- `packages/agent-core`：agent-runtime 与群聊等的依赖；`shared-composables/agent/**`、`shared-ui/agent/**`、`ui-kit` 的 agent 面板/描述符：随各自消费者清理。
- `plugin-sdk` / `entity-core` 的 agent 残留类型（`PluginManifest` 等）。
**B. Rust 面**：`commands.rs`（agent 命令族）/ `mcp_client.rs` / `frontend_tool_bridge.rs` / `subagent.rs` / `http_bridge`（dev 预览含 agent RPC）/ `crates/agent-*`（kernel / patterns / commands / memory / index…）；先按「11 条可留候选」逐条裁（记忆底座 / 出网收口 / 权限机 / 工作区回滚 / 会话契约 / skills-store / 设计证据 / 流式渲染器 / A2UI 与工具目录 / 跨栈守卫）。
**C. 文档**：`Agent面冻结清单.md` 的 11 条候选逐条处置 + `docs/details/架构/现状与冻结面.md` §五 余下接线点 + 计数校准。
