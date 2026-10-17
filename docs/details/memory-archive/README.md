# 记忆归档专题（memory-archive）

> **状态**：历史留档——该线已退场（`packages/memory-archive` 于 2026-10-11 文件清理轮按死代码删除），本文档库保留为记忆线的演进记录。
> 现行记忆系统见 [A1 记忆系统设计](../../plans/已完成/2026-09-11-A1-记忆系统设计.md)。

## 文件清单

| 文件 | 内容 |
|---|---|
| [2026-06-17-memory-archive-framework-design.md](2026-06-17-memory-archive-framework-design.md) | 框架核心设计：归档 / 检索 / 调度 |
| [2026-06-17-memory-archive-pending-issues.md](2026-06-17-memory-archive-pending-issues.md) | P1–P18 待定问题清单（索引记载：已全部处理完毕） |

## 结论

- 该框架未成为长期方案；记忆线最终收敛到 A1（Rust 侧 MemoryCenter + 前端 KV + 归档包的混合形态）。
- 本目录只读：不再更新，不参与索引逐文件登记（按专题目录整体登记一行）。
