# image-persistence.ts 详细注释文档（packages/agent-runtime/stores）

> 来源：`packages/agent-runtime/src/stores/image-persistence.ts` 中连续 ≥ 10 行的长注释块，按文件内出现顺序迁移至此。
> 代码内原位置已替换为一行简要注释 + 相对路径。

## 注释块 1（原文件第 1-11 行）

```
图像持久化存储模块
基于 IndexedDB 实现，用于存储通过 AI 生成的图片 Blob 数据

数据库: worldsea_images (v2)
对象仓库: images (keyPath: id)
索引: createdAt, provider, path

虚拟路径格式: /images/generated/{date}/{caption}-{blockId}.png
存储路径让 Agent 知道图片的"目录位置"，便于跨会话查找
```
