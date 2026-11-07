---
status: 现行
---

# GitHub 仓库配置现状与待办（交接）

> 交接对象：后续会话或直接操作仓库的人。
> 记录日期：2026-11-07（§六–§七 为 2026-11-08 补齐）。仓库：`LINGTIAN303/WorldSea`。

## 一、一句话结论

仓库已转为**公开**，四项 CI 检查（门禁 / WASM / 类型 / 单测）已设为合并的**强制前置条件**，`main` 禁直推、禁强推、禁删除。平台级约束已真正生效，不再只靠流程自觉。

2026-11-08 补第二轮：元数据填齐、许可识别修复为 MIT、安全面五项开启、协作模板补齐、CI 四项加固、合并方式收紧为 squash-only。**当前已无「该开而没开」的平台能力**，剩余项见 §6.2 末尾（需 GHAS 的两项）与 CodeQL（独立批次）。

## 二、当前实测状态

### 2.1 已生效的约束

| 能力 | 状态 | 实测依据 |
|---|---|---|
| 仓库可见性 | **public** | `gh api repos/.../WorldSea` → `private: false` |
| 必需状态检查 | **4 项全开 + `strict: true`** | 见 §2.2 |
| 管理员同样受限 | `enforce_admins: true` | 同上 |
| 直推 main | **被拒** | 实测反证：`GH006: Protected branch update failed`、`4 of 4 required status checks are expected` |
| 强推 / 删除分支 | 禁用 | `allow_force_pushes: false` / `allow_deletions: false` |
| 会话未解决时禁止合并 | 启用 | `required_conversation_resolution: true` |
| 合并后自动删分支 | 已开启 | `delete_branch_on_merge: true` |
| `gh` CLI 登录 | 可用 | `gh auth status` |

### 2.2 四项必需检查

按 yml 里 `jobs.<id>.name` 逐字匹配：

| 必需检查 | 对应 job |
|---|---|
| `Repo Gates (arch / fork / style / docs)` | `gates` |
| `WASM Core (worldsea-core)` | `wasm-core` |
| `Frontend Typecheck` | `frontend` |
| `Unit Tests (vitest)` | `unit-tests` |

`strict: true` 的含义：PR 分支必须**基于最新 main** 才能合入。过了检查但 main 又前进，需要先同步再合。

> **名字必须逐字一致**。`contexts` 里写错一个字符，GitHub 会一直等一个永远不会出现的检查，PR 永久卡住。改 job 名时必须同步改保护配置。

### 2.3 历史：转公开之前的状态

以下内容保留，因为「为什么必须转公开」是可复用的判断依据。

转公开前，账号 `plan: free` + 仓库 `private: true`，三项能力全部返回：

```
403 Upgrade to GitHub Pro or make this repository public to enable this feature.
```

| 当时不可用 | 现在 |
|---|---|
| Rulesets（规则集） | 可用（本项目改用分支保护 REST API，见下） |
| Branch protection（分支保护） | 可用，已配置 |
| 依赖两者的 required checks | 可用，已配置四项 |

`allow_auto_merge` 在私有期曾 PATCH 设 `true`，接口返回 200 但实际值仍为 `false`（静默忽略）。**转公开后重新设置才会真正生效。**

**为什么用分支保护 REST API 而非 Rulesets**：两者功能重叠，但分支保护 API 更稳定、`gh` 支持更好、返回结构更易核对。Rulesets 的优势是能同时管多个分支、支持按文件路径条件——本项目只有 `main` 一条受保护分支，用不上。

### 2.4 转公开之前先做的扫描（已完成）

结论：**可以安全公开**。依据（扫描全部 22,952 个 git 跟踪文件）：

| 检查 | 结果 |
|---|---|
| 真实密钥 / 凭据 | **0 处**。项目自有代码（`dsh/` 之外）零命中 |
| vendored `dsh/` 内 138 处命中 | **全部测试假值**，非真实凭据 |
| 本机绝对路径泄露 | 2 处，均为通用占位符 `C:\Users\tester` |

`dsh/` 内部抽样核实：

| 文件 | 内容 | 性质 |
|---|---|---|
| `dsh/apps/desktop/tests/windows-sign.spec.ts` | `BUILD_PASSWORD: 'build-secret'` | 测试桩 |
| `dsh/scripts/smoke-python-runtime.py` | `api_key="sk-keyless-smoke"` | 明确 fake |
| `dsh/packages/session/message-quotes/tests/...spec.tsx` | `'sk-1234567890abcdefghijklmnopqrstuvwxyz'` | 顺序字母表 |

复现脚本：`.tmp/scan-secrets.ps1`（不入库，头部写明用法与依赖）。

**两点仍需注意**：

- **提交历史同样公开**。本次扫描的是工作树内容；若历史上曾有凭据被提交后删除，仍会残留。需要时可逐模式查：`git log -p -S'ghp_'`
- `.gitignore` 已覆盖 `project_memory.md`（本机项目记忆）、`.tmp/`、`node_modules/` 等敏感与本地产物

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

### 3.2 5 个 spec 依赖 dsh 构建产物，按产物存在与否自动跳过

**这是接单测进 CI 后立刻暴露的第二个问题**，值得单独记，因为它的表现形式极具误导性。

现象：CI 上 `Test Files 5 failed | 306 passed`，错误统一为——

```
Error: Failed to resolve entry for package "@deepseek-ai/schemastery".
The package may have incorrect main/module/exports specified in its package.json.
```

本地却完全通过（311 个文件全绿）。

**根因链**：

```
apps/dsh-plugin-worldsea/__tests__/config.spec.ts
  └─ import * as plugin from '../lib/index.js'      ← 已入库
       └─ import { ... } from '@deepseek-ai/schemastery'
            └─ package.json 声明 main: lib/index.cjs   ← 构建产物
                 └─ dsh/.gitignore:7 忽略 lib/          ← 不在 git 里
```

`dsh/vendor/schemastery` 的 `package.json` 指向 `lib/index.cjs`，而 `lib/` 是 `tsc` + `tsdown` 的产物，被 `dsh/.gitignore` 忽略。CI 全新克隆拿不到它，于是解析失败。

**本地为什么看不出**：本地 `lib/` 是历史构建留下的，一直存在。这类问题无法靠「本地多跑几遍」发现——只有真正在干净环境里跑才会暴露。

**当前处置：按产物存在与否自动跳过这 5 个 spec**，而非在 CI 里补建整条构建链。

`vitest.config.ts` 的 `exclude` 用 `existsSync` 判 `dsh/vendor/schemastery/lib/index.cjs`：不存在才排除那 5 个文件。

选择这个判据而非 `process.env.CI` 的理由：

- 本地留有产物时**照常跑**，覆盖不丢
- 哪天构建链补进 CI，会自动恢复覆盖，不需要回来改配置
- 写死 `CI` 环境变量会让本地与 CI 永久分叉，且分叉本身不可见

**必须展开 `configDefaults.exclude`**——vitest 的 `exclude` 是**整体覆盖**而非追加。直接写自己的数组会连默认的 `**/node_modules/**` 一起丢掉，于是全仓 `node_modules` 被当成测试源扫描：实测文件数由 311 暴涨到 1060、耗时从 200 秒涨到 570 秒，且"全绿"掩盖了范围失控。正确写法：

```ts
import { defineConfig, configDefaults } from 'vitest/config'
// ...
exclude: [...configDefaults.exclude, ...(有产物 ? [] : [五个文件])]
```

实测双向：

| 场景 | 文件 | 测试 | 退出码 |
|---|---:|---:|---:|
| 有产物（本地） | 311 | 2466 过 + 1 skip | 0 |
| 无产物（模拟 CI） | 306 | 2425 过 + 1 skip | 0 |

### 3.3 为什么没在 CI 里补建整条构建链

试过，逐层撞新依赖，越补越深：

| 尝试 | 结果 |
|---|---|
| 只 `tsc` + `tsdown` schemastery | `TS6305: cosmokit/lib/types/index.d.ts has not been built` |
| 前置构建 cosmokit | `TS2307: Cannot find module '@standard-schema/spec'` |
| `pnpm install --filter "./vendor/*"` 补依赖 | 成功（约 11 秒，只装 9 个包） |
| 子在包内跑 `npx tsdown` | `No workspace packages found`（无本地配置，靠根配置的 workspace 发现） |
| 改用 dsh 根目录 `npx tsdown` | 本地通过，但 CI 报 `Cannot find module typert/generator/lib/types/tsdown-plugin.js`——根 tsdown 配置又引用了另一个未构建的产物 |

根本原因：`dsh/` 是**独立 workspace**（396 个项目，`node_modules` 约 1.97 GB），根 `pnpm-workspace.yaml` 只含 `packages/*` 与 `apps/*`，所以根目录的 `pnpm install` 完全不碰 dsh 侧。要让这 5 个 spec 在 CI 跑起来，等于要把 dsh 的完整构建链搬进 CI——那是一个独立专题，不该顺手塞进「接单测进 CI」这一批。

**遗留待办**：若要恢复这 5 个 spec 的 CI 覆盖，正确做法是在 `unit-tests` job 里跑 dsh 官方构建命令（`dsh/package.json` 的 `build:lib`），并把耗时（预计 +5～10 分钟）纳入权衡。

### 3.4 `gates` 必须 `fetch-depth: 0`

`fork:check` 要 `git diff <基线提交>`，浅克隆取不到历史。实测浅克隆直接报 `❌ 台账里的基线提交在本仓不存在`。这不是保险起见，是必需项。

### 3.5 触发面

`on.push.branches: ['**']`——覆盖全部开发分支。此前只配 `[main]`，而实际开发在 `feat/*` 上，等于 CI 根本不触发。

## 四、配置复现与验收

### 4.1 分支保护的实际配置（已执行）

```bash
gh api -X PUT repos/LINGTIAN303/WorldSea/branches/main/protection \
  --input .tmp/branch-protection.json
```

`.tmp/branch-protection.json` 内容：

```json
{
  "required_status_checks": {
    "strict": true,
    "contexts": [
      "Repo Gates (arch / fork / style / docs)",
      "WASM Core (worldsea-core)",
      "Frontend Typecheck",
      "Unit Tests (vitest)"
    ]
  },
  "enforce_admins": true,
  "required_pull_request_reviews": null,
  "restrictions": null,
  "allow_force_pushes": false,
  "allow_deletions": false,
  "required_conversation_resolution": true
}
```

要点：

- `contexts` 与 ci.yml 的 `jobs.<id>.name` **逐字一致**，写错一个字符 PR 会永久卡住
- `enforce_admins: true` 是关键——否则管理员可绕过，等于没配
- `required_pull_request_reviews: null`：单人开发，GitHub 不允许自审；强求 review 会让自己的 PR 无法合并。若要 review 约束，需另建机器账号
- `strict: true` 要求 PR 基于最新 main，main 前进后需先同步

### 4.2 验收结果

| # | 动作 | 实测结果 |
|---|---|---|
| 1 | `gh api repos/... --jq '.private'` | `false` |
| 2 | 查 `branches/main/protection` | 返回完整对象，四项 contexts + `enforce_admins: true` |
| 3 | **直推 main 反证** | **被拒**：`GH006: Protected branch update failed`、`4 of 4 required status checks are expected`、`protected branch hook declined` |
| 4 | 合并 PR #4 | 成功（`38c92f7`），squash + 自动删远端分支 |
| 5 | 合并后 | 远端分支已删除，本地 `git fetch --prune` 后同步清理 |

第 3 项是**实际推了一次被 GitHub 拒**，不是「配置看起来对」。

### 4.3 可选：开启自动合并

```bash
gh api -X PATCH repos/LINGTIAN303/WorldSea -F allow_auto_merge=true
```

开启后 CI 绿时 PR 可自动合。此前在私有期设过但被静默忽略，**公开后需重新设置才生效**。当前未开——保持手动合并以便看清每次进了什么。

### 4.4 Actions 用量

公开仓库的 `ubuntu-latest` 标准 runner 不计费。私有期免费额度 2000 分钟/月，`unit-tests` 是全仓最大用量来源（每次约 3–10 分钟）。现已无需关注。

## 五、历史注脚：为什么 CI 曾长期红着

PR #3 之前，`main` 上自 2026-11-06 起连续 5 次 CI 失败（如 run 42377406408），原因单一：`docs/plans/已完成/agent-orchestration-roadmap.md` 有两处链接指向根目录 `project_memory.md`，而该文件按 `.gitignore` 约定「本机维护，不入库」。

门禁 `check-doc-links.mjs` 用 `fs.existsSync` 判定，**本地因文件存在而通过，CI 全新克隆必然断链**——这就是「本地全绿、CI 红」的分裂机制。已修复（提交 `7a65956`）：改为纯文字引用并注明「本机维护不入库」。

**没有**为此给校验器开白名单——那会让「文档不能链到不入库文件」这条约定一起失效。

教训：任何指向 gitignore 文件的相对链接，都是必然断链。写文档时链接之前先确认目标是否入库。

## 六、缺口盘点与补齐（2026-11-08）

§一到§五记述的是 2026-11-07 那一轮建成的部分。本节记录 2026-11-08 全量实测发现的**未配置项**，以及同一轮的补齐结果。

### 6.1 元数据（已补齐）

| 项 | 补齐前 | 补齐后 | 影响 |
|---|---|---|---|
| `description` | `null` | 已填（一句话定位 + 技术栈） | 仓库页与搜索结果无说明 |
| `topics` | `[]` | 13 个 | 无法被 GitHub 主题检索命中 |
| `homepage` | `null` | 仍为 `null` | 暂无对外站点 |
| `license` | `NOASSERTION` | **`MIT`** | **MIT 徽标不显示，`license:mit` 检索筛不到** |

**`NOASSERTION` 的成因**：`LICENSE` 在标准 MIT 正文后追加了 `---` 分隔线与中文第三方声明段。GitHub 的 licensee 解析器要求文件近似逐字匹配已知许可模板，尾部追加内容即判为「Other」。修复方式是把自定义段落移出 `LICENSE`——内容本身已完整存在于 `THIRD-PARTY-NOTICES.md`，并在 `README.md` 的 License 段补充指向，不构成信息丢失。

**topics 的写入口**：`gh api -f 'topics[]=x'` 对数组字段不生效（返回 200 但值不变），必须用 `gh api -X PUT .../topics --input <json>` 传 `{"names":[...]}`。

### 6.2 安全面（已补齐）

| 能力 | 补齐前 | 补齐后 |
|---|---|---|
| `dependabot_security_updates` | `disabled` | **`enabled`** |
| `secret_scanning` | `disabled` | **`enabled`** |
| `secret_scanning_push_protection` | `disabled` | **`enabled`** |
| Dependabot alerts | 未开启 | **已开启** |
| 私有漏洞上报 | `enabled: false` | **`enabled: true`** |
| `secret_scanning_non_provider_patterns` | `disabled` | 仍 `disabled` |
| `secret_scanning_validity_checks` | `disabled` | 仍 `disabled` |
| CodeQL | 无分析 | 未启用 |

后两项需要 GitHub Advanced Security，公开仓库免费档不支持——是**已知边界**，不是遗漏。CodeQL 本身对公开仓库免费，但本仓 TypeScript + Rust 的 CodeQL 配置属于独立批次，未纳入本轮。

公开仓库放弃 secret scanning + push protection 是纯损失：二者对 public repo 免费，且是防「误提交凭据」的唯一平台级拦截。

**命令口径**：这三类开关分别在三个不同端点，不能一次 PATCH 搞定：

```bash
# 1. 漏洞告警（无请求体，204 即成功）
gh api -X PUT repos/LINGTIAN303/WorldSea/vulnerability-alerts

# 2. secret scanning + push protection（走 security_and_analysis）
gh api -X PATCH repos/LINGTIAN303/WorldSea --input .tmp/security-and-analysis.json

# 3. Dependabot 自动修复 + 私有漏洞上报
gh api -X PUT repos/LINGTIAN303/WorldSea/automated-security-fixes
gh api -X PUT repos/LINGTIAN303/WorldSea/private-vulnerability-reporting
```

### 6.3 协作与流程文件（已补齐）

补齐前 git 跟踪的元文件只有 `LICENSE`、`README.md`、`.github/workflows/ci.yml`、`.githooks/*`。本轮新增：

| 文件 | 作用 |
|---|---|
| `.github/pull_request_template.md` | 自查项对应真实踩过的坑（断链、产物未重建、job 名不同步） |
| `.github/ISSUE_TEMPLATE/bug.yml` / `feature.yml` / `config.yml` | issue 表单；config 把安全问题导向私密上报，避免公开 issue 贴凭据 |
| `SECURITY.md` | 凭据泄露处置顺序：**先轮换、再清历史** |
| `CONTRIBUTING.md` | 本仓**实际执行**的流程，含「本地全绿不等于 CI 会绿」的分叉机制 |
| `.github/CODEOWNERS` | 单人项目下不自动指派评审人，实际作用是高风险路径登记清单 |
| `.github/dependabot.yml` | 根级依赖更新策略（见 6.7） |

`dsh/.github/dependabot.yml` 是 vendored fork 自带的，不覆盖仓库根，不应改动。

### 6.4 CI 工程面（已补齐）

| 项 | 补齐内容 |
|---|---|
| `concurrency` | 按「事件 + 分支」分组，连续推送时新 run 取消旧 run |
| `permissions` | 显式 `contents: read`，不再依赖仓库默认值 |
| cargo 缓存 | `wasm-core` 加 `Swatinem/rust-cache@v2`（`workspaces: worldsea-core`） |
| 检查名一致性 | 新增 `scripts/check-ci-required-checks.mjs`，接入 `gate.mjs` |

**concurrency 的分组键为什么带 `event_name`**：push run 与 PR run 必须互不取消。若同组并设 `cancel-in-progress`，后启动的 push run 可能取消 PR run；被取消的 run 会让分支保护要求的检查永远停在 pending，PR 再也合不了。代价是分支有 PR 时同一提交跑两遍——删任一触发源都更糟：删 `push` 通配会让开发分支未开 PR 期间的提交失去校验（本仓曾因此 242 个提交零校验），删 `pull_request` 会让分支保护的 PR 检查失去权威 run。

**检查名门禁双向判据**：① 每个 context 都能在 ci.yml 找到同名 job（否则该检查永不到达，PR 卡死）；② 每个 job 都出现在 contexts 里（否则该 job 跑红也不拦合并）。无 `gh` 或无管理员权限时降级为静态自检，不阻塞本地开发。

反证实测：把 job 名 `Unit Tests (vitest)` 改成 `Unit Test (vitest)` → 双向报红、exit=1；新增一个未列入保护的 job → 报「未列入必需项」、exit=1；恢复后 exit=0。

### 6.5 合并策略（已收紧）

三项此前全开，现为：

| 设置 | 值 |
|---|---|
| `allow_squash_merge` | `true` |
| `allow_merge_commit` | `false` |
| `allow_rebase_merge` | `false` |
| `allow_update_branch` | `true`（开启「更新分支」按钮，便于满足 `strict`） |
| `delete_branch_on_merge` | `true` |

`required_linear_history` 仍为 `false`：三种合并方式里只剩 squash，已不可能在 `main` 上产生合并节点，此项无需再单独开启。`strict: true` 要求 PR 基于最新 `main`，而 main 在 PR 排队期间必然前进，因此 `allow_update_branch` 是配套项。

### 6.6 规模约束（影响任何全仓级配置）

仓库报告大小 105,367 KB，跟踪文件 22,954 个，其中 20,325 个（88.6%）位于 `dsh/`（vendored fork）。因此：

- Dependabot 必须排除 `dsh/`，否则单次更新会淹没 issue 列表
- 任何全仓扫描 / 缓存策略要先把 `dsh/` 划出去

### 6.7 依赖更新策略（新增）

`.github/dependabot.yml` 四组：npm（根 workspace）、cargo ×2（`worldsea-core` / `tactical-engine`）、github-actions。

要点：

- **不纳入 `dsh/`**：见 6.6，且它是上游 fork，依赖应随上游升级节奏走
- **groups 合并 minor/patch**：依赖面大，不合并会被补丁版本 PR 刷屏，真正的安全更新反被埋掉
- **ignore 两类 major**：`@tauri-apps/*` 与 `vue` 需与 Rust 侧配对或配套迁移，交给人工一起升

**实测发现的 Dependabot 行为**：开启 security updates 后，它立刻开出了 PR（`#11` storybook、`#12` dompurify、`#13` vite），说明配置生效。其中 security update 作业本身在 updater 容器内失败（`update_files` 退出码 1，日志无更具体原因），但 version update 路径正常——即漏洞发现与 PR 创建可用，仅自动修复链不稳定。这是 Dependabot 侧行为，与本仓配置无关，记为已知现象。

## 七、本轮验收记录（2026-11-08）

五个 PR 全部走 PR 合并，无一例直推 `main`：

| PR | 内容 | 验收 |
|---|---|---|
| #6 | LICENSE 恢复纯 MIT，修复许可识别 | 合并后 `license.spdx_id` = `MIT` |
| #7 | §六 缺口底单 + 索引摘要校正 | 断链 0、绝对路径 0 |
| #8 | CI 加固（concurrency / permissions / 缓存 / 检查名门禁） | 门禁 6 项全过；检查名门禁双向反证通过 |
| #9 | 协作流程文件 | js-yaml 解析三份模板通过 |
| #10 | 依赖更新策略 | js-yaml 解析通过 |

**实测到的分支保护行为**：

- `strict: true` 下，main 前进后 PR 变 `BEHIND`，合并被拒（`not mergeable: head branch is not up to date`）。这是配置在起作用，不是故障。
- 同步方式优先 `gh api -X PUT .../pulls/<n>/update-branch`（产生 merge commit）；由于 squash-only 策略要求线性，本地改用 `git rebase main` + `--force-with-lease` 推送，保持分支单提交。
- `allow_update_branch` 开启后 API 更新分支可用。

**本地验证与 CI 的关系**：本轮所有改动都在本地跑过 `pnpm gate`（6 项）后才推送。CI 每次 8 个 job 全绿，与本地结论一致。
