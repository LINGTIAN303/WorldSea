# manifest.ts 详细注释文档（packages/agent-runtime/skills）

> 来源：`packages/agent-runtime/src/skills/manifest.ts` 中连续 ≥ 10 行的长注释块，按文件内出现顺序迁移至此。
> 代码内原位置已替换为一行简要注释 + 相对路径。

## 注释块 1（原文件第 1-22 行）

```
已安装技能 Manifest 解析器（Task 24 阶段1）

从 app_data_dir/skills/ 目录扫描已安装技能（Skills Store 通过 Git 安装），
解析其 manifest（skill.yaml 优先，SKILL.md frontmatter 降级），转换为 SkillMeta。

已安装技能目录结构：
  <app_data_dir>/skills/
    my-skill/
      skill.yaml          # 完整 manifest（优先，WorldSea 原生格式）
      SKILL.md            # 提示词（Claude Code 标准格式，frontmatter 作为 manifest 降级源）
      references/         # 参考文档
      assets/             # 资源文件
      instructions.md     # 备选提示词

设计要点：
- 仅在 Tauri 环境工作；非 Tauri（如 vitest）返回空数组，零回归。
- 不依赖 loader.ts / registry.ts，避免循环依赖。
- 复用 parser.ts 的 parseFrontmatter（支持 capabilities/schemaContext 嵌套），
  skill.yaml 包装成 frontmatter 格式后统一解析，两种格式能力等价。
- 禁止 emoji 图标：检测到 emoji 时替换为默认图标（项目规范）。
```

## 注释块 2（原文件第 151-162 行）

```
扫描已安装技能目录，返回所有有效技能的 manifest

流程：
1. 获取 skills 根目录（cmd_skills_get_dir）
2. 列举子目录（cmd_fs_list）
3. 每个子目录优先读 skill.yaml（包装成 frontmatter 解析），降级读 SKILL.md frontmatter
4. 检测提示词文件（SKILL.md → instructions.md），设 promptFile
5. frontmatterToSkillMeta 转换为 SkillMeta

非 Tauri 环境或目录为空时返回空数组（零回归）。
```
