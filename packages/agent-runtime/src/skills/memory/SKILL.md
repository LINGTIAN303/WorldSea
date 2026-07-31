---
name: memory
description: >
  长期记忆管理。当用户需要跨会话保存或检索重要信息时激活。
  覆盖场景：用户偏好、项目设定、工作模式、重要决策。
  关键词：记住、回忆、记忆、偏好、保存、遗忘。
capabilities:
  internal:
    - memory_store
    - memory_recall
    - memory_delete
  cli: []
  mcp: []
---

## 目标

跨会话持久化关键信息，确保 AI 在后续对话中能回忆用户偏好和项目设定。

## 触发条件

- 用户说"记住/忘了/回忆/偏好"
- 用户要求保存重要设定或决策
- 用户要求检索之前保存的信息

## 标准工作流程

### 存储
1. 确认要存储的信息类型（偏好/设定/决策/模式）
2. 使用 `memory_store` 保存，key 格式：`[类别]:[描述性名称]`
3. 返回确认信息

### 检索
1. 使用 `memory_recall` 按关键词检索
2. 返回匹配的记忆列表

### 清理
1. 确认要删除的记忆
2. 使用 `memory_delete` 删除
3. 返回确认

## Key 命名规范

| 类别 | 前缀 | 示例 |
|------|------|------|
| 用户偏好 | `pref:` | `pref:style-concise` |
| 项目设定 | `proj:` | `proj:magic-system-rules` |
| 工作模式 | `mode:` | `mode:batch-create-pref` |
| 重要决策 | `dec:` | `dec:faction-war-outcome` |

## 质量审核清单

- [ ] key 具有描述性
- [ ] 存储前检索避免重复
- [ ] 过时信息已清理

## Gotchas

- 检索时使用宽泛关键词以获取更多相关记忆
- 定期清理过时信息
- 记忆不是无限的，优先存储高价值信息
