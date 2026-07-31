---
name: project-io
description: >
  项目数据导入导出。当用户需要备份、恢复或迁移项目数据时激活。
  关键词：导出、导入、备份、恢复、迁移。
capabilities:
  internal:
    - project_export
    - project_import
    - consistency_check
  cli: []
  mcp: []
---

## 目标

安全地导入导出项目数据，确保数据完整性和可恢复性。

## 触发条件

- 用户要求导出/备份项目数据
- 用户要求导入/恢复项目数据
- 用户要求迁移项目到新环境

## 标准工作流程

### 导出
1. 使用 `project_export` 导出当前项目数据
2. 报告导出统计（实体数、关系数、数据大小）

### 导入
1. **先备份**：导出当前数据作为备份
2. 读取 JSON 文件内容
3. 使用 `project_import` 导入
4. 使用 `consistency_check` 验证数据完整性
5. 报告导入结果

## 质量审核清单

- [ ] 导入前已备份当前数据
- [ ] 导入后运行了一致性检查
- [ ] JSON 格式匹配项目 schema

## Gotchas

- 导入会覆盖同 ID 的现有数据
- 大项目导出可能产生大量数据
- JSON 格式必须严格匹配项目 schema
