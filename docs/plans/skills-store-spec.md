# Skills Store 技能源仓库规范

> status: 部分断线（格式规范现行 / 安装链路待重建）
>
> Task 24 阶段2 · 2026-07-07
>
> 定义 WorldSmith Skills Store 的技能源仓库格式、manifest schema、安装流程与安全模型。
> 阶段3 前端商城 UI 基于本规范实现浏览/安装/卸载/更新。
>
> **当前状态（2026-08-02）**：Task 24 阶段 1-4 + 方向 2/3 已完成（动态加载 / 安装机制 / 商城 UI / 多平台互通 / 独立 Rust crate worldsmith-skills-store / 真实技能源上线）。本规范定义的 manifest schema 与安装安全模型仍为现行标准。待办：桌面端 UI 端到端实测。
>
> **⚠ 断线声明（2026-08-30 实况核对）→ ✅ 已重建（同日 Harness 调研 P1「Skills 点火」）**：2026-08 后端重组期间（980385c 端分离迁移），`apps/tauri/src-tauri/src/skills_store.rs` 与独立 crate `worldsmith-skills-store` 被删除，`cmd_skills_*` 六命令零注册，商城安装/卸载/导入/目录扫描链路全部必然失败。**2026-08-30 已从 git 历史重建**：crate 回归 `crates/worldsmith-skills-store/`（CoreError 本地化 + From→String 适配新结构，19 单元测试通过）、skills_store.rs 六命令恢复并注册（错误类型 String 化）。本文规范（manifest schema / skill.yaml / SKILL.md 双格式 / 安全模型 / platform-adapters）持续为现行标准。待桌面实例重启后真机验证；HTTP 桥 rpc.rs 未同步六命令（见 Harness 调研风险点②）。

---

## 一、技能源仓库格式

技能源是一个 Git 仓库（推荐 GitHub/Gitee），根目录包含 `skills-manifest.json`（技能索引清单），
每个技能是仓库的一个子目录或独立 zip 包。

### 仓库目录结构示例

```
worldsmith-skills/                    # 技能源仓库根
├── skills-manifest.json              # 技能索引清单（必须）
├── skills/                           # 技能目录（推荐）
│   ├── my-skill/
│   │   ├── skill.yaml                # WorldSmith 原生 manifest
│   │   ├── SKILL.md                  # 提示词
│   │   ├── references/               # 参考文档
│   │   └── assets/                   # 资源文件
│   └── another-skill/
│       ├── SKILL.md                  # Claude Code 标准格式
│       └── instructions.md           # 备选提示词
└── README.md
```

---

## 二、skills-manifest.json Schema

```jsonc
{
  "name": "WorldSmith 官方精选技能集",      // 技能集名称（必须）
  "version": "1.0.0",                      // 清单版本（可选）
  "updated": "2026-07-07",                 // 最后更新日期（可选）
  "skills": [                              // 技能列表（必须）
    {
      "id": "my-skill",                    // 技能 id（必须，作为安装目录名）
      "name": "我的技能",                   // 显示名称（必须）
      "description": "技能描述...",         // 描述（可选）
      "version": "1.0.0",                  // 技能版本（必须，semver）
      "author": "作者",                    // 作者（可选）
      "homepage": "https://...",           // 主页（可选）

      // 安装信息（必须）
      "downloadUrl": "https://github.com/xxx/yyy/archive/refs/heads/main.zip",
      "pathInArchive": "worldsmith-skills-main/skills/my-skill",
      "sha256": "a1b2c3d4..."              // zip 的 sha256（小写十六进制）
    }
  ]
}
```

### 字段说明

| 字段 | 必填 | 说明 |
|---|---|---|
| `id` | ✅ | 技能唯一标识，作为安装目录名。禁止包含 `/`、`\`、`..` |
| `name` | ✅ | 显示名称 |
| `version` | ✅ | 技能版本（semver 格式），用于更新检测 |
| `downloadUrl` | ✅ | zip 包下载 URL（GitHub archive URL 或独立 zip URL） |
| `pathInArchive` | ✅ | zip 内技能目录路径。空字符串 `""` 表示 zip 根直接是技能文件（独立技能 zip） |
| `sha256` | ✅ | zip 包的 sha256 校验值（小写十六进制），安装时强制校验 |
| `description` | ❌ | 技能描述 |
| `author` | ❌ | 作者 |
| `homepage` | ❌ | 主页 URL |

### pathInArchive 说明

- **仓库 archive 模式**（推荐）：`downloadUrl` 是 GitHub/Gitee archive URL，
  `pathInArchive` 是 zip 内技能目录的完整路径（如 `repo-name-main/skills/my-skill`）
- **独立 zip 模式**：`downloadUrl` 是单个技能的 zip URL，
  `pathInArchive` 为 `""`（zip 根直接是 SKILL.md 等文件）

---

## 三、技能包内部格式

每个技能目录内支持两种 manifest 格式（阶段1 已实现解析）：

### 1. skill.yaml（WorldSmith 原生格式，优先）

```yaml
id: my-skill
name: 我的技能
icon: globe                          # Naive UI 图标名，禁止 emoji
description: 技能描述
category: domain                     # domain | action | persona
version: 1.0.0
enabled: true
priority: 8
baseTools:
  - entity_list
  - entity_get
allowedTools:
  - entity_create
  - entity_update
triggers:
  - 生成
  - 批量
tags:
  - 创作
```

### 2. SKILL.md（Claude Code 标准格式，降级）

```markdown
---
name: my-skill
description: 技能描述
capabilities:
  internal:
    - entity.list
    - entity.get
  cli: []
  mcp: []
schema-context:
  entity-types:
    - region
---

# 技能提示词正文
...
```

### 图标规范

- **禁止 emoji 图标**（项目规范）：检测到 emoji 自动替换为默认图标 `module-builder`
- 推荐使用 Naive UI 图标名（如 `globe`、`book`、`magic`、`search`）

---

## 四、安装流程

```
用户选择技能
    │
    ▼
前端：downloadRemoteManifest(manifestUrl)  ← cmd_skills_download_manifest
    │
    ▼
前端：installSkillAndReload(opts)         ← cmd_skills_install + initSkillRegistry
    │
    ├─ Rust: 下载 zip（reqwest）
    ├─ Rust: sha256 校验（不匹配拒绝安装）
    ├─ Rust: 解压 pathInArchive 到 app_data_dir/skills/<skillId>/
    │        （更新场景先删旧目录；防 zip slip 路径穿越）
    ├─ Rust: 读取安装的技能版本
    │
    ▼
前端：initSkillRegistry()                 ← 重新扫描 skills/ 目录
    │
    ▼
技能立即可用（findSkillById / loadSkillPrompt 可查到）
```

### 卸载流程

```
前端：uninstallSkillAndReload(skillId)
    │
    ├─ Rust: 删除 app_data_dir/skills/<skillId>/ 目录
    │
    ▼
前端：initSkillRegistry()                 ← 重新扫描，技能从注册表移除
```

### 更新检测

```
前端：getInstalledVersions()              ← cmd_skills_get_installed_versions
前端：checkUpdates(remoteManifest)         ← 对比本地 vs 远程 version
    │
    ▼
返回有新版本的技能列表（前端提示用户更新）
```

---

## 五、安全模型

| 风险 | 防护措施 |
|---|---|
| 下载内容被篡改 | sha256 强制校验，不匹配拒绝安装 |
| zip slip 路径穿越 | `dest_clean` 移除 `..` 组件；`starts_with` 二次校验 |
| 非法 skill_id | 校验禁止 `/`、`\`、`..` |
| 恶意技能提示词 | 精选审核市场：技能源仓库 PR 审核后才合并 |
| 旧版本残留 | 更新场景先 `remove_dir_all` 再解压 |

---

## 六、多技能源配置（阶段3 扩展）

阶段3 前端 UI 将支持配置多个技能源仓库 URL：

```jsonc
// 用户配置（localStorage）
{
  "skillSources": [
    {
      "name": "官方精选",
      "manifestUrl": "https://raw.githubusercontent.com/xxx/worldsmith-skills/main/skills-manifest.json"
    },
    {
      "name": "社区技能",
      "manifestUrl": "https://raw.githubusercontent.com/yyy/community-skills/main/skills-manifest.json"
    }
  ]
}
```

前端合并多个源的 manifest，统一展示。用户可启用/禁用各个源。

---

## 七、Tauri 命令清单

| 命令 | 用途 | 参数 |
|---|---|---|
| `cmd_skills_get_dir` | 获取 skills 根目录路径（阶段1） | 无 |
| `cmd_skills_download_manifest` | 下载 skills-manifest.json | `url` |
| `cmd_skills_install` | 下载+校验+解压安装技能 | `downloadUrl`, `pathInArchive`, `sha256Expected`, `skillId` |
| `cmd_skills_uninstall` | 卸载技能 | `skillId` |
| `cmd_skills_get_installed_versions` | 查询已安装技能版本 | 无 |
