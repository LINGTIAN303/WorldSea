# dsh_bridge — `worldsea` 协议层代理宿主

> 源文件：`apps/tauri/src-tauri/src/dsh_bridge.rs`

## 口径

见 docs/plans/2026-09-24-C1-Tauri原生desktop载体批计划.md §三/§四/§五 与 docs/plans/2026-09-24-C2-真无端口传输批计划.md §五：

- UI origin 与传输面分离：页面走壳注册的自定义协议；传输面默认走 IPC 管道（零 TCP），
  `WORLDSEA_TCP_HOST=1` 可切回 legacy 形态（loopback TCP + WS 中转；对照口，冻结）；
- 零注入复刻 index：index 直接取宿主渲染结果（`__DSH_BOOT__` 等由宿主注入），
  壳只在 `<head>` 后补注入脚本（`__DSH_TRANSPORT__` 只合并不覆盖 = 传输基址单点，
  管道模式起该单点改注入 `openStream` 钩子——传输形态换掉，接缝不变）；
- 转发 `/api` 时按 Electron 桌面版同构处理：删掉页面的 origin/cookie/sec-fetch-*，补壳侧凭据
  （带 303 换来的 `dsh-auth-*` cookie）；管道模式由 `PipeClient` 合成 `Host: 127.0.0.1`；
- 路径闸门（`dsh_gate.rs`，2026-11-03 从 `dsh_proxy.rs` 拆出）：放行集合 = **静态底集** ∪
  **运行期快照**。静态底集 `ALLOWED_PREFIXES` 枚举 dsh 内置路由（有客观来源，是安全基线）；
  运行期快照来自**宿主 hello 帧上报的 `routePrefixes`**——插件在运行时注册路由，壳内无法枚举，
  故不再手工记账。判定三态：命中底集 = `Static`、命中快照 = `Runtime`、都不中 = `Unknown`；
  `Unknown` 走**试探转发**（宿主可能确有路由：插件热装后、或旧宿主未上报），转发后仍 404 才拒绝，
  给 API 面 JSON `{"ok":false,"code":"SHELL_PATH_BLOCKED"}`（让插件能区分「被壳拦了」与「接口不存在」）、
  index 面 HTML 错误页。`WORLDSEA_BRIDGE_OPEN=1` 可整体放行排查。
  **越界 403 / 越权 405 先于上述判定**，不因放宽而松动。
- 兜底：`FALLBACK_PLUGIN_PREFIXES`（`/dsh-whale/`、`/dsh-bili/`）仅在上报缺失时生效；
  legacy TCP 对照口（`WORLDSEA_TCP_HOST=1`）无 hello 通道，恒用静态底集（等价改造前行为）。
- 协议名 `worldsea`，Windows 落形见〔自定义协议落形〕。

## 〔自定义协议落形〕

wry 在 Windows 走 workaround（wry custom_protocol_workaround）：
`worldsea://localhost/…` ⇄ `http://worldsea.localhost/…`。故 authority 必须是 `localhost`
（否则会落到真实 TLD 且非安全上下文）；页面导航目标 = workaround 形态，处理器收到的
request URI 已被 wry 还原成 `worldsea://localhost/…`。

## 分工

路径闸门（放行集合与判定）在 `dsh_gate.rs`；转发细节（缓存策略 / 头过滤 / 插桩 / 失败降级）在
`dsh_proxy.rs`；管道客户端在 `dsh_pipe.rs`（hello 携带宿主前缀表）；页面流桥命令在 `dsh_stream.rs`；
本文件只管桥状态与装配。
