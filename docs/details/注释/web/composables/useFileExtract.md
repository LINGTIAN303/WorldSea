# useFileExtract.ts 详细注释

> 来源：`apps/web/src/composables/useFileExtract.ts`
> 说明：本文件为 useFileExtract composable 内长注释块的「详细」层（why/how）归档。代码文件内仅保留一行简要注释并指向本文件。

## 注释块 1（原文件第 1-11 行）

```
/**
 * useFileExtract — 文档内容提取 composable
 *
 * 统一 AgentInputBar.vue 与 ChatInput.vue 中的 docx/pdf/text 解析逻辑，
 * 修复 pdfjs-dist workerSrc='' 导致的主线程阻塞问题（改用 Web Worker）。
 *
 * 设计原则：
 *   - 仅负责"纯文档解析"，不处理 image（image 涉及 visionSupported 检查与压缩）
 *   - 返回标准结构，调用方自行 push 到 attachments
 *   - 不识别的类型返回 null，由调用方走 unsupported 分支
 */
```
