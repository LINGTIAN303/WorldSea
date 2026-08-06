# plugin-backend-tools.ts 详细注释文档（packages/agent-runtime/tools）

> 来源：`packages/agent-runtime/src/tools/plugin-backend-tools.ts` 中连续 ≥ 10 行的长注释块，按文件内出现顺序迁移至此。
> 代码内原位置已替换为一行简要注释 + 相对路径。

## 注释块 1（原文件第 29-46 行）

```
插件后端工具集（域级合并版）

通过 window CustomEvent 机制与前端插件通信，提供：
- timeline: 时间线事件管理
- graph: 关系图谱操作
- mindmap: 思维导图操作
- manuscript: 稿件章节管理
- outline: 大纲结构管理
- notebook: 笔记管理
- tactical: 战术面板操作
- magic: 魔法技能树操作
- module_builder: 自定义模块管理
- entity_type: 实体类型 CRUD（角色/文化/语言/冲突/建筑/道具/概念/战力/服饰/素材）

所有操作通过 window.dispatchEvent 通知前端插件，
插件处理后通过 UI 状态更新返回结果。
```
