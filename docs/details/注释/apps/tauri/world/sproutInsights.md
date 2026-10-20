# sproutInsights（芽洞察派生）

> 代码：`apps/tauri/src/world/sproutInsights.ts`
> 上游研究：[03-依赖与营养级](../../../../架构/芽生态/03-依赖与营养级.md) · [04-生命周期与状态](../../../../架构/芽生态/04-生命周期与状态.md) · [05-用户信息架构与建议](../../../../架构/芽生态/05-用户信息架构与建议.md)

## 为什么需要声明层

停用芽在本次启动中不会 apply，因此运行时 `entitySchemaRegistryV2` 里没有它的实体类型。
依赖图若只读运行时注册表，会在「刚启动 + 多数芽停用」时大面积缺失。R5 因此让 27 个内置芽
在 manifest 里声明 `entityTypes`；运行时注册表只作为外部插件的回退。

## 关系方向口径

- 只用有效关系声明方向；`defineRelation` 自动生成的逆关系与正向声明构成镜像对。
- 按「镜像对先出现者」过滤，避免同一关系被双向重复计数；与研究中 104 条声明口径一致。
- 只统计跨芽边；芽内部关系忽略。
- 统计粒度是关系类型，不是实体实例边数；UI 必须写明「类型级设计意图」。
- **已知幂等冲突**：`owned_by` 的显式声明（item/building → character/organization）被
  `owns` 自动生成的逆关系挡住，注册表里只剩 item→character 的自动版。
  `DECLARED_RELATION_OVERRIDES` 只在展示层补回显式声明的源/目标类型，不修改关系注册表；
  这样道具的「拥有者」才能同时指向角色与组织，与研究 §3.4 的计数一致。
  新增同类冲突时，必须同步 override 表与 `sproutInsights.spec.ts` 的补丁用例。

## 快照与刷新

`collectSproutInsights` 是快照采集口。芽开关、视图注册/反注册、外部插件重载后都要重新采集；
`PluginsPanel` 通过芽开关 watch + `pluginAPI.onViewChange` + 外部重载后刷新。

## 外部插件

外部插件 manifest 可不声明 `entityTypes`。缺省时回退到运行时 schema 的 `pluginId` 归属，
并标记 `dependencyLimited`，详情显示「仅统计已装载类型」。外部插件声明了 `entityTypes: []`
视为已声明（不会回退）。

## 状态派生

- `active=false` → 装载态 `skipped`，原因「未启用」；依赖仍按 manifest 计算。
- 外部插件状态与 `worldTreeState().rejected` 优先；被拒时带可读原因。
- 已启用、已装载但 `viewCount=0` → 详情提示「已装载，但没有注册侧栏视图」。
- 被拒内置芽在导入失败时 `rejected.id` 可能是文件路径，无法与芽 id 对齐；
  此类芽通常不在 `availablePlugins()` 中，详情只能显示启用态与原因，依赖为空。
