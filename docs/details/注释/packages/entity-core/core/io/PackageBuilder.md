# PackageBuilder.ts 详细注释

> 来源：`packages/entity-core/src/core/io/PackageBuilder.ts`
> 说明：本文件为 PackageBuilder 内长注释块的「详细」层（why/how）归档。代码文件内仅保留一行简要注释并指向本文件。

## 注释块 1（原文件第 1-21 行）

````
/**
 * PackageBuilder — .ws 包构建器
 *
 * 将 WorldSmithPack 打包为 ZIP 归档（.ws 扩展名），内嵌媒体文件。
 * 媒体文件从实体 avatar 和 properties 中扫描引用并嵌入。
 *
 * 包结构：
 *   worldsmith-pack.ws (ZIP)
 *   ├── manifest.json      ← 包元数据 + 文件索引
 *   ├── pack.json          ← WorldSmithPack（完整数据）
 *   └── media/
 *       ├── avatars/       ← entity.avatar 引用的图片
 *       └── attachments/   ← properties 里引用的文件
 *
 * @example
 *   const builder = new PackageBuilder()
 *   const blob = await builder.build(pack, entities)
 *   // 浏览器下载（通过注入的 Downloader 实现）
 *   import { getDownloader } from './ioServices'
 *   getDownloader().download('project.ws', blob)
 */
````
