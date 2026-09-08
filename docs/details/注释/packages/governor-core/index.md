# index.ts 详细注释

> 来源：`packages/governor-core/src/index.ts`
> 说明：本文件为 governor-core 包入口内长注释块的「详细」层（why/how）归档。代码文件内仅保留一行简要注释并指向本文件。

## 注释块 1（原文件第 1-13 行）

```
/**
 * @worldsea/governor-core — Barrel Exports
 *
 * 调控器核心包入口：纯逻辑、无 Vue/Pinia 依赖。
 * 主应用（apps/web/src/governor）与 Agent 运行时包（@worldsea/agent-runtime）共享此包。
 *
 * 子路径导出：
 *   - @worldsea/governor-core          → 本文件（全部导出）
 *   - @worldsea/governor-core/types    → 类型定义
 *   - @worldsea/governor-core/registry → 注册表与依赖解析
 *   - @worldsea/governor-core/environment → 环境检测
 *   - @worldsea/governor-core/governor → createGovernor 工厂
 */
```
