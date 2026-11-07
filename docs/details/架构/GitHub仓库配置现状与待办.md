---
status: 现行
---

# GitHub 仓库配置现状与待办（交接）

> 交接对象：后续会话或直接操作仓库的人。
> 记录日期：2026-11-07。仓库：`LINGTIAN303/WorldSea`。

## 一、一句话结论

CI 已具备四项真实检查（门禁 / WASM / 类型 / **单测**），但**平台级强制约束（规则集、分支保护）在私有仓库 + 免费账号下不可用**。补救路径是把仓库转为公开——本文记录转换前后的准确状态、可做与不可做的边界，以及转换后要补配的具体内容。

## 二、当前实测状态

### 2.1 已可用的能力

| 能力 | 状态 | 实测依据 |
|---|---|---|
| GitHub Actions 运行 | 可用 | CI run 42380848800 `success` |
| CI 四项检查 | 可用 | 见 §三 |
| 合并方式 | merge / squash / rebase **三种全开** | `gh api repos/.../WorldSea` |
| 合并后自动删分支 | **已开启** | `delete_branch_on_merge: true` |
| `gh` CLI 登录 | 可用（keyring，含私有仓读权限） | `gh auth status` |

### 2.2 受限的能力（**卡点在此**）

以下三项全部返回同一错误，不是权限配置问题，是账号计划限制：

```
403 Upgrade to GitHub Pro or make this repository public to enable this feature.
```

| 能力 | 用途 | 为什么重要 |
|---|---|---|
| **Rulesets**（规则集） | 定义「必须过哪些检查才能合」 | 让 CI 结果成为合并的**硬约束**而非提示 |
| **Branch protection**（分支保护） | 禁直推 main、要求 review | 防止绕过 PR 直接推主干 |
| 依赖上述两者的 required checks | —— | 无前两者则无法设置 |

**判定依据**：账号 `plan: free` / `type: User`，仓库 `private: true`。GitHub 对免费账号的**私有**仓库不提供分支保护与规则集；公开仓库则免费可用。

`allow_auto_merge` 亦不可用：曾 PATCH 设 `true`，接口返回 200 但实际值仍为 `false`（静默忽略，不报错——这点容易误判为「已开启」）。

### 2.3 由此产生的现实风险

服务端**无法阻止**任何人（包括 Agent）直接 `git push origin main`，也无法阻止 CI 红着合并。PR #1–#3 之所以规矩，是因为流程自觉，不是因为平台拦截。

唯一剩下的本地拦截是 `.githooks/pre-push`（跑 `gate.mjs` + `vue-tsc`），但它可被 `git push --no-verify` 或 `SKIP_GATES=1` 绕过——这是 git 原生行为，无法禁止。

## 三、CI 现状（`.github/workflows/ci.yml`）

四个 job，全部 `runs-on: ubuntu-latest`：

| Job | 跑什么 | 覆盖的失败面 |
|---|---|---|
| `gates` | `pnpm gate`（架构 / fork 台账 / 样式 / 文档链接） | 结构漂移、断链、样式基线超限 |
| `wasm-core` | `cargo check --all-features` + `cargo test --features sqlite` | Rust 侧编译与单测 |
| `frontend` | `pnpm --filter @worldsea/tauri typecheck`（vue-tsc） | 类型错误 |
| `unit-tests` | `pnpm exec vitest run --reporter=dot` | **前端全部单测（2400+ 项）** |

### 3.1 `unit-tests` 是本轮新增

**此前不存在**。2466 个前端测试只在本地跑，CI 三项 job 全不覆盖——意味着漏跑测试照样全绿，「测试通过」的判定权完全交给本地自觉。

设计取舍：

- **覆盖范围不在此文件重复列举**，以 `vitest.config.ts` 的 `include` 为唯一事实源。两处维护必然漂移。
- **报告器固定 `--reporter=dot`**：默认 reporter 每个测试打一行，2400+ 行日志会把真正的失败信息淹掉。失败细节仍在末尾完整输出。
- **不设路径过滤**：全量跑，避免「改动影响到未过滤的包」这类漏跑。代价是每次 CI 时间上升。

### 3.2 `gates` 必须 `fetch-depth: 0`

`fork:check` 要 `git diff <基线提交>`，浅克隆取不到历史。实测浅克隆直接报 `❌ 台账里的基线提交在本仓不存在`。这不是保险起见，是必需项。

### 3.3 触发面

`on.push.branches: ['**']`——覆盖全部开发分支。此前只配 `[main]`，而实际开发在 `feat/*` 上，等于 CI 根本不触发。

## 四、转换为公开仓库：先决检查（已完成）

**结论：可以安全公开。** 依据如下（扫描范围：全部 22,952 个 git 跟踪文件）。

| 检查 | 结果 |
|---|---|
| 真实密钥/凭据 | **0 处**。项目自有代码（`dsh/` 之外）零命中 |
| vendored `dsh/` 内的 138 处命中 | **全部为测试假值**，非真实凭据 |
| 本机绝对路径泄露 | 2 处，均为通用占位符 `C:\Users\tester` |

`dsh/` 内 138 处的抽样核实结果：

| 文件 | 内容 | 性质 |
|---|---|---|
| `dsh/apps/desktop/tests/windows-sign.spec.ts` | `BUILD_PASSWORD: 'build-secret'` | 测试桩 |
| `dsh/scripts/smoke-python-runtime.py` | `api_key="sk-keyless-smoke"` | 明确的 fake |
| `dsh/packages/session/message-quotes/tests/...spec.tsx` | `'sk-1234567890abcdefghijklmnopqrstuvwxyz'` | 顺序字母表，显式假值 |

复现命令：`pwsh -File .tmp/scan-secrets.ps1`（脚本保留在 `.tmp/`，不入库；头部写明用法与依赖）。

### 4.1 公开后仍需注意

- **提交历史同样公开**。当前扫描的是工作树内容；若历史上曾有凭据被提交后删除，仍会残留。本次未做全历史扫描——如果需要，用 `git log -p -S'ghp_'` 之类逐模式查。
- 转为公开前应确认 `.gitignore` 覆盖完整：`project_memory.md`（本机项目记忆）、`.tmp/`、`node_modules/` 等已忽略。

## 五、转为公开后要补配的东西

按优先级排列，每项给出可直接执行的命令。

### 5.1 启用必需的 CI 检查（核心）

```bash
gh api -X PUT repos/LINGTIAN303/WorldSea/branches/main/protection \
  -F required_status_checks.strict=true \
  -f 'required_status_checks.contexts[]=Repo Gates (arch / fork / style / docs)' \
  -f 'required_status_checks.contexts[]=WASM Core (worldsea-core)' \
  -f 'required_status_checks.contexts[]=Frontend Typecheck' \
  -f 'required_status_checks.contexts[]=Unit Tests (vitest)' \
  -F enforce_admins=true \
  -F required_pull_request_reviews.required_approving_review_count=0 \
  -F restrictions=
```

要点：

- `contexts` 里的名字必须与 ci.yml 的 `jobs.<id>.name` **逐字一致**，否则永远等不到该检查。
- `enforce_admins=true` 是关键——否则管理员可绕过，等于没配。
- `required_approving_review_count=0`：单人开发，不能强制别人 review 自己的 PR（GitHub 不允许自审）。若要 review 约束，需要另建机器账号或改为「只要求 CI」。
- 用 REST 分支保护而非 rulesets：两者功能重叠，但分支保护 API 更稳定、`gh` 支持更好。

### 5.2 禁止直推 main

分支保护已隐含此效果（`required_status_checks` + PR 流程会把直推挡掉）。若想显式阻断，可在同一 PATCH 中确认 `enforce_admins=true` 已包含。

### 5.3 开启自动合并（可选）

```bash
gh api -X PATCH repos/LINGTIAN303/WorldSea -F allow_auto_merge=true
```

开启后 PR 可在 CI 绿时自动合，避免「等 CI 完再回来点合并」。**公开仓库方可生效**。

### 5.4 核对 Actions 用量（公开后不计费）

公开仓库的 `ubuntu-latest` 标准 runner 不计入免费额度。私有仓库免费额度为 2000 分钟/月——新增的 `unit-tests` job 每次约 6–10 分钟，是全仓最大的用量来源。转为公开后此项不再需要关注。

## 六、验证清单（转换完成后逐项核对）

| # | 动作 | 通过标准 |
|---|---|---|
| 1 | `gh api repos/LINGTIAN303/WorldSea --jq '.private'` | `false` |
| 2 | `gh api repos/.../branches/main/protection` | 返回含 `required_status_checks` 的对象，非 403 |
| 3 | 新建测试分支直推 main | **被拒绝** |
| 4 | 开一个 CI 会红的测试 PR | 合并按钮**不可用**，提示必需检查未通过 |
| 5 | 正常 PR 等 CI 绿 | 合并按钮可用 |
| 6 | 合并后 | 分支自动删除（`delete_branch_on_merge` 已开） |

## 七、历史注脚：为什么 CI 曾长期红着

PR #3 之前，`main` 上自 2026-11-06 起连续 5 次 CI 失败（如 run 42377406408），原因单一：`docs/plans/已完成/agent-orchestration-roadmap.md` 有两处链接指向根目录 `project_memory.md`，而该文件按 `.gitignore` 约定「本机维护，不入库」。

门禁 `check-doc-links.mjs` 用 `fs.existsSync` 判定，**本地因文件存在而通过，CI 全新克隆必然断链**——这就是「本地全绿、CI 红」的分裂机制。已修复（提交 `7a65956`）：改为纯文字引用并注明「本机维护不入库」。

**没有**为此给校验器开白名单——那会让「文档不能链到不入库文件」这条约定一起失效。

教训：任何指向 gitignore 文件的相对链接，都是必然断链。写文档时链接之前先确认目标是否入库。
