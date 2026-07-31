# Skill 创建器技能

你已获得创建新 Skill 的能力。这是一个元技能——帮助你为 AI Agent 创建新的技能。

## Skill 结构

每个 Skill 由以下文件组成：

```
skills/<skill-id>/
├── skill.yaml        # Skill 元数据定义
└── instructions.md   # Skill 指令文档
```

## 创建流程

### 第 1 步：理解需求

向用户询问以下信息（一次一个问题）：

1. **Skill 目的**：这个 Skill 要解决什么问题？
2. **触发场景**：用户在什么情况下会需要这个 Skill？
3. **工作流**：期望的执行步骤是什么？
4. **所需工具**：需要哪些已有工具来完成任务？
5. **输出格式**：结果应该以什么形式呈现？

### 第 2 步：选择工具

根据 Skill 的应用场景推荐工具：

| 场景 | 推荐工具 |
|------|----------|
| 项目内文件操作 | file_read, file_write |
| 项目外文件操作 | fs_read, fs_write, fs_list, fs_search |
| 终端命令执行 | execute_command |
| 包管理 | pkg_install, pkg_run, pkg_info |
| Git 操作 | git_status, git_log, git_diff, git_commit, git_branch |
| 联网搜索（无需 Key） | web_search_cli, web_fetch_cli |
| 联网搜索（需 Key） | web_search, web_fetch |
| 编程问答 | web_qa_cli |
| 网络诊断 | web_dns_cli, web_ping_cli |
| 实体操作 | entity_list, entity_get, entity_create, entity_update, entity_delete |
| 关系操作 | relation_create, relation_delete |
| 内容搜索 | content_search |
| 记忆 | memory_store, memory_recall |
| 算法分析 | algo_* 系列 |
| UI 组件 | ui_create_surface, ui_update_components |

### 第 3 步：生成 skill.yaml

```yaml
id: <skill-id>           # 小写字母 + 连字符，如 code-reviewer
name: <中文名>            # 简短中文名称
icon: "<emoji>"          # 代表性 emoji
description: <描述>       # 包含关键词的简短描述
enabled: true
baseTools: []            # 基础工具（始终可用）
allowedTools:            # 激活后才可用的工具
  - <tool-name>
```

### 第 4 步：生成 instructions.md

指令文档应包含：

1. **Skill 标题**：`# [Skill 名称]`
2. **能力声明**：简述获得的能力
3. **核心概念**：关键术语和分类
4. **工作流**：步骤化的执行流程
5. **输出模板**：结构化的输出格式
6. **使用原则**：5-6 条核心原则

### 第 5 步：注册到 Registry

在 `src/skills/registry.ts` 的 `SKILL_REGISTRY` 数组末尾添加：

```typescript
{
  id: '<skill-id>',
  name: '<中文名>',
  icon: '<emoji>',
  description: '<描述>',
  category: 'action',  // 或 'domain' / 'persona'
  enabled: true,
  promptFile: '<skill-id>/instructions.md',
  baseTools: [],
  allowedTools: ['<tool1>', '<tool2>'],
},
```

### 第 6 步：验证

1. 确认 skill.yaml 格式正确
2. 确认 instructions.md 内容完整
3. 确认 registry.ts 注册无误
4. 建议用户运行 typecheck 验证

## Skill 设计原则

1. **单一职责**：每个 Skill 只解决一类问题
2. **最小工具集**：只声明必要的工具，不多不少
3. **指令即智能**：工具是通用的，Skill 的价值在于 instructions 中的领域知识
4. **可组合**：Skill 之间可以组合使用，不互相排斥
5. **渐进式**：从简单开始，后续可迭代增强

## 类别选择

| 类别 | 说明 | 示例 |
|------|------|------|
| `domain` | 领域专业能力 | 世界观构建、算法分析 |
| `action` | 通用操作能力 | 文件操作、联网搜索 |
| `persona` | 人格/角色能力 | 人格附体 |

## 使用原则

1. **一次一个 Skill**：不要同时创建多个 Skill，逐个确认
2. **用户驱动**：每个关键决策都让用户确认
3. **参考现有 Skill**：查看已有 Skill 的结构和风格，保持一致
4. **测试可用性**：创建后建议用户激活测试
5. **文档先行**：先写 instructions 再写 yaml，确保逻辑完整
