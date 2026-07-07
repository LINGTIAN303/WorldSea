# WorldSmith 测试技能源仓库

> Task 24 阶段2/3 · 用于 Skills Store 端到端验证
>
> 本目录是一个**示例技能源仓库**，供 Skills Store UI 测试安装/卸载/更新流程。
> 可作为真实 Git 仓库的模板，推送至 GitHub/Gitee 后通过 manifest URL 接入商城。

---

## 一、目录结构

```
skills-store-test-source/
├── README.md                          # 本文件
├── skills-manifest.json               # 技能索引清单（商城通过此文件发现技能）
└── skills/                            # 技能目录
    └── example-creator/               # 示例技能：角色创建助手
        ├── skill.yaml                 # WorldSmith 原生 manifest
        ├── SKILL.md                   # 提示词（Claude Code 标准格式）
        └── references/
            └── naming-guide.md        # 参考文档
```

---

## 二、生成 zip 包与 sha256（用于 manifest 的 downloadUrl/sha256）

### PowerShell 命令

```powershell
# 进入技能目录
cd 'docs/skills-store-test-source/skills/example-creator'

# 生成 zip（在 docs/skills-store-test-source/dist/ 下）
$zipPath = '..\..\dist\example-creator.zip'
New-Item -ItemType Directory -Force -Path '..\..\dist' | Out-Null
Compress-Archive -Path '.\*' -DestinationPath $zipPath -Force

# 计算 sha256（小写十六进制）
$hash = (Get-FileHash $zipPath -Algorithm SHA256).Hash.ToLower()
Write-Output "zip: $zipPath"
Write-Output "sha256: $hash"
```

### 推送到 GitHub 后生成 archive URL

```
https://github.com/<user>/<repo>/archive/refs/heads/main.zip
```

此时 `pathInArchive` 应为 `<repo-name>-main/skills/example-creator`。

---

## 三、skills-manifest.json 字段说明

```jsonc
{
  "name": "WorldSmith 测试技能集",
  "version": "1.0.0",
  "updated": "2026-07-07",
  "skills": [
    {
      "id": "example-creator",
      "name": "角色创建助手",
      "description": "辅助快速创建角色实体...",
      "version": "1.0.0",
      "author": "WorldSmith",
      "downloadUrl": "https://example.com/example-creator.zip",
      "pathInArchive": "example-creator",
      "sha256": "<填入实际 sha256>"
    }
  ]
}
```

> **注意**：`downloadUrl` 和 `sha256` 需在实际生成 zip 后填入。
> 本示例的 manifest 使用占位值，端到端测试时需替换为真实值。

---

## 四、端到端验证流程（阶段3 UI 完成后）

1. 将本目录推送至 GitHub 仓库
2. 生成 zip + sha256，更新 `skills-manifest.json` 中的 `downloadUrl`/`sha256`/`pathInArchive`
3. 在 WorldSmith 设置中添加技能源：`https://raw.githubusercontent.com/<user>/<repo>/main/docs/skills-store-test-source/skills-manifest.json`
4. 商城页应显示"角色创建助手"技能
5. 点击安装 → 验证 `app_data_dir/skills/example-creator/` 目录创建
6. Agent 技能列表应出现"角色创建助手"，可激活使用
7. 点击卸载 → 验证目录删除，技能列表移除

### Rust 单元测试（已覆盖，无需 UI）

```powershell
cd src-tauri
cargo test --lib skills_store
```

覆盖：zip 正常解压 / pathInArchive 子目录 / 更新场景 / zip slip 防护 / sha256 校验（成功/失败/大小写）/ 版本读取 / 字段提取 / 路径清理。
