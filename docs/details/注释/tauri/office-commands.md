# office_commands — 本机 Office 转换（ppt/pptx → PDF）设计缘由

> 源文件：`apps/tauri/src-tauri/src/office_commands.rs`

## 为什么走本机转换

PPTX 的**纯前端渲染还原度差、排版易崩**，业界正解是本机 LibreOffice headless 转 PDF，
再由前端用 pdfjs 渲染（项目已装 pdfjs-dist）。桌面端天然可行——但前提是用户机器装了
LibreOffice，故**必须先探测、未装则明确降级**（禁止静默失败）。

## 两个命令

- `cmd_office_available`：本机是否可用（结果进程内缓存，避免每次开文件都扫盘）
- `cmd_pptx_to_pdf`：转换并返回 **PDF 缓存路径**（前端随后按普通 PDF 读取渲染）

## 缓存策略

缓存目录 `{app_data}/worldsea/office_cache/{key}/`，`key` = 源路径 + mtime + size 的哈希——
同一文件重复打开直接命中（LibreOffice 首次启动通常数秒，缓存能明显改善手感）；
源文件改动（mtime/size 变）自动换 key，不会读到过期产物。每次转换顺带清理超过
`CACHE_MAX_AGE_DAYS`（7 天）的旧目录。

注：`key` 用标准库 `DefaultHasher`，跨 Rust 版本不保证稳定——升级后最多是缓存全失效
（重转一次），不影响正确性。
