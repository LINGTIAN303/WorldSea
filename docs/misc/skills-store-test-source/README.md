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

### PowerShell 命令（必须用正斜杠 `/` 作为 zip 内路径分隔符）

> **重要**：Windows PowerShell 5.1 的 `Compress-Archive` 和 `ZipFile.CreateFromDirectory`
> 会用反斜杠 `\` 生成 zip 条目名，选成 Rust zip crate 解压时路径匹配失败（所有文件被跳过）。
> 必须用 `ZipArchive` 手动创建，明确指定 entry 名用正斜杠 `/`（符合 zip 标准）。

```powershell
# 进入技能源目录
cd 'docs/skills-store-test-source'

# 用 .NET ZipArchive 手动创建 zip（entry 名用正斜杠）
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$dst = Join-Path (Get-Location) 'skills\example-creator.zip'
if (Test-Path $dst) { Remove-Item $dst -Force }
$zip = [System.IO.Compression.ZipFile]::Open($dst, 'Create')
[System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, (Resolve-Path 'skills\example-creator\SKILL.md').Path, 'example-creator/SKILL.md') | Out-Null
[System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, (Resolve-Path 'skills\example-creator\skill.yaml').Path, 'example-creator/skill.yaml') | Out-Null
[System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, (Resolve-Path 'skills\example-creator\references\naming-guide.md').Path, 'example-creator/references/naming-guide.md') | Out-Null
$zip.Dispose()

# 计算 sha256（小写十六进制）
$hash = (Get-FileHash $dst -Algorithm SHA256).Hash.ToLower()
Write-Output "sha256: $hash"
```

### GitHub raw URL（推荐）

将 zip 提交到仓库后，用 GitHub raw URL 作为 `downloadUrl`：

```
https://raw.githubusercontent.com/<user>/<repo>/main/docs/skills-store-test-source/skills/example-creator.zip
```

此时 `pathInArchive` 应为 `example-creator`（zip 内技能目录名）。

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
      "downloadUrl": "https://raw.githubusercontent.com/LINGTIAN303/WorldSmith/main/docs/skills-store-test-source/skills/example-creator.zip",
      "pathInArchive": "example-creator",
      "sha256": "44986f18d6807faa966c5dbff2f170268ee60efa5fca6e3a09b449285dc23c5a"
    }
  ]
}
```

> **说明**：本示例 manifest 已填入真实 downloadUrl/sha256，提交后可直接用于端到端测试。
> 若重新生成 zip，需同步更新 sha256（用上面的 PowerShell 命令计算）。

---

## 四、端到端验证流程（阶段3 UI 完成后）

1. 将本目录推送至 GitHub 仓库
2. 生成 zip + sha256，更新 `skills-manifest.json` 中的 `downloadUrl`/`sha256`/`pathInArchive`
3. 在 WorldSmith 设置中添加技能源：`https://raw.githubusercontent.com/<user>/<repo>/main/docs/skills-store-test-source/skills-manifest.json`
4. 商城页应显示"角色创建助手"技能
5. 点击安装 → 验证 `app_data_dir/skills/example-creator/` 目录创建
6. Agent 技能列表应出现"角色创建助手"，可激活使用
7. 点击卸载 → 验证目录删除，技能列表移除

### Rust 单元测试（独立 crate，可独立运行）

```powershell
cd worldsmith-skills-store
cargo test
```

覆盖：zip 正常解压 / pathInArchive 子目录 / 更新场景 / zip slip 防护 / sha256 校验（成功/失败/大小写）/ 版本读取 / 字段提取 / 路径清理 / 本地导入写入（write_skill_files）/ skill_id 合法性校验。

> 纯逻辑从 `src-tauri/skills_store.rs` 提取到独立 crate `worldsmith-skills-store`，
> 解决 Tauri lib DLL 链接导致 `cargo test` 无法运行的问题（Task 24 方向3）。

---

## 五、多平台互通（Task 24 阶段4）

Skills Store 支持导入外部格式的技能文件，自动识别并转为 WorldSmith 格式：

| 格式 | 识别特征 | 字段映射 |
|------|----------|----------|
| Claude Code (SKILL.md) | frontmatter 含 `name`/`allowed-tools` | allowed-tools → allowedTools |
| Cursor (.mdc) | frontmatter 含 `alwaysApply`/`globs` | globs → tags（cursor-glob: 前缀）、alwaysApply → autoActivate |
| WorldSmith (skill.yaml) | 含 `baseTools`/`id` | 完整 manifest |

在 Skills Store 面板点击「本地导入」选择文件即可。导入后自动生成标准 `skill.yaml` + `SKILL.md` 写入 `app_data_dir/skills/<id>/`。
