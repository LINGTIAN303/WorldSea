# file-tools.ts 详细注释文档（packages/agent-runtime/tools）

> 来源：`packages/agent-runtime/src/tools/file-tools.ts` 中连续 ≥ 10 行的长注释块，按文件内出现顺序迁移至此。
> 代码内原位置已替换为一行简要注释 + 相对路径。

## 注释块 1（原文件第 1-11 行）

```
文件管理工具集

管理项目工作区文件的完整生命周期：
- file_list: 列表查询（按路径前缀或关联实体筛选）
- file_read: 读取文件内容（文本或 base64）
- file_write: 创建/覆盖文件
- file_delete: 删除文件
- file_associate: 将文件关联/取消关联到实体
- file_analyze: 分析文件结构并推荐目标插件
```
