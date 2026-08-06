# deep_phases.rs 详细注释文档（agent-runtime）

> 来源：`crates/agent-runtime/src/deep_phases.rs` 中连续 ≥ 10 行的长注释块，按文件内出现顺序迁移至此。
> 代码内原位置已替换为一行简要注释 + 相对路径。

## 注释块 1（原文件第 1-23 行）

# Deep Mode 阶段定义与工具映射

移植自 TS 端 `src/agent/bubbles/deepPhases.ts`。
将工具调用按"问题拆解→证据收集→推理分析→创作操作→结论输出"五阶段分组，
用于 Rust 端 ReAct 循环判定当前所处阶段并广播 `DeepPhaseChanged` 事件。

## 设计原则
- **单一真理源（Rust 侧）**：本模块是 Rust 端阶段判定的唯一来源，
  不依赖 TS 后端，直接基于工具名映射表判定。
- **与 TS 端一致性**：工具集合需与 `deepPhases.ts` 保持一致，
  通过 CI 测试 `tests/deep_phases_parity.rs` 保障（见任务7）。
- **静态数据**：使用 `&'static [&'static str]` 切片，避免运行时分配。

## 阶段判定规则
1. 按工具名查表，找到的第一个阶段即为当前阶段。
2. 未在表中的工具归为"其他操作"，`phase_index = -1`。
3. 同一工具不会出现在多个阶段（保持互斥）。

## 与 TS 端的差异
- TS 端在前端 `DeepMessageArea.vue` 通过计算属性实时构建 `deepSegments`；
  Rust 端只发 `DeepPhaseChanged` 事件，由前端组合成 `deepSegments`。
- TS 端的 `ALL_PHASE_TOOLS` Set 在 Rust 侧用 `classify_tool` 返回值
  `phase_index == -1` 表达"未匹配"。

---

## 注释块 2（原文件第 103-121 行）

按工具名判定所属阶段

遍历 `DEEP_PHASES`，返回第一个匹配的阶段 label 与 index。
未匹配返回 `(OTHER_PHASE_LABEL, OTHER_PHASE_INDEX)`。

# 参数
- `tool_name`：工具名（LLM 工具调用返回的 `name` 字段）

# 返回
`(阶段标签, 阶段索引)`，索引 0..4 对应五阶段，-1 为"其他操作"

# 示例
```rust,ignore
use agent_runtime::deep_phases::classify_tool;

assert_eq!(classify_tool("output_list"), ("问题拆解", 0));
assert_eq!(classify_tool("read_file"), ("证据收集", 1));
assert_eq!(classify_tool("unknown_tool"), ("其他操作", -1));
```
