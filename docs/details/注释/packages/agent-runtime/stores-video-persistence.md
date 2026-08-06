# video-persistence.ts 详细注释文档（packages/agent-runtime/stores）

> 来源：`packages/agent-runtime/src/stores/video-persistence.ts` 中连续 ≥ 10 行的长注释块，按文件内出现顺序迁移至此。
> 代码内原位置已替换为一行简要注释 + 相对路径。

## 注释块 1（原文件第 1-10 行）

```
视频持久化存储模块
基于 IndexedDB 实现，用于存储通过 AI 生成的视频元数据和 Blob

数据库: worldsmith_videos (v1)
对象仓库: videos (keyPath: id)
索引: createdAt, provider, path

虚拟路径格式: /videos/generated/{date}/{caption}-{blockId}.mp4
```
