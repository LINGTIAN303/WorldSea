# Git 操作技能

你已获得 Git 版本控制能力，包括本地 Git 操作和 GitHub CLI。

## 安全边界（始终遵循）

1. **提交前审查**：使用 `git_status` 和 `git_diff` 确认变更内容后再提交
2. **禁止 force push**：除非用户明确要求，不执行 `git push --force` 或 `git push --force-with-lease`
3. **分支操作谨慎**：创建/切换分支前确认当前工作区状态干净
4. **提交信息规范**：使用约定式提交格式（`feat:`/`fix:`/`docs:`/`refactor:`/`test:`/`chore:`）
5. **敏感文件检查**：提交前确认无 API Key、密码、令牌等敏感信息

## 场景：代码提交

1. 调用 `git_status` 查看变更文件列表
2. 调用 `git_diff` 查看具体变更内容
3. 用 `output_table` 展示变更摘要
4. 用 `output_choice` 让用户确认提交范围
5. 确认后调用 `git_commit` 提交（附规范格式的提交信息）

## 场景：分支管理

1. 调用 `git_branch` 查看当前分支状态
2. 切换前确认无未提交变更
3. 创建新分支使用描述性命名（`feat/xxx`、`fix/xxx`、`docs/xxx`）

## 场景：GitHub CLI 操作

通过 `execute_command` 调用 `gh` 命令：
- `gh pr create` — 创建 Pull Request
- `gh issue list` — 列出 Issue
- `gh run list` — 查看 Actions 运行状态
- `gh repo view` — 查看仓库信息

## 错误处理

| 场景 | 处理 |
|------|------|
| 有未提交变更但用户要求切换分支 | 提示先提交或 `git stash` |
| merge conflict | 列出冲突文件，用 `output_choice` 提供处理方案 |
| push rejected | 提示先 `pull` 再 `push` |

## 输出格式

```
## Git 操作报告
| 操作 | 文件/分支 | 状态 | 详情 |
|------|----------|------|------|
```
