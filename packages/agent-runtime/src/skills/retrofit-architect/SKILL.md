---
name: retrofit-architect
description: >
  安全改造引擎。当用户需要修改项目结构时激活：添加/删除/修改字段、实体类型、
  视图配置、主题配色、布局方案。所有改造通过 Retrofit 引擎执行，确保安全、可逆。
  关键词：改造、修改结构、添加字段、删除类型、主题、布局、Schema、字段、视图。
capabilities:
  internal:
    - entity.list
    - entity.get
    - retrofit_begin_session
    - retrofit_submit_intent
    - retrofit_confirm_and_stage
    - retrofit_apply_next
    - retrofit_verify_and_accept
    - retrofit_request_repair
    - retrofit_redirect
    - retrofit_rollback_last
    - retrofit_abort
    - retrofit_session_phase
    - retrofit_detect_conflicts
    - retrofit_end_session
    - retrofit_patch_diff
    - retrofit_patch_apply
    - retrofit_apply
    - retrofit_undo
    - schema_register_entity_type
    - schema_unregister_entity_type
    - schema_get_entity_type
    - schema_list_entity_types
    - schema_update_entity_type
    - schema_register_validation
    - schema_register_view
    - entity.schema.validate
    - schema_export
    - ui.surface.create
    - ui.components.update
    - ui.data.update
    - ui.surface.delete
    - ui.output.table
    - ui.output.choice
    - ui.output.code
  cli: []
  mcp: []
---

## 目标

通过 Retrofit 引擎安全、可逆地修改项目结构，确保每一步都有验证和回滚能力。

## 触发条件

- 用户要求添加/删除/修改实体类型的字段
- 用户要求添加/删除实体类型
- 用户要求修改视图配置
- 用户要求更换项目主题或布局
- 用户要求修改 Schema 结构

## 核心方法论

1. **意图先行**：每次改造必须先提交意图，确认影响范围后再执行
2. **逐步验证**：每应用一个变更就验证一次，不等全部应用后才检查
3. **回滚优先**：验证失败立即回滚，不尝试"修补后继续"
4. **冲突感知**：改造期间检测外部变更冲突

## 标准工作流程（必须严格遵循）

```
begin_session → submit_intent → confirm_and_stage → apply_next → verify_and_accept → end_session
                                     ↑                  ↓              ↓
                                     └── rollback_last ←┘              │
                                                                        │
                              abort ──────────────────────────────────→┘
```

### 步骤详解

1. **`retrofit_begin_session`**：开启改造会话，获取 session_id
2. **`retrofit_submit_intent`**：提交改造意图（意图类型见下方）
3. **`retrofit_confirm_and_stage`**：确认意图，暂存变更
4. **`retrofit_apply_next`**：应用下一个暂存的变更
5. **`retrofit_verify_and_accept`**：验证并接受已应用的变更
6. **`retrofit_end_session`**：关闭改造会话

### 错误处理

- 验证失败 → `retrofit_rollback_last` 回滚上一个变更
- 严重错误 → `retrofit_abort` 紧急中止整个会话
- 冲突检测 → `retrofit_detect_conflicts` 检查外部变更

## 意图类型

| 意图 | 说明 | 关键参数 |
|------|------|----------|
| `add_field` | 添加字段 | entityType, field{key,label,type,options} |
| `remove_field` | 删除字段 | entityType, fieldKey |
| `modify_field` | 修改字段 | entityType, fieldKey, changes{} |
| `add_entity_type` | 添加实体类型 | typeKey, label, icon, fields[] |
| `remove_entity_type` | 删除实体类型 | typeKey, migrateTo? |
| `add_view` | 添加视图 | viewKey, viewType, config |
| `remove_view` | 删除视图 | viewKey |
| `modify_view` | 修改视图 | viewKey, config |
| `change_theme` | 更改主题 | theme, colors{} |
| `change_layout` | 更改布局 | layout, config |

详细参数格式见 `references/retrofit-intent-types.md`

## 质量审核清单

- [ ] 每个意图都已 confirm_and_stage
- [ ] 每个变更都已 verify_and_accept
- [ ] 无冲突或冲突已解决
- [ ] 删除实体类型前确认无实体使用
- [ ] 会话已正常 end_session

## Gotchas

- `retrofit_submit_intent` 的 intent 必须是上述 10 种之一
- 改造期间其他操作可能产生冲突，定期 `retrofit_detect_conflicts`
- `retrofit_apply` 是旧版 API，新流程使用 `apply_next` + `verify_and_accept`
- 删除实体类型前，先用 `entity_list` 确认该类型下无实体
- 详细阶段说明见 `references/retrofit-phases.md`

## 输出格式

```
## 改造报告

### 会话
- ID: [session_id]
- 阶段: [phase]

### 已应用变更
| # | 意图 | 描述 | 状态 |
|---|------|------|------|
| 1 | add_field | [描述] | ✅ 已验证 |

### 冲突检测
- [冲突描述]: [处理方式]
```

## 参考资源

- `references/retrofit-phases.md`：改造阶段详细说明和生命周期图
- `references/retrofit-intent-types.md`：10 种意图类型的完整参数格式
