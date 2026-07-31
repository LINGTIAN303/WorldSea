---
name: knowledge-base
description: >
  知识库管理。Agent 自主管理专属知识空间，跨会话积累和检索知识。
  覆盖场景：用户偏好、项目设定、实体洞察、决策记录、反思整合。
  关键词：知识库、记住、知识、积累、洞察、反思、整理。
capabilities:
  internal:
    - kb_write
    - kb_read
    - kb_list
    - kb_search
    - kb_delete
    - kb_extract
    - kb_reflect
    - kb_link
    - kb_init
  cli: []
  mcp: []
---

## 目标

为 Agent 提供一个自主管理的知识空间，跨会话积累、组织和检索知识。Agent 像管理自己的笔记本一样管理知识库，用户无需手动干预。

## 核心理念

**知识库是 Agent 的外置大脑**——对话上下文是短期记忆，localStorage 是便利贴，知识库是笔记本。

- Agent 主动决定何时写入、如何组织、何时清理
- 用户无需手动管理知识库
- 知识库随项目积累，越用越丰富

## 知识库结构

```
.agent/                          ← 项目级知识空间
├── profile/                     ← 用户画像 (scope: global)
│   ├── preferences.md           (偏好汇总)
│   ├── communication-style.md   (沟通风格)
│   └── workflow-patterns.md     (工作模式)
├── project/                     ← 项目知识 (scope: project)
│   ├── overview.md              (项目概览)
│   ├── decisions.md             (重要决策时间线)
│   ├── conventions.md           (约定和惯例)
│   └── glossary.md              (术语表)
├── entities/                    ← 实体深度知识 (scope: project)
│   ├── character-insights.md    (角色洞察)
│   ├── world-rules.md           (世界规则)
│   └── relationship-patterns.md (关系模式)
├── reflections/                 ← 反思与整合 (scope: project)
│   ├── weekly/                  (周度反思)
│   └── patterns.md              (发现的模式)
└── scratch/                     ← 临时草稿 (可清理)
```

## 双层作用域

| 作用域 | 说明 | 生命周期 | 示例 |
|--------|------|---------|------|
| `global` | 跨项目持久 | 永久 | 用户偏好、沟通风格、工作模式 |
| `project` | 项目级持久 | 跟随项目 | 世界观知识、实体洞察、决策记录 |

## 标准工作流程

### 1. 初始化
首次使用时调用 `kb_init` 创建目录结构。

### 2. 知识写入
- **实时写入**：对话中发现重要信息时，立即调用 `kb_extract` 提取
- **定期整理**：对话结束时，回顾对话内容，补充遗漏的知识

### 3. 知识检索
- 用户提问时，先搜索知识库（`kb_search`），再结合当前对话上下文回答
- 涉及特定实体时，通过 `kb_link` 查看关联知识

### 4. 知识整合
- 定期调用 `kb_reflect` 整合重复知识、压缩旧内容
- 发现模式时写入 `reflections/patterns.md`

## 何时提取知识

### 应该提取
- 用户明确表达偏好（"我喜欢简洁风格"）
- 用户做出重要决策（"魔法系统采用元素制"）
- 发现项目规则或模式（"所有角色都有背景故事"）
- 用户纠正 Agent 的错误（"不要用那个词"）
- 实体间关系的重要变化

### 不应提取
- 临时性信息（"帮我查一下"）
- 常识性信息
- 对话中的闲聊
- 已经存在于知识库的信息

## 提取类别

| 类别 | 目录 | scope | 示例 |
|------|------|-------|------|
| preference | profile/ | global | 用户偏好简洁输出 |
| decision | project/ | project | 魔法系统采用元素制 |
| convention | project/ | project | 角色名用中文 |
| insight | entities/ | project | 角色A和角色B有隐藏关系 |
| rule | entities/ | project | 魔法消耗与距离成正比 |
| pattern | reflections/ | project | 用户总在晚上创作 |

## 质量审核清单

- [ ] 提取的知识具有持久价值
- [ ] 路径和类别匹配
- [ ] 内容足够详细，未来能理解上下文
- [ ] 标签准确，便于检索
- [ ] 关联了相关实体（如有）

## Gotchas

- 知识库不是对话历史的替代品，只存高价值信息
- 定期清理 scratch/ 目录
- 超过 30 天未访问且 accessCount < 2 的知识可考虑压缩
- 写入时自动生成向量索引，支持语义搜索
- 同一 path 会覆盖旧内容，注意保留重要信息
