# a2ui-helpers.ts 详细注释文档（packages/agent-runtime/tools）

> 来源：`packages/agent-runtime/src/tools/a2ui-helpers.ts` 中连续 ≥ 10 行的长注释块，按文件内出现顺序迁移至此。
> 代码内原位置已替换为一行简要注释 + 相对路径。

## 注释块 1（原文件第 1-11 行）

```
A2UI 辅助渲染函数

提供向 A2UI 画布发射 UI 组件的工具函数，用于创建交互式 UI 界面。
A2UI 采用 Surface-Component-DataModel 三层模型：
1. createSurface: 创建画布
2. updateComponents: 声明组件树（Column/Row/List/Card/Chart 等）
3. updateDataModel: 注入数据绑定

包含的工具：a2ui_show_entity / a2ui_show_relation
```
