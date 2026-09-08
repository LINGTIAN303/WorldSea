# ExportController.ts 详细注释

> 来源：`packages/entity-core/src/core/io/ExportController.ts`
> 说明：本文件为 ExportController 内长注释块的「详细」层（why/how）归档。代码文件内仅保留一行简要注释并指向本文件。

## 注释块 1（原文件第 9-18 行）

````
/**
 * ExportController — 统一导出调度器
 *
 * 遍历所有已注册的 Serializer，收集数据并组装为 WorldSeaPack。
 * 支持按 serializer id 选择性导出。
 *
 * Phase 8a 下沉改造：
 *   - 浏览器下载副作用剥离为 Downloader 接口（通过 registerDownloader 注入）
 *   - __APP_VERSION__ 全局变量剥离为 AppVersionProvider 接口
 */
````
