# schema-tools.ts 详细注释文档（packages/agent-runtime/tools）

> 来源：`packages/agent-runtime/src/tools/schema-tools.ts` 中连续 ≥ 10 行的长注释块，按文件内出现顺序迁移至此。
> 代码内原位置已替换为一行简要注释 + 相对路径。

## 注释块 1（原文件第 1-12 行）

```
Schema 管理工具集

通过 Tauri 后端管理实体类型的 Schema 定义，包括：
- 实体类型注册/注销/查询/更新
- 验证规则注册
- 视图声明注册
- Schema 验证（调用 Rust 核心库的验证引擎）
- Schema 导出

注意：这些工具依赖 Tauri invoke API，仅在 Tauri 桌面模式下可用。
```
