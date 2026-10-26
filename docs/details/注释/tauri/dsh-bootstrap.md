# dsh 运行时分发与首启装配（dsh_bootstrap.rs + build-dsh-runtime.ps1）

> 承载 2026-10-13「Agent 运行时随安装器分发」批次的 why/how：
> 分发链路形状、三条 legacy deploy 已知坑、闭包清单推导、追版动作。
> 2026-10-26 增补：自包含安装器（workspace-dist + NSIS POSTINSTALL 钩子）、全树链接实体化、体积账更新。
> 代码内只留一行简要注释 + 本文档指针。

## 问题

安装器 payload 原本只有主程序 exe。Agent 面（dsh）运行依赖五样东西全不在安装器里：
node 运行时、构建 dsh 树（apps/cli/lib/bin.js）、双产品域插件产物、dsh-overlay.yml、
profile 装配本体。开发机上安装版"能用"是三个巧合：编译期烙进的仓路径
（`CARGO_MANIFEST_DIR/../../../dsh`）+ PATH 里的 node + 开发期手工编辑的 app_data profile。
朋友机器上 Agent 面起不来。

## 分发链路（形状）

```
scripts/build-dsh-runtime.ps1（独立可跑）
  staging（修剪 robocopy + 注入双插件 + 剥离根 postinstall）
  → 闭包清单 apps/worldsea-closure（构建期注入，不入库）
  → pnpm@11.7 deploy --legacy --node-linker=hoisted --auto-install-peers=false
  → 修正（恢复漏装包 / 全树链接实体化，残留 reparse point 即失败）
  → node v24.21.0（dsh lock.json 锁定 + sha256 校验）
  → 产物 payload/dsh-runtime/{node/, dsh/, overlay.yml} + dsh-runtime.zip（.NET ZipFile，含顶层前缀）

scripts/build-installer.ps1（工作台 UI 构建 → 主程序/NSIS → payload 同步 → 单文件安装器）
  → 两条分发路径共用 payload：NSIS 走 bundle.resources + POSTINSTALL 钩子；
    单文件安装器 include_bytes! 编译期嵌入（主程序 + dsh-runtime.zip + workspace-dist.zip）
  → 安装时均用系统 tar.exe 解压到 <安装目录>\dsh-runtime 与 \workspace-dist
    （Windows 10 1803+ 自带 bsdtar，零新依赖）

壳（apps/tauri/src-tauri）
  resolve_dsh_install()：生产形态优先（exe 同级 dsh-runtime/），回落 dev 口径
  dsh_bootstrap::ensure_product_profile()：首启幂等装配 web profile
```

## 关键决策

### node 载体（非单 exe）

dsh 上游单 exe 构建（@yao-pkg/pkg --sea）是 sdk profile 口径且打包链复杂；
其 node 分支载体（`runtime/node/node_modules/@deepseek-ai/dsh/lib/bin.js`）与
WorldSea 壳的 spawn 架构同构，直接采用。单 exe 可作为未来优化项，闭包清单可直接复用。

### 闭包清单 = 平铺声明 + 自动推导

pnpm legacy deploy 不解析 workspace 传递 peer，闭包清单必须**平铺**声明全部依赖。
推导来源五路，全部构建期自动生成（追版零手工）：

1. 全树 workspace 协议 peerDependencies 扫描（CLI deps 已含的跳过）
2. bundle 层 cordis*.yml 引用的 workspace 包（verify 脚本只扫 presets，dsh-llm-deepseek 教训）
3. overrides 强制的 vendor 实体包（cosmokit / schemastery，peer 扫描覆盖不到）
4. **产品域插件 `apps/dsh-plugin-*` 通配收编**（新增插件零接线，无名单可漏）
5. 上游 `verify-runtime-closure.ts` 迭代校验：失败链末端包自动补进清单直到 PASS

### legacy deploy 三条已知坑（与上游单 exe 构建的处理对应）

1. **漏装 workspace 包**（含传递依赖，如 dsh-base）：按闭包的 workspace 传递闭包
   （BFS manifests）比对部署树，缺的从 staging 整包恢复
2. **部署树残留链接**（link: overrides 的 vendor 包 + workspace 包目录 junction，一次实测 82 个）：
   全树逐轮实体化（`.bin` 整目录删除、payload 自指/祖先链接删除、目录 deref 复制且不嵌套 node_modules、
   文件复制；对齐上游 `materializeStagedLinks`）；部署树内残留 reparse point 即失败（fail loud）——
   staging 删除后链接必断，且安装后无从修复
3. **staging 根 postinstall**（install-lefthook）在无 node_modules 的 staging 必炸：剥离

### 首启 profile 装配（dsh_bootstrap.rs）

幂等合并而非覆盖：bundles 缺谁补谁、dependencies link 失效（指向不存在目录）才修复。
用户与插件管理器对 profile 的既有编辑一律保留。插件集合 = 运行时扫描 `dsh-plugin-*`
（与构建侧 `apps/dsh-plugin-*` 通配同构，**新增插件零接线**）；零插件 fail loud（防静默丢能力）。
生产插件实体在随包部署树（`dsh-runtime/dsh/node_modules`），dev 在仓 `apps/`——
由 `DshInstall.plugins_dir` 统一供给。profile 缺失时按产品基线重建（base + web-app + 扫描到的插件）。

### 安装器解压引擎 = 系统 tar.exe

Windows 10 1803+ 自带 bsdtar（原生支持 zip），避免为解压引入 zip crate 依赖。
两条分发路径同一口径：单文件安装器在 `main.rs` 解压；NSIS 包在 `installer-hooks.nsh` 的
POSTINSTALL 钩子里用 `$SYSDIR\tar.exe` 解压（32 位安装器的 `$SYSDIR` = SysWOW64，tar 同样存在），
PREUNINSTALL 显式删除解压产物（不在 NSIS 文件清单内）。
解压后校验关键落盘物（node.exe / dsh bin.js / workspace-dist/index.html），EstimatedSize 含实际占用。

## 追版动作（管线即验证工具）

1. 替换 vendored dsh 树为新版本（纯源码覆盖，无 .git）
2. 同步 `build-dsh-runtime.ps1` 的 nodeVersion / nodeSha256（源：dsh/scripts/primary-runtime/lock.json）
3. 重跑 `build-dsh-runtime.ps1`（闭包自动重推导 + 烟测自动执行）
4. 插件花名册追版：preset-worldsea 是标准预设全量复制，跑
   `apps/dsh-plugin-worldsea/__tests__/patch.spec.ts`（花名册一致性用例自动报警）

## 体积账（2026-10-26 实测）

运行时树 691.6MB（dsh 部署树 ~602 + node.exe 89.3）→ zip 232.7MB（Deflate）。
增量主因：`@deepseek-ai/libreoffice-kit-win32-x64`（单文件 170.3MB，文档预览依赖）进入闭包。
两个安装器：NSIS 224.3MB（runtime zip + workspace-dist 6.6MB + 主程序 19.5MB，LZMA 对已压缩 zip 近乎无收益）；
单文件安装器 266.5MB（内嵌同三件 + 安装器壳）。若要再省：评估运行时可裁包（LibreOffice kit 按需下载）。

## 烟测口径

干净 DSH_HOME（临时目录）+ 产物 node.exe 启动 `dsh web`，40×500ms 轮询
就绪 URL（token=）→ HTTP 200。零插件失败是 pass 条件的隐含前提——
启动失败即整链失败（构建期拦截，不留给安装后）。
