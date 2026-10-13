// 工作台（产品域）静态伺服——壳 `worldsea` 协议的 `/workspace` 前缀分支。
// 口径：产物**不嵌入二进制**（22MB 级），运行时从磁盘读（`WORLDSEA_WORKSPACE_DIST` 可覆盖，缺省 dev 口径，
// 目录缺失给可辨认错误页）；与 dsh 桥**无关**（宿主未就绪也能伺服）；与 dsh 页同源，localStorage 天然互通。
// 闸门：只服务 GET/HEAD；前缀内路径逐段拒绝越界段 + canonicalize 包含性复核（符号链接逃逸）；
// 缓存：`assets/` 内容哈希名 → immutable，index 与其余 no-store；index 注入「不白屏」安全网——详见 docs/details/注释/tauri/workspace-dist.md。

use std::path::{Path, PathBuf};

use tauri::UriSchemeResponder;

use crate::dsh_proxy::failure_response;

/// 前缀（精确段）：`/workspace` 与 `/workspace/...` 归本模块；`/workspacefoo` 不归。
pub(crate) const PREFIX: &str = "/workspace";

/// 请求路径是否属工作台前缀。
pub(crate) fn is_workspace_path(path: &str) -> bool {
    path == PREFIX || path.starts_with("/workspace/")
}

/// 协议处理器入口：转后台线程读盘（与 dsh 桥同款；responder 可在任意线程应答）。
pub(crate) fn handle_request(request: http::Request<Vec<u8>>, responder: UriSchemeResponder) {
    std::thread::spawn(move || responder.respond(serve_disk(&request)));
}

/// 顶层伺服：解析产物根目录；不可用时给可辨认错误页（含构建命令）。
fn serve_disk(request: &http::Request<Vec<u8>>) -> http::Response<Vec<u8>> {
    let path_only = request.uri().path().to_string();
    match dist_root() {
        Ok(root) => serve(&root, request),
        Err(e) => {
            eprintln!("[DSH-SHELL] workspace: 产物目录不可用（{e}）");
            failure_response(503, wants_html(&path_only), "工作台资源不可用", &e)
        }
    }
}

/// 产物根目录：`WORLDSEA_WORKSPACE_DIST` 优先；否则 dev 口径 `apps/tauri/workspace-dist`（打包形态的产物落位待收口定）。
fn dist_root() -> Result<PathBuf, String> {
    let build_hint = "先在 apps/tauri 执行 `node node_modules/vite/bin/vite.js build --config workspace/vite.config.ts`；或用 WORLDSEA_WORKSPACE_DIST 指定目录";
    if let Some(raw) = std::env::var_os("WORLDSEA_WORKSPACE_DIST") {
        let candidate = crate::dsh_workspace::strip_verbatim_prefix(PathBuf::from(raw));
        return if candidate.join("index.html").exists() {
            Ok(candidate)
        } else {
            Err(format!("WORLDSEA_WORKSPACE_DIST 指向的目录里没有 index.html：{}（{build_hint}）", candidate.display()))
        };
    }
    let raw = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..").join("workspace-dist");
    let candidate = crate::dsh_workspace::strip_verbatim_prefix(raw.canonicalize().unwrap_or(raw));
    if candidate.join("index.html").exists() {
        Ok(candidate)
    } else {
        Err(format!("未找到工作台产物：{}（{build_hint}）", candidate.display()))
    }
}

/// 伺服一次请求（纯函数：根目录由调用方给，测试可直接喂夹具目录）。
fn serve(root: &Path, request: &http::Request<Vec<u8>>) -> http::Response<Vec<u8>> {
    let method = request.method().as_str().to_string();
    let path_and_query = request.uri().path_and_query().map(|p| p.as_str()).unwrap_or("/").to_string();
    let path_only = path_and_query.split('?').next().unwrap_or("/").to_string();

    // ── 闸门 ─────────────────────────────────────────────────────────────
    if method != "GET" && method != "HEAD" {
        return crate::dsh_proxy::with_allow_header(failure_response(
            405,
            wants_html(&path_only),
            "方法不被允许",
            &format!("{method} {path_only}；工作台只服务 GET/HEAD（页面为静态产物）"),
        ));
    }
    let rel = match resolve_rel(&path_only) {
        Ok(rel) => rel,
        Err(detail) => {
            eprintln!("[DSH-SHELL] workspace: {method} {path_and_query} → 403（{detail}）");
            return failure_response(403, wants_html(&path_only), "路径越界", &detail);
        }
    };
    let is_index = rel == "index.html";
    let file = root.join(&rel);
    // 纵深：canonicalize 后仍须落在根内（挡符号链接逃逸；根与目标同法归一，Windows 的 `\\?\` 前缀两侧一致）
    if let (Ok(real_root), Ok(real_file)) = (root.canonicalize(), file.canonicalize()) {
        if !real_file.starts_with(&real_root) {
            eprintln!("[DSH-SHELL] workspace: {method} {path_and_query} → 403（符号链接逃出产物目录）");
            return failure_response(403, wants_html(&path_only), "路径越界", "解析后的真实路径不在产物目录内");
        }
    }
    let bytes = match std::fs::read(&file) {
        Ok(bytes) => bytes,
        Err(e) => {
            eprintln!("[DSH-SHELL] workspace: {method} {path_and_query} → 404（{e}）");
            return failure_response(
                404,
                wants_html(&path_only),
                "工作台资源不存在",
                &format!("{path_only}：{e}（产物可能未重新构建）"),
            );
        }
    };

    // ── 响应 ─────────────────────────────────────────────────────────────
    let mut body = if is_index {
        match String::from_utf8(bytes) {
            Ok(text) => crate::dsh_inject::inject_workspace_scripts(&text).into_bytes(),
            Err(e) => {
                eprintln!("[DSH-SHELL] workspace: index 非 UTF-8（{e}）——原样送出，无注入");
                return failure_response(500, true, "工作台入口不可读", &format!("index.html 解码失败：{e}"));
            }
        }
    } else {
        bytes
    };
    let mut builder = http::Response::builder()
        .status(200)
        .header("content-type", mime_for(&rel))
        .header("cache-control", cache_control_for(&rel));
    if is_index {
        // CSP 最小子集（与 dsh 页同口径，定义收口在 dsh_proxy::CSP_INDEX）
        builder = builder.header("content-security-policy", crate::dsh_proxy::CSP_INDEX);
    }
    if is_index {
        println!("[DSH-SHELL] workspace: {method} {path_and_query} → 200（注入安全网；{}B）", body.len());
    }
    if method == "HEAD" {
        let length = body.len().to_string();
        body.clear();
        builder = builder.header("content-length", length);
    } else {
        builder = builder.header("content-length", body.len().to_string());
    }
    builder.body(body).unwrap_or_else(|e| failure_response(500, true, "构造响应失败", &e.to_string()))
}

/// `/workspace[...]` → 产物内相对路径（`/workspace` 与 `/workspace/` → `index.html`）；
/// 越界段（`.`/`..`/`\`/盘符/NUL/空段）一律报错（纵深复核在 `serve` 里做）。
fn resolve_rel(path_only: &str) -> Result<String, String> {
    let rest = path_only.strip_prefix(PREFIX).unwrap_or(path_only).trim_start_matches('/');
    if rest.is_empty() {
        return Ok("index.html".to_string());
    }
    for segment in rest.split('/') {
        if segment.is_empty()
            || segment == "."
            || segment == ".."
            || segment.contains('\\')
            || segment.contains(':')
            || segment.contains('\0')
        {
            return Err(format!("拒绝含越界段的路径：{path_only}"));
        }
    }
    Ok(rest.to_string())
}

/// 请求是否「页面级」（末段无扩展名）——错误响应据此给 HTML 页还是纯文本（不污染资源语义）。
fn wants_html(path_only: &str) -> bool {
    let last = path_only.trim_end_matches('/').rsplit('/').next().unwrap_or("");
    last.is_empty() || !last.contains('.')
}

/// 产物文件的内容类型（模块脚本必须给 JS 类型，否则 WebView 按其严格 MIME 规则拒载）。
fn mime_for(rel: &str) -> &'static str {
    let ext = rel.rsplit('.').next().unwrap_or("").to_ascii_lowercase();
    match ext.as_str() {
        "html" | "htm" => "text/html; charset=utf-8",
        "js" | "mjs" => "text/javascript; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "json" | "map" => "application/json; charset=utf-8",
        "wasm" => "application/wasm",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "ico" => "image/x-icon",
        "woff" => "font/woff",
        "woff2" => "font/woff2",
        "ttf" => "font/ttf",
        "otf" => "font/otf",
        "txt" | "md" => "text/plain; charset=utf-8",
        "xml" => "application/xml",
        "pdf" => "application/pdf",
        "mp3" => "audio/mpeg",
        "mp4" => "video/mp4",
        "webm" => "video/webm",
        "csv" => "text/csv; charset=utf-8",
        "zip" => "application/zip",
        _ => "application/octet-stream",
    }
}

/// 缓存策略：`assets/` 是内容哈希名 → 长缓存；index 与其余 no-store（产物重构建即换名/换内容）。
fn cache_control_for(rel: &str) -> &'static str {
    if rel.starts_with("assets/") {
        "public, max-age=31536000, immutable"
    } else {
        "no-store"
    }
}

#[cfg(test)]
#[path = "workspace_dist_tests.rs"]
mod tests;
