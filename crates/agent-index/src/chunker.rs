//! 分块（按行累积 + 重叠；不截断行；**边界感知**）
//!
//! 方案评定的规模测算以 ~500 字/块为基准。切分遵循三条硬约束：
//!
//! 1. **不截断行** —— 中文散文与代码都按行边界切（从行中截断会破坏代码/表格可读性，
//!    向量语义也被割裂）；仅当**单行本身**超长（压缩过的 JSON 等）才按字符硬切。
//! 2. **行覆盖连续** —— 所有块的行区间连成完整覆盖，无空洞（相邻块允许重叠）。
//! 3. **单块不膨胀** —— 累计字符达 `max_chars` 即收尾，故单块 ≤ `max_chars` + 单行长度。
//!
//! ## 边界感知（R2 质量档 · 2026-09-12）
//!
//! 单纯「按 500 字切」会把一个函数、一节标题切成两半。[`BoundaryHint`] 让切分点优先落在
//! **结构边界**上：Markdown 的 `#` 标题、代码的**列 0 顶层声明**（`fn` / `def` / `class` /
//! `impl` / `export` …，含其前置的属性行与文档注释——它们本应归属后一个声明）。
//!
//! 两条设计口径：
//!
//! - **`Plain` = v1 行为逐字节不变**（零行为变化锚点）——边界感知只对识别出的文件类型
//!   启用；未识别类型走 `Plain`，既有测试原样通过。
//! - **只提前、不推后** —— 边界只让块**更早**收尾（且需已累计 ≥ `boundary_min_chars`，
//!   避免碎块），不会让块变大；故「单块不膨胀」「行覆盖连续」两条不变量不受影响。
//!
//! 启发式（无 AST）的已知取舍：**列 0 关键字匹配**是跨语言的稳妥近似——把方法误判为
//! 顶层边界只会让块更小，不会丢内容；Markdown 围栏代码块内的行不做边界判定
//! （避免 ```` ```python ```` 里的 `# 注释` 被当成标题）。

/// 单块目标字符数上限（达到即收尾；单行超长时硬切）
#[derive(Debug, Clone)]
pub struct ChunkParams {
    /// 单块目标字符数（达到即收尾；单行超长时硬切）
    pub max_chars: usize,
    /// 相邻块的重叠行数（0 = 不重叠）
    pub overlap_lines: usize,
}

impl Default for ChunkParams {
    fn default() -> Self {
        Self {
            max_chars: 500,
            overlap_lines: 2,
        }
    }
}

/// 结构边界提示（由文件类型决定；`Plain` 保持 v1 行为）
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum BoundaryHint {
    /// 纯文本：不识别边界（与 v1 逐字节一致）
    #[default]
    Plain,
    /// Markdown / 散文：行首 `#` 标题为边界（围栏代码块内除外）
    Markdown,
    /// 代码：列 0 起的顶层声明 / 属性 / 文档注释为边界
    Code,
}

/// 一个原始块（未入索引）
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RawChunk {
    /// 文件内顺序号（0 起）
    pub ordinal: usize,
    /// 起始行（1 起，闭区间）
    pub start_line: usize,
    /// 结束行（1 起，闭区间）
    pub end_line: usize,
    pub text: String,
}

/// 文本 → 块序列（**v1 行为**：不识别结构边界）
pub fn chunk_text(text: &str, p: &ChunkParams) -> Vec<RawChunk> {
    chunk_text_for(text, p, BoundaryHint::Plain)
}

/// 文本 → 块序列（**边界感知**；行号 1 起闭区间；空文本 → 空序列）
pub fn chunk_text_for(text: &str, p: &ChunkParams, hint: BoundaryHint) -> Vec<RawChunk> {
    let lines: Vec<&str> = text.lines().collect();
    let mut out: Vec<RawChunk> = Vec::new();
    let mut ordinal = 0usize;
    let mut i = 0usize;
    // 允许在边界处提前收尾的最小累计字符数（半个块）——否则结构边界密集的
    // 文件会被切成大量碎块，反而降低检索质量
    let min_chars = boundary_min_chars(p.max_chars);
    // Markdown 围栏代码块状态（`Plain` / `Code` 下恒 false）
    let mut in_fence = false;

    while i < lines.len() {
        let start = i;
        let mut acc = String::new();
        let mut chars = 0usize;

        // 单行超长（且本块为空）：按字符硬切
        let line_len = lines[i].chars().count();
        if line_len > p.max_chars {
            let line_no = i + 1;
            let mut rest: Vec<char> = lines[i].chars().collect();
            let mut part = 0usize;
            while !rest.is_empty() {
                let take = p.max_chars.min(rest.len());
                let piece: String = rest.drain(..take).collect();
                out.push(RawChunk {
                    ordinal,
                    start_line: line_no,
                    end_line: line_no,
                    text: piece,
                });
                ordinal += 1;
                part += 1;
                if part > 64 {
                    break; // 防御：单行异常巨大时不再无限切
                }
            }
            toggle_fence(lines[i], hint, &mut in_fence);
            i += 1;
            continue;
        }

        while i < lines.len() && chars < p.max_chars {
            // 边界感知：本块已累计足够、且当前行开启新的结构块 → 在本行之前收尾
            // （`i > start` 保证每块至少消费一行，杜绝空块与死循环）
            if chars >= min_chars && i > start && !(hint == BoundaryHint::Markdown && in_fence) {
                if is_boundary_line(lines[i], hint) {
                    break;
                }
            }
            let l = lines[i];
            acc.push_str(l);
            acc.push('\n');
            chars += l.chars().count() + 1;
            toggle_fence(l, hint, &mut in_fence);
            i += 1;
        }
        out.push(RawChunk {
            ordinal,
            start_line: start + 1,
            end_line: i, // 已消费到 i-1 行 → 闭区间上界 i
            text: acc,
        });
        ordinal += 1;

        // 重叠：回退若干行（至少前进一行，避免死循环）
        if i < lines.len() && p.overlap_lines > 0 {
            let back = p.overlap_lines.min(i - start - 1);
            i -= back;
        }
    }
    out
}

/// 允许在边界处提前收尾的最小累计字符数
fn boundary_min_chars(max_chars: usize) -> usize {
    (max_chars / 2).max(1)
}

/// 该行是否开启新的结构块（`hint` 决定规则）
fn is_boundary_line(line: &str, hint: BoundaryHint) -> bool {
    match hint {
        BoundaryHint::Plain => false,
        BoundaryHint::Markdown => markdown_heading_level(line).is_some(),
        BoundaryHint::Code => {
            // 必须**顶格**（列 0）：缩进行是块内内容（方法、分支、续行），
            // 若把缩进的 `fn`/`def` 也当顶层边界，会把函数体切碎
            if line.chars().next().map_or(false, char::is_whitespace) {
                return false;
            }
            code_decl_prefix(line)
        }
    }
}

/// Markdown ATX 标题级别（`#` × 1..=6 后接空白或行尾；允许前置空格）；非标题返回 `None`
fn markdown_heading_level(line: &str) -> Option<usize> {
    let t = line.trim_start_matches([' ', '\t']);
    let hashes = t.chars().take_while(|c| *c == '#').count();
    if hashes == 0 || hashes > 6 {
        return None;
    }
    match t[hashes..].chars().next() {
        // `#` 后必须是空白或行尾（`#标签` 不是标题）
        None => Some(hashes),
        Some(c) if c.is_whitespace() => Some(hashes),
        Some(_) => None,
    }
}

/// 代码顶层声明前缀（跨语言；列 0 起）
///
/// 含 Rust 属性/文档注释前缀（`#[` / `///` / `//` 等）与 Python/shell 的 `#` 注释——
/// 它们语义上归属**后一个**声明，断在这些行之前可让注释与声明留在同一块内。
const CODE_DECL_PREFIXES: &[&str] = &[
    // Rust
    "fn", "pub", "impl", "struct", "enum", "trait", "mod", "use", "type", "const", "static",
    "macro_rules!", "#[", "#![", "///", "//!", "/**", "/*!", "//", // Python / shell（`#` 注释块）
    "#", // Python
    "def", "async", "class", "@", // JS / TS
    "function", "export", "import", "interface", "let", "var", // Go
    "func", "package", // JVM / C# / C++
    "public", "private", "protected", "internal", "namespace", "using", "void", "int",
];

/// 行首是否为已知的顶层声明前缀（含词边界校验，防 `impl` 命中 `implement`）
fn code_decl_prefix(line: &str) -> bool {
    CODE_DECL_PREFIXES.iter().any(|p| {
        if !line.starts_with(p) {
            return false;
        }
        let last = match p.chars().last() {
            Some(c) => c,
            None => return false,
        };
        // 前缀以符号结尾（`@` / `#[` / `///` / `macro_rules!`）→ 天然成界
        if !(last.is_alphanumeric() || last == '_') {
            return true;
        }
        // 以标识符字符结尾 → 要求下一字符不是标识符字符
        match line[p.len()..].chars().next() {
            None => true,
            Some(c) => !(c.is_alphanumeric() || c == '_'),
        }
    })
}

/// 维护 Markdown 围栏代码块状态（仅 `Markdown` 提示下生效）
fn toggle_fence(line: &str, hint: BoundaryHint, in_fence: &mut bool) {
    if hint != BoundaryHint::Markdown {
        return;
    }
    let t = line.trim_start_matches([' ', '\t']);
    if t.starts_with("```") || t.starts_with("~~~") {
        *in_fence = !*in_fence;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 所有块的行区间是否连通覆盖 `1..=total`（允许重叠，不允许空洞）
    fn assert_covers_all_lines(chunks: &[RawChunk], total: usize) {
        let first = chunks.first().expect("应至少一块");
        assert_eq!(first.start_line, 1, "首块应从第 1 行开始");
        let last = chunks.last().unwrap();
        assert_eq!(last.end_line, total, "末块应覆盖到末行");
        for w in chunks.windows(2) {
            assert!(
                w[1].start_line <= w[0].end_line + 1,
                "行覆盖出现空洞: {:?} -> {:?}",
                w[0],
                w[1]
            );
        }
    }

    /// 单块字符数不得超过 `max_chars` + 最长行（与 v1 同一上限口径）
    fn assert_no_chunk_inflated(chunks: &[RawChunk], max_chars: usize, longest_line: usize) {
        for c in chunks {
            let n = c.text.chars().count();
            assert!(
                n <= max_chars + longest_line + 1,
                "单块膨胀（{n} > {max_chars} + {longest_line}）: {c:?}"
            );
        }
    }

    #[test]
    fn chunks_accumulate_by_lines_with_overlap() {
        // 每行 10 字符 → max_chars=25 时每块约 2 行
        let text: String = (1..=6)
            .map(|i| format!("行{i} 一二三四五六\n"))
            .collect();
        let chunks = chunk_text(
            &text,
            &ChunkParams {
                max_chars: 25,
                overlap_lines: 1,
            },
        );
        assert!(chunks.len() >= 3, "应切成多块: {chunks:?}");
        // 行号连续覆盖全文（允许重叠）
        assert_eq!(chunks[0].start_line, 1);
        let last = chunks.last().unwrap();
        assert_eq!(last.end_line, 6, "最后一块应覆盖到末行");
        // 相邻块重叠一行：后块起点 ≤ 前块终点
        for w in chunks.windows(2) {
            assert!(
                w[1].start_line <= w[0].end_line,
                "应存在重叠: {:?} -> {:?}",
                w[0],
                w[1]
            );
        }
        // 每块文本非空
        assert!(chunks.iter().all(|c| !c.text.trim().is_empty()));
    }

    #[test]
    fn long_single_line_is_hard_split_same_line_no() {
        let long = "甲".repeat(1200);
        let chunks = chunk_text(
            &long,
            &ChunkParams {
                max_chars: 500,
                overlap_lines: 0,
            },
        );
        assert_eq!(chunks.len(), 3, "1200 字 → 500/500/200");
        assert!(chunks.iter().all(|c| c.start_line == 1 && c.end_line == 1));
        assert_eq!(
            chunks.iter().map(|c| c.text.chars().count()).sum::<usize>(),
            1200
        );
    }

    #[test]
    fn empty_and_small_text() {
        assert!(chunk_text("", &ChunkParams::default()).is_empty());
        let one = chunk_text("只有一行", &ChunkParams::default());
        assert_eq!(one.len(), 1);
        assert_eq!((one[0].start_line, one[0].end_line), (1, 1));
    }

    // ─── 边界感知（R2）────────────────────────────────────

    /// `Plain` 必须与 `chunk_text_for(..., Plain)` 完全一致（零行为变化锚点）
    #[test]
    fn plain_hint_is_byte_identical_to_legacy() {
        let text = "# 一级标题\n正文若干。\n\nfn main() {}\n\n## 二级\n又来一段。\n";
        let p = ChunkParams {
            max_chars: 20,
            overlap_lines: 1,
        };
        assert_eq!(chunk_text(text, &p), chunk_text_for(text, &p, BoundaryHint::Plain));
        // 且确实切了多块（否则该断言无意义）
        assert!(chunk_text(text, &p).len() > 1);
    }

    /// Markdown 标题成为块起点（前提：已累计半个块）
    ///
    /// `overlap_lines: 0` —— 重叠会让「块起点」集合混入回退行，掩盖边界判定本身；
    /// 重叠行为由 `chunks_accumulate_by_lines_with_overlap` 单独锁定。
    #[test]
    fn markdown_headings_become_chunk_starts() {
        // 每节正文 300 字（单行，未触硬切）→ 标题 + 正文 ≈ 307 > min_chars(250)，
        // 于是**下一个标题**必然触发提前收尾（若正文过短则门槛未达，断言会空转）
        let body: String = "测".repeat(300);
        let mut text = String::new();
        let mut heading_lines = Vec::new();
        for n in 1..=4 {
            heading_lines.push(text.lines().count() + 1);
            text.push_str(&format!("## 第{n}节\n{body}\n"));
        }
        assert_eq!(heading_lines, vec![1, 3, 5, 7]);

        let total = text.lines().count();
        let chunks = chunk_text_for(
            &text,
            &ChunkParams {
                max_chars: 500,
                overlap_lines: 0,
            },
            BoundaryHint::Markdown,
        );
        let starts: Vec<usize> = chunks.iter().map(|c| c.start_line).collect();
        // 每个标题行（含首行）恰好开启一块 —— 边界对齐的精确契约
        assert_eq!(starts, vec![1, 3, 5, 7], "每节应恰好一块: {chunks:?}");
        assert_covers_all_lines(&chunks, total);
        assert_no_chunk_inflated(&chunks, 500, 300);
    }

    /// 代码：列 0 顶层声明成为块起点；缩进的（块内）声明不触发切分
    #[test]
    fn code_top_level_declarations_become_chunk_starts() {
        let body = "    let x = 1; // 填充内容让函数体足够长，以越过半个块的门槛\n";
        let mut text = String::from("fn 甲() {\n");
        for _ in 0..8 {
            text.push_str(body);
        }
        text.push_str("}\n\nfn 乙() {\n");
        for _ in 0..8 {
            text.push_str(body);
        }
        text.push_str("}\n");
        // 块内（缩进）声明：不应被当作顶层边界
        text.push_str("impl 丙 {\n    fn 方法() {\n");
        for _ in 0..8 {
            text.push_str(body);
        }
        text.push_str("    }\n}\n");

        let total = text.lines().count();
        let chunks = chunk_text_for(
            &text,
            &ChunkParams {
                max_chars: 200,
                overlap_lines: 0,
            },
            BoundaryHint::Code,
        );
        let starts: Vec<usize> = chunks.iter().map(|c| c.start_line).collect();

        let line_of = |needle: &str| {
            text.lines()
                .position(|l| l.starts_with(needle))
                .map(|p| p + 1)
                .unwrap_or_else(|| panic!("语料缺少 `{needle}`"))
        };
        let fn_b = line_of("fn 乙");
        let impl_c = line_of("impl 丙");
        let inner_method = line_of("    fn 方法");
        assert!(starts.contains(&fn_b), "顶层 `fn 乙` 应为块起点: {starts:?}");
        assert!(starts.contains(&impl_c), "顶层 `impl 丙` 应为块起点: {starts:?}");
        assert!(
            !starts.contains(&inner_method),
            "缩进的 `fn 方法`（块内）不应成为块起点: {starts:?}"
        );
        assert_covers_all_lines(&chunks, total);
        assert_no_chunk_inflated(&chunks, 200, 50);
    }

    /// 词边界：`implement` / `internal` 之类不得被误判为声明
    #[test]
    fn code_prefix_requires_word_boundary() {
        for bad in ["implemented_by(&x);", "internally();", "let_me = 1;", "typechecked()"] {
            assert!(
                !is_boundary_line(bad, BoundaryHint::Code),
                "不应判为顶层边界: {bad}"
            );
        }
        for good in ["fn a() {}", "pub fn b()", "impl X {", "#[derive(Debug)]", "/// 文档"] {
            assert!(
                is_boundary_line(good, BoundaryHint::Code),
                "应判为顶层边界: {good}"
            );
        }
    }

    /// Markdown 围栏代码块内的 `#` 注释不得被当成标题
    ///
    /// `overlap_lines: 0` —— 否则回退行会让注释行**以重叠方式**成为下一块起点，
    /// 断言就不再能区分「边界判定误判」与「正常重叠」。
    #[test]
    fn fence_suppresses_heading_detection() {
        let filler = "正文段落，用于累积长度并保证跨越半个块。";
        let long: String = filler.repeat(20); // ~400 字单行：把累计推过 min_chars(250)
        let mut text = format!("## 真标题\n{long}\n");
        text.push_str("```python\n");
        text.push_str(&format!("# 这是代码里的注释\n{long}\n"));
        text.push_str("```\n");
        let total = text.lines().count();
        let comment_line = text
            .lines()
            .position(|l| l.starts_with("# 这是代码里的注释"))
            .map(|p| p + 1)
            .unwrap();
        let chunks = chunk_text_for(
            &text,
            &ChunkParams {
                max_chars: 500,
                overlap_lines: 0,
            },
            BoundaryHint::Markdown,
        );
        let starts: Vec<usize> = chunks.iter().map(|c| c.start_line).collect();
        // 若未跟踪围栏状态，注释行（列 0 的 `#`）会被误判为标题并切出新块
        assert!(
            !starts.contains(&comment_line),
            "围栏内的注释行 {comment_line} 不应成为块起点: {starts:?}"
        );
        assert_covers_all_lines(&chunks, total);
    }

    /// 散文（无结构边界）在 `Markdown` 提示下与 `Plain` 结果一致——边界只在存在时生效
    #[test]
    fn markdown_hint_without_headings_matches_plain() {
        let text = "没有任何标题的散文段落。".repeat(40);
        let p = ChunkParams::default();
        assert_eq!(
            chunk_text(&text, &p),
            chunk_text_for(&text, &p, BoundaryHint::Markdown)
        );
    }
}
