# lib.rs — 壳进程入口（WebView2 崩溃记录等长注存档）

> 源文件：`apps/tauri/src-tauri/src/lib.rs`

## [WebView2 崩溃记录]（2026-09-08 实测）

本机 WebView2 Runtime 152（152.0.4191.66，最新稳定）在 wry/Tauri 宿主下间歇性 msedge.dll CHECK
崩溃（转储异常地址 0x7FFE1511B21D，EXCEPTION_BREAKPOINT），browser 进程启动或运行数分钟内随机触发、
界面空白。

已排除：devtools/GPU/user-data/参数——env `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` 与 `set_var` 均无效
（wry 0.55 强制 `set_additional_browser_arguments` 覆盖 env）；msSmartScreenProtection 禁用亦无效。
疑 runtime 152 缺陷 + 本机被"优化"环境叠加。已知正常存活实例：首启曾稳定 20+ 分钟。

对策：崩溃后重启实例；WebView2 153（2026-09-10 发布）由 EdgeUpdate 自动更新后大概率自愈
（152 为 2 周节奏首批）。若要传 WebView2 启动参数，须用
`tauri::WebviewWindowBuilder::additional_browser_args()` 显式建窗（config 自动建窗无此通道）。
