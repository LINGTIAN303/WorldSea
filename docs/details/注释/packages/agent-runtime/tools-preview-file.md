# tools-preview-file.ts 注释文档

> 源文件：`packages/agent-runtime/src/tools/preview-file.ts`（2026-09-14）

## 定位

文件触达「最后一米」：Agent 生成 docx/xlsx/pdf/pptx/图片等文档后，此前只能告知路径，用户需自行在左栏目录树中找到文件点击预览。`preview_file` 让 Agent 主动把文件推送到右侧预览面板。

## 工具清单

| 工具 | 权限 | 分类 | 说明 |
| --- | --- | --- | --- |
| `preview_file` | safe | output | 校验文件存在后推送预览事件 |

## 实现要点

1. **校验先行**：`cmd_fs_stat` 校验存在性 + 取 `size/modified`。注意 Rust 侧 `cmd_fs_stat` 对不存在路径**直接 Err**（无 exists 字段，`fs_commands.rs`），catch 即「文件不存在或无法访问」；`isDir` 显式拒绝（目录不可预览）。
2. **跨层解耦**：agent-runtime（packages 层）不 import apps/tauri 的 store，`window.dispatchEvent(new CustomEvent('worldsea:preview-file', { detail }))` 通知前端——与 orchestrator-tools（`worldsea:dispatch-sub-agent`）/ plugin-backend-tools 同模式。detail 为 FsNode 形状 `{ name, path, isDir: false, size, modified }`。
3. **前端消费**：`SessionSidebar.vue` 监听 `worldsea:preview-file` → 复用 `onLeftFileSelect`（左栏点击文件的三步通路：`setPendingFile` → `spaceStore.openRightPanel('preview')` → `ws-open-file-preview` 事件 → PreviewPanel 预览）。即 Agent 推送与用户手动点击走完全同链。
4. **平台边界**：仅 Tauri 桌面端可用（`cmd_fs_stat` / 预览面板 IO 均依赖 Tauri 命令）；Web 模式（`isTauri()` false）明确报错而非静默失败。

## 注册落点（教训 15「注册 ≠ 可见」）

- 执行注册：`agent.ts` `registerAllTools()` → `ALL_TOOLS_MAP`（桥执行查此 MAP）。
- 可见性：`meta.alwaysAvailable: true` **且** `skills/registry.ts` 的 `ALWAYS_AVAILABLE_TOOLS` 数组加入 `'preview_file'`——两处必须同步，`always-available-verify.spec.ts` 守卫双向等价。
- UI 分组：`TOOL_CATEGORIES` 的 `output`（输出渲染）组。
