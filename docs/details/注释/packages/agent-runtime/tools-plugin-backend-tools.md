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

> **2026-09-14 全局桥拍板后的链路实况**（apps/tauri/src/agent/agentDataBridges.ts）：
> - **数据动作**（建/改/删/排序/导出数据）由 app 级全局桥消费——App 启动即注册、与视图挂载解耦，写操作必达 pinia store；首批迁移 = notebook / manuscript / outline 三芽，其余芽仍是「视图挂载才消费」。
> - **查询（emitPluginQuery）已真回传**：带 requestId 派发 `worldsea:agent:plugin-query` → 全局桥同步读 store → `worldsea:agent:plugin-query-result` 回传 → 发送侧 await（3s 超时报「桥未就绪」）。旧的「需要通过UI状态读取查询结果」单向广播语义作废；`window.__worldsea_*` 变通回传同步废弃。
> - **UI 动作**（navigate / 打开对话框等）仍由视图内 `useAgentPluginBridge` 消费，未挂载时忽略（用户看不到的 UI 动作无意义）。
> - 每个 (pluginId, action) 只在一处消费——数据动作已从视图 handler 删除，无双写。
