//! 分块（按行累积 + 重叠；不截断行）
//!
//! 方案评定的规模测算以 ~500 字/块为基准；中文与代码都按**行边界**切，避免把一行
//! 从中截断（代码/表格可读性差、向量语义也被割裂）。超长的单行（压缩过的 JSON 等）
//! 按字符硬切（无法按行，硬切是唯一选择）。

/// 分块参数
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

/// 文本 → 块序列（行号 1 起闭区间；空文本 → 空序列）
pub fn chunk_text(text: &str, p: &ChunkParams) -> Vec<RawChunk> {
    let lines: Vec<&str> = text.lines().collect();
    let mut out: Vec<RawChunk> = Vec::new();
    let mut ordinal = 0usize;
    let mut i = 0usize;
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
            i += 1;
            continue;
        }

        while i < lines.len() && chars < p.max_chars {
            let l = lines[i];
            acc.push_str(l);
            acc.push('\n');
            chars += l.chars().count() + 1;
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

#[cfg(test)]
mod tests {
    use super::*;

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
}
