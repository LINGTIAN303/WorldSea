# dsh 运行手册（仓内 `dsh/` 树）

> **status: 现行**（2026-09-23 建立，B1 迁入批次产物）｜ 口径：只讲「怎么在仓内 `dsh/` 上**装、构、起**」；**`dsh/` 树内不改任何文件**（见 [准备方案](../../plans/2026-09-23-dsh接管Agent面-大重构准备.md) §五）。
> 来源与许可：上游 **deepseek-harness tag `dsh-v0.1.7-rc.1`**（提交 `46a7f68b0922371ce7144b668b90e377d8e799f4`），**MIT**；树内自带 `LICENSE` 与 `THIRD_PARTY_NOTICES.md`。迁入口径：排除 `node_modules` 与 `.git`，其余原样。
> 追版记录：初版迁入为 `dsh-v0.1.7-alpha.2`（`00102833`，2026-09-22）→ 2026-09-24 换树至 `dsh-v0.1.7-rc.1`（差异 933 文件 / +13,851 −3,101；会话格式无变动；就绪行格式与 web app 参数零变化，壳无需改动）。

---

## 一、前置（六条口径）

| 项 | 口径 |
|---|---|
| Node | `^22.19 \|\| >=24`（实测 v24.10.0） |
| pnpm | 在 `dsh/` 内自动切到其钉住的 **11.7.0**（根 `packageManager` 字段；本机全局 11.5.1 不必改） |
| registry | 官方源与 npmmirror 当前**均可达**；统一带 `--registry=https://registry.npmmirror.com`（CN 网络更稳）；**不改任何 `.npmrc`** |
| `DSH_HOME` | **建议隔离**——壳默认用应用数据目录（`<app_data>/dsh-home`），手工跑时显式指定（本文示例 `D:/WorldSea/.独立项/b0-home`）。**空/新 home 首启正常**：dsh 自动 `initProfile`（建 `.anonymous-user-id`、`.credentials.yaml`、`profiles/web`、`storages/`）。⚠️ 调用形式注意：用**管道**（`… 2>&1 \| tee 日志`）而非 `timeout`+`env`+`>文件`——后者实测会让启动静默无输出（2026-09-24 更正） |
| 索引忽略 | 仓根 `.qoderignore` 已排除 `dsh/`、`.独立项/`、`node_modules/`——**在工作区内安装前必须先有这个忽略**，否则补丁依赖（`patchedDependencies`）改名会报 `ERR_PNPM_EPERM` |
| git 指纹 | `pnpm run build` 取 `git rev-parse HEAD`；在仓内运行取到 **WorldSea 的提交**（语义偏但可用）；仓外裸拷贝需 `git init` + 空提交，或设环境变量 `CLIENT_COMMIT_HASH_VARIABLE` |

## 二、三条命令

```sh
cd dsh
pnpm install --registry=https://registry.npmmirror.com --prefer-offline   # 实测 1m32.9s；1679 解析 / 1386 包 / node_modules ≈2.1G
pnpm run build                                                            # 实测产出 263 客户端产物：69 个 lib/client.js、307 个 lib/index.js、apps/web/dist
DSH_HOME="D:/WorldSea/.独立项/b0-home" node apps/cli/lib/bin.js web --no-open --port 3088   # 打印 ?token= URL
```

- 启动只监听 **loopback**；`GET /?token=…` → **303 + `Set-Cookie: dsh-auth-*`**（HttpOnly / SameSite=Strict / 30 天）；之后 `/api` 与 `/api/remote.mux`(WS) 认 Cookie，无 Cookie → **401**；index（32.9 KB）含 `__DSH_BOOT__`。
- 壳侧 overlay：`--patch <仓根>/apps/tauri/dsh-overlay.yml`（**打开 web 下默认禁用的右栏内置浏览器**；launcher 标志须排在 `--no-open/--port` 之前）。
- 模型调用读环境变量（如 `DEEPSEEK_API_KEY`）；本机环境已设。

## 三、已实测事实（2026-09-23）

- 仓内 `pnpm install` 一次过（`Done in 1m 32.9s using pnpm v11.7.0`）；仓内 `pnpm run build` 一次过（`build: recorded 263 client artifact(s)`）。
- 仓内起服务通过（端口 3088 / 3089 两次验证，探针结果同上）。
- `node scripts/architecture/check.mjs` → **无违规**（`dsh/` 不在 policy 的 `discoveryRoots`，天然不可见；218 存量冻结文件不变）。
- 入库边界：`dsh/.gitignore` 自带 `node_modules/`、`lib/`、`*.tsbuildinfo`、`apps/web/dist/` 等 → 构建产物不入库，无需改仓根 `.gitignore`。
- 用户侧另一份快照（`.独立项/deepseek-harness`）为未发布 WIP 工作树（+197 项、487 类型错误），**不作为基线**（裁定 D9）。

## 四、上游更新（步骤留档）

`dsh/` 内无 `.git`，**不走 `git pull`**。更新口径：取新 tag 的干净树 → 按同样排除口径覆盖 `dsh/` → 先 `diff -rq`（排除 `node_modules`/`lib`）逐条核对差异并解释 → 再提交。版本与提交号同步登记到本手册与 [准备方案](../../plans/2026-09-23-dsh接管Agent面-大重构准备.md)。
