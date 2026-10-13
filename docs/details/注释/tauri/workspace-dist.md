# workspace_dist — 工作台（产品域）静态伺服口径

> 源文件：`apps/tauri/src-tauri/src/workspace_dist.rs`

壳 `worldsea` 协议的 `/workspace` 前缀分支，设计口径如下：

- **产物不嵌入二进制**（22MB 级）：运行时从磁盘目录读（`WORLDSEA_WORKSPACE_DIST` 可覆盖；
  缺省 = dev 口径 `<crate>/../workspace-dist`）；目录缺失给可辨认错误页（非空白）。
- **与 dsh 桥无关**：宿主（dsh）未就绪也能伺服——路由在 lib.rs 的协议闭包里先判前缀。
- **同源**：工作台页与 dsh 页同落 `worldsea://localhost`，主题等 localStorage 天然互通。
- **闸门**：只服务 GET/HEAD；前缀内路径逐段拒绝越界段（`.`/`..`/`\`/盘符/NUL），
  落盘前再走 canonicalize 包含性复核（符号链接逃逸）。
- **缓存**：`assets/` 为内容哈希名 → immutable；index 与其余 no-store（重构建后重启壳即生效）。
- **index 注入**：`dsh_inject::inject_workspace_scripts`（「不白屏」安全网，root=#app）。
