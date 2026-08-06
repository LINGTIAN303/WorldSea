# toolbus.ts 详细注释文档（packages/agent-runtime/toolbus）

> 来源：`packages/agent-runtime/src/toolbus/toolbus.ts` 中连续 ≥ 10 行的长注释块，按文件内出现顺序迁移至此。
> 代码内原位置已替换为一行简要注释 + 相对路径。

## 注释块 1（原文件第 50-59 行）

```
根据激活技能解析可用工具集

任务3 接线后采用三层数据源：
1. 全局 SkillRegistry.resolveToolNames（声明式，从 ToolRegistry.getAlwaysAvailable 起步）
2. 旧 resolveToolNames/resolvePluginToolNames（兼容本地 SKILL_REGISTRY 的 capabilities/pluginTools）
3. InternalChainRegistry.resolve（能力链，entity-core/plugin-sdk/canvas-engine）

注意：bridge.ts 当前不调用 resolve（走 getToolsForSkills → config.tools → register），
此方法供未来 resolveToolsForAgent 及动态技能切换使用。
```
