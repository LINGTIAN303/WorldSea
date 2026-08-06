# retrofit-tools.ts 详细注释文档（packages/agent-runtime/tools）

> 来源：`packages/agent-runtime/src/tools/retrofit-tools.ts` 中连续 ≥ 10 行的长注释块，按文件内出现顺序迁移至此。
> 代码内原位置已替换为一行简要注释 + 相对路径。

## 注释块 1（原文件第 4-27 行）

```
安全改造工具集 (Retrofit)

提供对项目结构的安全改造能力，包含完整的工作流生命周期：

工作流阶段：Negotiate → Confirm → Apply → Verify → Complete

支持的改造意图类型：
- 数据模型: AddView/ModifyView/RemoveView, AddField/ModifyField/RemoveField
- 行为: AddAction/ModifyAction/RemoveAction
- Schema: ModifySchema, AddEntityType/RemoveEntityType
- 主题: SetTheme, AddTheme/RemoveTheme
- 布局: SetLayout/AddLayout/RemoveLayout
- 样式: SetStyles/ModifyStyles

安全机制：
1. Pre-check: 意图提交时进行安全检查
2. Patch diff: 仅发送变更部分，节省 token
3. Stage & Apply: 分批应用，支持单步回滚
4. Post-check: 应用后进行健康验证
5. Repair: 发现问题时可触发修复流程

所有工具依赖 Tauri invoke API，仅在 Tauri 桌面模式下可用。
```
