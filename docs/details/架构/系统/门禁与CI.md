---
status: 现行
date: 2026-11-17
scope: 门禁与 CI
---

# 门禁与 CI

> 统一入口 `scripts/gate.mjs`，**6 项**检查，实测约 7.6s。
> 钩子：`.githooks/pre-commit` 跑四项、`pre-push` 加 typecheck。`SKIP_GATES=1` 是逃生门（用它要在提交信息里说明理由）。

## 一、六项检查

| 检查 | 脚本 | 查什么 | 当前基线 |
|---|---|---|---|
| 架构 | `scripts/architecture/check.mjs`（450 行） | ① 模块登记 ② 文件规模 ③ Rust path 依赖边 ④ TS 跨包依赖边 ⑤ TS 包级环 | 0 违规 / 54 超限（= 冻结基线） |
| dsh fork 台账 | `scripts/check-dsh-fork-ledger.mjs` | `git diff <基线> -- dsh` 的每个文件都须在台账 | 13 条目 / 通过 |
| dsh 产物新鲜度 | `scripts/check-dsh-artifacts.mjs` | 373 个包的产物与源码一致 + 版本注入 | 通过 |
| 样式一致性 | `scripts/style-conformance/check.mjs` | 裸色值（hex / rgba）/ box-shadow / backdrop-filter 计数不超基线 | hex 718 / rgba 166 / boxShadow 146 / backdropFilter 8 |
| 文档链接 | `scripts/check-doc-links.mjs` | 相对链接断链 + 绝对路径 | 断链 0 / 绝对路径 0 |
| CI 必需检查名 | `scripts/check-ci-required-checks.mjs` | `ci.yml` 与分支保护 contexts 一致 | 通过 |

> `架构策略与检查器.md:32` 写「4 项」「≈1.8s」是旧口径（不含 artifacts / ci 两项）。以本表为准。

## 二、架构检查的五类

| # | 检查 | 依据 |
|---|---|---|
| 1 | 模块登记 | `architecture-policy.json` 的 30 个模块清单 |
| 2 | 文件规模 | 全局 400 行；`tests` / `.spec.` / `.test.` 覆盖 1200 |
| 3 | Rust path 依赖边 | `use crate::` 的白名单 |
| 4 | TS 跨包依赖边 | `requires` 白名单 40 条 |
| 5 | TS 包级环 | 3 条存量豁免（`plugin-sdk|ui-kit` 环 + 两个 dsh 插件 app 未登记） |

### 文件规模的两个坑

1. **门禁计数 = `split('\n').length`，比编辑器报的行数多 1**。实测确认：`tree.ts` 实际 399 行、门禁算 400；`FileStorageBackend.ts` 实际 928、门禁 929。所以「顶线」文件实际还有 1 行余量，不是 0。
2. **`--changed` 只查变更文件的新增违规**，未变更的超限文件不报——日常提交靠它，等于存量债务不再被看见。要看全量得跑全量模式。

### 正好顶线的文件

| 文件 | 实际 | 门禁口径 | 余量 |
|---|---:|---:|---:|
| `world/tree.ts` | 399 | 400 | 0 |
| `shell/capabilities.ts` | 398 | 399 | 1 |
| `ui-kit/useShortcuts.ts` | 422 | 423 | 0（= 冻结值） |
| `AutoLinkEngine.ts` | 681 | 682 | 0（= 冻结值） |

改动这四个文件时，必须先想清楚是「拆出去」还是「等量置换」。

## 三、`--update-baseline` 的风险

`check.mjs:429-443` 的 `--update-baseline` **没有 dry-run**，直接写盘。误用一次就会把新增违规固化成基线，此后门禁永远是绿的。

用它的唯一正当场景：确实做了「等量置换」（如一个超限文件拆成两个合规文件，基线需要跟着减一条）。用前先 `git diff` 看清它要写什么。

## 四、钩子安装

```bash
pnpm prepare      # 自动装 .githooks（clone 后首次 install 时触发）
```

`prepare` 里调 `scripts/install-git-hooks.mjs`。钩子不随 clone 生效（`.git/hooks` 不在版本控制里），所以要装。

## 五、CI

`ci.yml` 有 `gates` job，触发面是**全部分支**（不只是 `main`）。分支保护的必需检查名由 `check-ci-required-checks.mjs` 与 `ci.yml` 对账，两边不一致就报红——这是防「改了 job 名导致保护失效」。

## 六、文档门禁的实际口径

`check-doc-links.mjs` 做两件事：

1. 相对链接能否解析到真实文件（断链 0）
2. 是否出现绝对路径（如 `D:\`、`C:/Users/…`；绝对路径 0）

它**不检查**：链接文字是否与目标内容相符、文档是否过时、索引是否同步。这三件靠人工。

**批量文档变更后必跑**，因为一次 `git mv` 能造出几十条断链，而断链在页面上只表现为「点不动」。
