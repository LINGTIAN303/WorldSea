# image-store.ts 详细注释文档（packages/agent-runtime/stores）

> 来源：`packages/agent-runtime/src/stores/image-store.ts` 中连续 ≥ 10 行的长注释块，按文件内出现顺序迁移至此。
> 代码内原位置已替换为一行简要注释 + 相对路径。

## 注释块 1（原文件第 1-10 行）

```
内存级图像缓存

用于在图像生成过程中暂存 base64 数据，供 vision-tools 跨调用共享。
与 image-persistence (IndexedDB) 不同：本模块仅提供临时内存缓存，有 30 分钟 TTL。

写入方: vision-tools 的 vision_analyze 工具
读取方: vision-tools 的 list_vision_images 工具
关系: 本模块独立于 IndexedDB 持久化层，两者服务于不同目的
```
