# governor.ts 详细注释

> 来源：`apps/web/src/governor/governor.ts`
> 说明：本文件为主应用调控器入口内长注释块的「详细」层（why/how）归档。代码文件内仅保留一行简要注释并指向本文件。

## 注释块 1（原文件第 1-13 行）

```
/**
 * governor/governor.ts — 主应用调控器入口（包装 @worldsmith/governor-core）
 *
 * 核心逻辑已下沉到 @worldsmith/governor-core 包。
 * 此文件为主应用提供特化版本：自动注入 createGovernorAPI 作为 apiFactory。
 *
 * 与 governor-core 的差异：
 * - governor-core 的 createGovernor 接收 apiFactory 选项（默认返回空 API）
 * - 主应用的 createGovernor 自动使用 createGovernorAPI（依赖 Vue/Pinia/pluginAPI）
 *
 * 这样 App.vue 的 initGovernor({ verbose }) 调用无需修改，
 * 同时 Agent 包可直接使用 governor-core 的 createGovernor（无 UI 依赖）。
 */
```
