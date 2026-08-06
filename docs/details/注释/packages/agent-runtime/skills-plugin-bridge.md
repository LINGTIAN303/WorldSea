# plugin-bridge.ts 详细注释文档（packages/agent-runtime/skills）

> 来源：`packages/agent-runtime/src/skills/plugin-bridge.ts` 中连续 ≥ 10 行的长注释块，按文件内出现顺序迁移至此。
> 代码内原位置已替换为一行简要注释 + 相对路径。

## 注释块 1（原文件第 1-10 行）

```
插件能力桥接模块

连接 Skill 系统与插件系统，提供：
- 插件能力注册与查询
- 根据激活的 Skill ID 解析关联的插件工具
- 构建注入提示词的插件能力描述

预定义的内置插件能力列表 (WORLD_SMITH_PLUGIN_CAPABILITIES) 在模块加载时自动注册。
```
