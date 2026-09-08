# tool-meta-registry.ts 详细注释文档（packages/agent-runtime/tools）

> 来源：`packages/agent-runtime/src/tools/tool-meta-registry.ts` 中连续 ≥ 10 行的长注释块，按文件内出现顺序迁移至此。
> 代码内原位置已替换为一行简要注释 + 相对路径。

## 注释块 1（原文件第 1-14 行）

```
工具元数据注册中心

为所有工具（含旧工具名）提供统一的元数据查询接口。

数据源优先级（任务3 后续：LEGACY_TOOL_META 已淘汰）：
1. 全局 ToolRegistry（@worldsea/agent-core）—— 声明式首选源（含 meta.aliases）
2. ALIAS_MAP / LEGACY_ALGO_MAP / LEGACY_PLUGIN_MAP —— 旧工具名别名解析
3. 兜底：moderate 权限

用法：
  const meta = getToolMeta('fs_read')   // → read_file 的 meta
  const meta = getToolMeta('entity_delete')  // → 旧工具的 meta
```

## 注释块 2（原文件第 26-31 行）

```
注入工具列表（必须在首次 getToolMeta 前调用）

将工具注册到全局 ToolRegistry，使其成为元数据首选源。
幂等：同名工具覆盖（ToolRegistry.register 用 Map.set）。
```
