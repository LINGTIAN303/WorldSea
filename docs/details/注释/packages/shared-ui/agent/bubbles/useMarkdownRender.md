# useMarkdownRender.ts 详细注释

> 来源：`packages/shared-ui/src/agent/bubbles/useMarkdownRender.ts`
> 说明：本文件为「详细」层（why/how）归档。代码文件内仅保留简要注释并指向本文件。
> **2026-09-20（C2）重构**：marked 实例 / 消毒 / mention 注入 / 分块与增量渲染器已移至 [markdownStream.md](../../markdown/markdownStream.md)；本文件只保留 Vue 接线与兼容 API。

## 职责边界（为什么拆分）

- **拆分动机**：增量内核需要 jsdom 直测（不牵入 pinia / perf-kit / Vue）；`codeHighlight.ts` 需要注入高亮钩子（亦不需要 Vue 依赖）。
- **本文件职责**：
  - `rawMarkdown`：trim → `replaceFontSpans`（deps 注入）→ `stripJsonBlocks`；
  - `useStreamingRenderer` rAF 节流（既有，未改）；
  - `createMarkdownStreamRenderer` 实例化，输出 `stableHtml` / `tailHtml` / `renderedMarkdown`（兼容整串）；
  - 兼容导出：`renderMd`（整段路径）、`renderMarkdownHtml`（无 mention 轻场景，行为不变）、`handleCodeCopyClick`、`stripJsonBlocks`。

## 行为说明

- `renderedMarkdown = stableHtml + tailHtml`：兼容既有单容器消费方与字体段 watcher；`AssistantRow` 已改为双段容器消费（见 [markdownStream.md](../../markdown/markdownStream.md)「双段容器」）。
- **双层降级语义**：未闭合围栏只降级「尾块」（相对旧实现的整段降级是**有意差异**，见 markdownStream.md）；`renderMarkdownHtml`（群聊 / 文件预览等）仍走整段语义，行为不变。
- mention 注入缓存的 key 粒度随增量路径变细（单 token HTML 为主），整段回退路径仍以整段 HTML 为 key——两者共用同一 FIFO 上限。