//! 索引策略与文件扫描（白名单 / 排除清单 / 上限）
//!
//! **默认白名单是保守的**：只收常见文本与代码扩展名；二进制、无扩展名文件、隐藏目录
//! 与常见构建/缓存目录一律跳过。白名单之外的文件**既不读也不会外发**（隐私边界）。

use std::collections::HashSet;
use std::path::{Path, PathBuf};

/// 索引策略（v1 默认值面向「考据资料 + 代码」两类内容）
#[derive(Debug, Clone)]
pub struct IndexPolicy {
    /// 允许的扩展名（小写、不含点）
    pub extensions: HashSet<String>,
    /// 目录名排除清单（按目录名精确匹配，任意层级）
    pub exclude_dirs: HashSet<String>,
    /// 单文件大小上限（超过即跳过，不读不索引）
    pub max_file_bytes: u64,
    /// 分块参数
    pub chunk: crate::chunker::ChunkParams,
}

impl Default for IndexPolicy {
    fn default() -> Self {
        let extensions: HashSet<String> = [
            // 文本 / 文档
            "md", "markdown", "txt", "rst", "org", "json", "jsonl", "csv", "tsv", "yaml", "yml",
            "toml", "ini", "cfg", "conf", "xml", "html", "htm", "css", "tex", // 代码
            "rs", "ts", "tsx", "js", "jsx", "vue", "py", "go", "java", "kt", "c", "h", "cpp",
            "hpp", "cs", "rb", "php", "swift", "lua", "sh", "bash", "ps1", "sql", "proto", "gradle",
            "dockerfile",
        ]
        .into_iter()
        .map(String::from)
        .collect();
        let exclude_dirs: HashSet<String> = [
            // 版本控制 / 依赖 / 构建产物 / 缓存
            ".git",
            ".svn",
            ".hg",
            "node_modules",
            "target",
            "dist",
            "build",
            "out",
            "__pycache__",
            "venv",
            ".venv",
            // WorldSea 工作区分区（agent 临时区 / 成果区 / 项目数据区）
            "agent-tmp",
            "agent-out",
            ".worldsea",
        ]
        .into_iter()
        .map(String::from)
        .collect();
        Self {
            extensions,
            exclude_dirs,
            max_file_bytes: 1024 * 1024, // 1 MB
            chunk: crate::chunker::ChunkParams::default(),
        }
    }
}

impl IndexPolicy {
    /// 目录是否允许进入（隐藏目录一律排除——`.foo` 多为配置/缓存，且 `.worldsea` 已在清单独列）
    pub fn dir_allowed(&self, name: &str) -> bool {
        !name.starts_with('.') && !self.exclude_dirs.contains(name)
    }

    /// 文件是否可索引（扩展名白名单 + 无扩展名的 `Dockerfile` 类特例）
    pub fn file_ext_allowed(&self, path: &Path) -> bool {
        if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
            return self.extensions.contains(&ext.to_ascii_lowercase());
        }
        // 无扩展名：常见文档/构建文件按文件名收
        let name = path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("")
            .to_ascii_lowercase();
        matches!(
            name.as_str(),
            "dockerfile" | "makefile" | "readme" | "license" | "changelog" | "cmakelists.txt"
        )
    }

    /// 分块边界提示（R2 质量档 · 2026-09-12）：按扩展名选择结构边界规则
    ///
    /// - **Markdown / 散文**（md / markdown / rst / org）→ 行首 `#` 标题为边界
    /// - **代码**（rs/ts/py/go/… 见下）→ 列 0 顶层声明 / 属性 / 文档注释为边界
    /// - **其余**（json / csv / yaml / html / css / toml …）→ `Plain`，不识别边界（v1 行为）
    ///
    /// 未识别类型一律退回 `Plain`：**边界感知只让块更贴合结构，不改变未识别类型的
    /// 既有切分**（零行为变化锚点）。
    pub fn boundary_hint(&self, path: &Path) -> crate::chunker::BoundaryHint {
        use crate::chunker::BoundaryHint;
        let ext = path
            .extension()
            .and_then(|e| e.to_str())
            .map(|e| e.to_ascii_lowercase())
            .unwrap_or_default();
        if matches!(ext.as_str(), "md" | "markdown" | "rst" | "org") {
            return BoundaryHint::Markdown;
        }
        if matches!(
            ext.as_str(),
            "rs" | "ts" | "tsx" | "js" | "jsx" | "vue" | "py" | "go" | "java" | "kt" | "c" | "h"
                | "cpp" | "hpp" | "cs" | "rb" | "php" | "swift" | "lua" | "sh" | "bash" | "ps1"
                | "sql" | "proto" | "gradle"
        ) {
            return BoundaryHint::Code;
        }
        BoundaryHint::Plain
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::chunker::BoundaryHint;

    #[test]
    fn boundary_hint_follows_extension() {
        let p = IndexPolicy::default();
        assert_eq!(
            p.boundary_hint(Path::new("考据/星海地理.md")),
            BoundaryHint::Markdown
        );
        assert_eq!(p.boundary_hint(Path::new("src/main.rs")), BoundaryHint::Code);
        assert_eq!(p.boundary_hint(Path::new("x/脚本.PY")), BoundaryHint::Code, "扩展名大小写不敏感");
        // 结构化但无「声明/标题」语义的类型 → 不识别边界（v1 行为）
        assert_eq!(p.boundary_hint(Path::new("data.json")), BoundaryHint::Plain);
        assert_eq!(p.boundary_hint(Path::new("conf/app.yaml")), BoundaryHint::Plain);
        assert_eq!(p.boundary_hint(Path::new("Dockerfile")), BoundaryHint::Plain);
    }
}

/// 扫描到的文件（相对路径 + 元数据）
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FileEntry {
    /// workdir 相对路径（`/` 分隔，跨平台稳定）
    pub rel: String,
    /// 绝对路径
    pub abs: PathBuf,
    pub size: u64,
    /// 修改时间（Unix 毫秒）
    pub mtime_ms: i64,
}

/// 扫描 workdir 下的可索引文件（递归；软链接不跟随、隐藏/排除目录跳过）
///
/// 纯本地元数据操作（readdir + metadata），不读文件内容——增量 diff 的廉价前置。
pub fn scan_files(root: &Path, policy: &IndexPolicy) -> Vec<FileEntry> {
    let mut out: Vec<FileEntry> = Vec::new();
    let mut stack: Vec<PathBuf> = vec![root.to_path_buf()];
    while let Some(dir) = stack.pop() {
        let Ok(entries) = std::fs::read_dir(&dir) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            let Ok(ft) = entry.file_type() else { continue };
            if ft.is_symlink() {
                continue; // 防目录环
            }
            if ft.is_dir() {
                let name = entry.file_name().to_string_lossy().to_string();
                if policy.dir_allowed(&name) {
                    stack.push(path);
                }
                continue;
            }
            if !ft.is_file() || !policy.file_ext_allowed(&path) {
                continue;
            }
            let Ok(meta) = entry.metadata() else { continue };
            if meta.len() > policy.max_file_bytes {
                continue;
            }
            let rel = path
                .strip_prefix(root)
                .map(|p| p.to_string_lossy().replace('\\', "/"))
                .unwrap_or_else(|_| path.to_string_lossy().replace('\\', "/"));
            let mtime_ms = meta
                .modified()
                .ok()
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_millis() as i64)
                .unwrap_or(0);
            out.push(FileEntry {
                rel,
                abs: path,
                size: meta.len(),
                mtime_ms,
            });
        }
    }
    out.sort_by(|a, b| a.rel.cmp(&b.rel));
    out
}
