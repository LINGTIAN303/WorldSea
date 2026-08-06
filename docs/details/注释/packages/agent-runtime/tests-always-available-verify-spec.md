# always-available-verify.spec.ts 详细注释文档（packages/agent-runtime/__tests__）

> 来源：`packages/agent-runtime/src/__tests__/always-available-verify.spec.ts` 中连续 ≥ 10 行的长注释块，按文件内出现顺序迁移至此。
> 代码内原位置已替换为一行简要注释 + 相对路径。

## 注释块 1（原文件第 1-10 行）

```
alwaysAvailable meta 等价性回归测试（任务3 收尾）

守卫 ToolRegistry.getAlwaysAvailable() 与 ALWAYS_AVAILABLE_TOOLS 的双向等价性。
若未来工具 meta 的 alwaysAvailable 标注偏离 ALWAYS_AVAILABLE_TOOLS，本测试会失败，
提醒维护者保持声明式 meta 与旧权限边界一致（或有意变更时同步两侧）。

用独立 ToolRegistry 实例（不依赖全局单例），避免全量测试时其他测试文件
reset 全局 ToolRegistry 导致的隔离问题。
```
