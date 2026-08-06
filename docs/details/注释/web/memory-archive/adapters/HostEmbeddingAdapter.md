# HostEmbeddingAdapter.ts 详细注释

> 来源：`apps/web/src/memory-archive/adapters/HostEmbeddingAdapter.ts`
> 说明：本文件为 EmbeddingAdapter 宿主实现内长注释块的「详细」层（why/how）归档。代码文件内仅保留一行简要注释并指向本文件。

## 注释块 1（原文件第 1-11 行）

```
/**
 * HostEmbeddingAdapter - EmbeddingAdapter 接口的宿主实现
 *
 * 复用 worldsmith-agent 现有的 embedding service，为 memory-archive 框架提供向量嵌入能力。
 * 当 embedding API 未配置时，isReady() 返回 false，框架将跳过向量生成（等日任务补全）。
 *
 * 底层调用：
 * - isReady()  → getEmbeddingConfig() 检查 apiKey
 * - embed()    → generateEmbedding(text)
 * - embedBatch → generateEmbeddings(texts)
 */
```
