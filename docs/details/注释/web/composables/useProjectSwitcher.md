# useProjectSwitcher.ts 详细注释

> 来源：`apps/web/src/composables/useProjectSwitcher.ts`
> 说明：本文件为 useProjectSwitcher composable 内长注释块的「详细」层（why/how）归档。代码文件内仅保留一行简要注释并指向本文件。

## 注释块 1（原文件第 1-18 行）

```
/**
 * useProjectSwitcher — 项目切换编排器（Web 端迁移版）
 *
 * P3-W2 从根 src/composables/useProjectSwitcher.ts 迁移。
 * P3-W4 续已恢复全部行为级裁剪点：
 * - memory-archive 切换前归档（useMemoryArchive.archive({ source: 'session_end' })）
 * - useFileSystemProject.onProjectSwitched() 目录绑定恢复
 * - Tauri 专属分支（isTauri() 守卫 + cmd_switch_project / cmd_delete_project_db，
 *   Web 端 isTauri() 恒 false 不执行，代码与根版保持一致）
 *
 * 管理项目切换的完整流程：
 * 1. 保存当前项目状态（切换前归档会话）
 * 2. 切换 ProjectManager 的当前项目
 * 3. 重新加载所有 Store
 * 4. 重新初始化模块系统
 * 5. 切换 Agent 会话数据库
 * 6. 发射 project:switched 事件
 */
```
