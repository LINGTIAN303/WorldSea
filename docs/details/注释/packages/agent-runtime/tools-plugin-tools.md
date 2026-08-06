# plugin-tools.ts 详细注释文档（packages/agent-runtime/tools）

> 来源：`packages/agent-runtime/src/tools/plugin-tools.ts` 中连续 ≥ 10 行的长注释块，按文件内出现顺序迁移至此。
> 代码内原位置已替换为一行简要注释 + 相对路径。

## 注释块 1（原文件第 1-13 行）

```
通用插件操作工具集

提供跨插件的统一操作接口：
- plugin_write: 向任意支持的插件写入数据
- notebook_create/update/link: 笔记本专属操作
- code_execute: 在沙箱中执行 JS 代码（笔记本代码单元格）

支持的插件目标: manuscript / notebook / outline / timeline / graph / mindmap /
  characters / regions / organizations / species / languages / culture /
  items / weapons / apparel / plants / buildings / magic / combat_stats /
  tactical-board / concepts / inspiration / drawing / conflict / custom / module-builder
```
