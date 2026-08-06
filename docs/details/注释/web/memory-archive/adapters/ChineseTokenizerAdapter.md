# ChineseTokenizerAdapter.ts 详细注释

> 来源：`apps/web/src/memory-archive/adapters/ChineseTokenizerAdapter.ts`
> 说明：本文件为中文分词器宿主实现内长注释块的「详细」层（why/how）归档。代码文件内仅保留一行简要注释并指向本文件。

## 注释块 1（原文件第 1-18 行）

```
/**
 * ChineseTokenizerAdapter - 中文分词器宿主实现（H2.2）
 *
 * 宿主层额外附挂的中文分词器，可对接 jieba、nodejieba、segmentit 等分词库。
 * 框架保持零硬依赖，此实现位于宿主层，按需启用。
 *
 * 使用方式：
 * 1. 安装分词库：pnpm add nodejieba（或 jieba-wasm 等）
 * 2. 在 useMemoryArchive.init() 中注入：
 *    ```ts
 *    const tokenizer = new ChineseTokenizerAdapter()
 *    archiveManager = new ArchiveManager({ ..., tokenizer })
 *    ```
 *
 * 未安装分词库时，isReady() 返回 false，框架自动降级到 SimpleTokenizerAdapter。
 *
 * 可额外附挂 jieba 等分词库以提升中文检索精度。
 */
```
