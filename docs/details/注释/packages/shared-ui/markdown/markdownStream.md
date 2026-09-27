# markdownStream.ts 详细注释

> 来源：`packages/shared-ui/src/agent/bubbles/markdownStream.ts`
> 说明：流式 Markdown 内核（分块 + 增量渲染）的「详细」层（why/how）。代码文件内保留简要注释并指向本文件。
> 立项：第五域批次 A · C2（2026-09-20）；设计依据 [03-对照与建议清单](../../../../../plans/已完成/2026-09-18-对话区对齐dsh/03-对照与建议清单.md)。

## 背景与目标

- **C2 前路径**：`useMarkdownRender` 每帧整段 `marked.parse` + DOMPurify + mention 注入 + Prism 全量高亮——长回答流式时反复对**已完成块**做全部工作（解析 / 消毒 / 高亮 / DOM 重建）。
- **目标**：已完成块只渲一次（token 缓存）；活动尾块独立重渲；高亮随固化只跑一次；**终态与既有整段渲染逐字节一致**（契约测试锁定，防回归）。

## 核心判定线：最后一个内容 token

- marked 词法切分里，**只有最后一个非 space token 会随后续文本增长**（列表 / 表格 / 引用 / 围栏的续行都落在它身上）；它之前的 token 一旦不再位于尾部即已定型 → 可安全固化。
- `splitMarkdownStream` 由此只固化 `tokens[0..lastContent)`，尾块 = `text.slice(stableRaw.length)`（含尾 token 与尾随 space）。
- 该性质由单测以「逐前缀 × 逐 raw 对拍」的暴力方式锁定（含松散列表、setext、松散引用等边界）。

## 保守回退（宁可不增量，不可渲染错）

- **含 `def`（引用式链接定义）或 `html`（原始 HTML 块）→ 整段回退**：
  - `def`：后到的定义会改变先前链接 token 的渲染（marked 在 lexer 后处理统一解析引用），跨 token 语义不可增量；
  - `html`：片段级消毒不安全（未闭合标签会被 DOMPurify 截断修正），拼接语义不等价。
- **前缀校验失败**（`token.raw` 拼不回原文 / 非前缀增长 / 编辑缩短）→ 重置后按新文本重建或整段回退。
- 未闭合围栏：只把**尾块**降级为纯文本（`escapeHtml + <br>`），**稳定段保持渲染**。
  - ⚠️ **行为差异（相对 C2 前，有意）**：旧实现是整段降级——围栏开启期间连前面的段落也变纯文本；新实现前面保持 Markdown 渲染。终态一致；真机走查验「长代码回答流式无闪烁」。

## 双段容器（视图层配套）

- `AssistantRow` 用 `.ws-md-stable` + `.ws-md-tail` 两个容器承接 `stableHtml` / `tailHtml`：stable 段字符串跨帧不变 → Vue 跳过该容器 DOM 更新（省掉长文每帧 innerHTML 重建，这是增量渲染的大头收益）。
- CSS 首尾 margin 归零规则需命中**段内实际块**（`.ws-md-seg:first-child > :first-child`）——wrapper 上的归零挡不住子块外边距经 wrapper 向外折叠；段间 margin 照常折叠，视觉间距不变。

## 缓存与容量

- 固化 token HTML 按 `token.raw` 缓存（FIFO，上限 512，超限淘汰 20%）。
- `mentionInjectCache`（上限 200）继续服务整段回退路径与重复片段。
- 渲染器状态在 composable 实例内（组件卸载即回收）：切会话 / 回放重挂载 → 冷启动一次全量，随后回到增量；流式期间文本被修正（含 `stripJsonBlocks` 中间态变化）→ 非前缀增长自动重置。

## 契约与量测

- 契约测试 `__tests__/markdownStream.spec.ts`（13 用例）：前缀稳定性 / 逐帧「增量 ≡ 全量」/ 回退路径逐帧一致 / 非前缀增长重置 / 未闭合围栏尾块降级与闭合后固化 / 缓存命中（高亮调用次数不随帧增长）/ 既有整段语义不回退。
- 量测 `__tests__/markdownStream.bench.ts`（手动 `npx vitest bench`，非 CI 门禁）：1719 字符 / 69 帧流式——**增量 130ms vs 整段 463ms（3.55×）**；静态整段一次 14.4ms（2026-09-20 本机）。

## 已知边界

- 同一渲染器实例只服务一个消息组件（状态与 DOM 双段容器一一对应）；其他轻场景（群聊 / 文件预览）继续走 `renderFullMarkdown` 整段路径。
- `breaks: true` + 自定义 code renderer 与既有配置完全一致（同一 marked 实例），保证跨入口代码块外壳 / 复制按钮 / 高亮体验统一。