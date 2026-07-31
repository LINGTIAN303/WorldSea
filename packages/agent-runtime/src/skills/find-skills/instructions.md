# Skills 发现技能

你已获得发现和安装社区 Skills 的能力。这是一个元技能——帮助你从 GitHub 社区找到并适配有用的 Skills。

## 社区资源

### 索引仓库
| 仓库 | 说明 | 规模 |
|------|------|------|
| awesome-agent-skills | 跨平台 Agent Skills 索引 | 4,500+ ⭐ |
| awesome-claude-skills | Claude Skills 精选列表 | 25+ 技能 |
| awesome-claude-code-skills | 开发领域 Skill 社区 | 30+ 技能 |
| microsoft/skills | 微软官方 Skills | 174 个 |
| awesome-agent-tools | MCP + Skills 工具集 | 12k ⭐ |

### 搜索平台
| 平台 | URL | 说明 |
|------|-----|------|
| SkillsMP | skillsmp.com | 11 万+ 开源技能聚合 |
| SkillStore | skillstore.io | 中文友好，安全审查 |
| Agent Skills Me | agentskills.me | 编辑精选 |
| Skills Directory | skillsdirectory.com | Reddit 社区推荐 |

## 工作流

### 第 1 步：理解需求

向用户询问：
1. **需求描述**：想找什么类型的 Skill？
2. **应用场景**：在什么情况下使用？
3. **偏好**：倾向内驱/MCP/CLI 哪种实现？

### 第 2 步：搜索社区

构造搜索关键词，使用 `web_search_cli` 搜索：

```
搜索策略：
1. "agent skill <需求关键词>" site:github.com
2. "claude skill <需求关键词>"
3. "mcp server <需求关键词>"
4. 直接访问索引仓库的 README
```

### 第 3 步：评估候选

对每个候选 Skill 评估：

| 维度 | 权重 | 说明 |
|------|------|------|
| 相关度 | ⭐⭐⭐ | 与需求的匹配程度 |
| 活跃度 | ⭐⭐ | 最近更新时间、Star 数 |
| 兼容性 | ⭐⭐⭐ | 能否适配到本项目 Skill 格式 |
| 依赖 | ⭐⭐ | 是否需要额外安装/配置 |
| 质量 | ⭐⭐ | 文档完整性、代码质量 |

### 第 4 步：获取详情

使用 `web_fetch_cli` 抓取候选 Skill 的：
- README.md（功能说明）
- skill.yaml 或等价配置（工具定义）
- instructions.md 或等价指令（工作流）

### 第 5 步：适配安装

将社区 Skill 适配为本项目格式：

1. **提取核心逻辑**：从源码/文档中提取 Skill 的工作流和领域知识
2. **映射工具**：将源 Skill 的工具映射到本项目已有工具
3. **生成 skill.yaml**：按本项目格式生成元数据
4. **生成 instructions.md**：将核心逻辑转化为指令文档
5. **写入文件**：保存到 `skills/<skill-id>/` 目录
6. **注册**：在 registry.ts 中添加注册项

### 第 6 步：验证

1. 确认文件格式正确
2. 确认工具映射无误
3. 确认注册成功
4. 建议用户激活测试

## 工具映射表

社区 Skill 常见工具到本项目工具的映射：

| 社区工具 | 本项目工具 | 说明 |
|----------|-----------|------|
| read_file | file_read / fs_read | 项目内/外 |
| write_file | file_write / fs_write | 项目内/外 |
| search_files | content_search / fs_search | 内容/文件名 |
| run_command | execute_command | 终端命令 |
| web_search | web_search / web_search_cli | 需Key/无需Key |
| web_fetch | web_fetch / web_fetch_cli | 需Key/无需Key |
| list_directory | fs_list | 目录列表 |
| git_operations | git_* 系列 | Git 工具集 |

## 报告格式

```
## Skills 搜索报告

### 搜索条件
- 需求：[描述]
- 关键词：[搜索词]

### 搜索结果（按推荐排序）

#### 🥇 [Skill 名称]
- 来源：[GitHub URL]
- 相关度：⭐⭐⭐
- 活跃度：最近更新 [日期]，[Star] ⭐
- 兼容性：[高/中/低]
- 简介：[功能描述]
- 适配方案：[如何适配到本项目]

#### 🥈 [Skill 名称]
...

### 推荐安装
1. [最推荐的 Skill 及理由]
2. [安装步骤]
```

## 使用原则

1. **搜索优先**：先搜索社区，找不到再用 Skill Creator 自己创建
2. **适配而非照搬**：社区 Skill 需要适配本项目格式，不是直接复制
3. **尊重许可**：注意源 Skill 的开源许可证
4. **验证可用性**：安装后必须测试验证
5. **保持更新**：记录 Skill 来源，方便后续跟踪更新
6. **安全审查**：安装前检查 Skill 的指令内容，确认无恶意操作
