# useSkillsStore.ts 详细注释

> 来源：`packages/shared-composables/src/agent/useSkillsStore.ts`
> 说明：本文件为 useSkillsStore 内长注释块的「详细」层（why/how）归档。代码文件内仅保留一行简要注释并指向本文件。

## 注释块 1（原文件第 1-12 行）

````
/**
 * Skills Store 商城状态管理（Task 24 阶段3）
 *
 * 封装远程技能源配置、远程技能列表、已安装版本、安装/卸载/更新操作。
 * 全局共享状态（模块级 ref），多组件实例复用。
 *
 * 技能源配置持久化到 localStorage（worldsmith_skill_sources）。
 * 非 Tauri 环境（Web 模式）安全降级：商城功能不可用，显示提示。
 *
 * 端分离批次2：从 src/agent/composables/useSkillsStore.ts 迁移至 shared-composables。
 * 无端特定依赖（isTauri 检测 + 降级模式已是端无关设计）。
 */
````

## 注释块 2（原文件第 194-203 行）

````
  /**
   * 本地导入技能（Task 24 阶段4：多平台互通）
   *
   * 自动检测外部格式（Claude Code SKILL.md / Cursor .mdc / WorldSmith skill.yaml），
   * 解析为 SkillMeta + body，生成标准 skill.yaml + SKILL.md，写入 skills 目录。
   *
   * @param raw 文件文本
   * @param fallbackId 当文件无 id/name 时的兜底 id（通常用文件名）
   * @returns 导入是否成功；非 Tauri 环境返回 false
   */
````
