# deep_phases_parity.rs 详细注释文档（agent-runtime tests）

> 来源：`crates/agent-runtime/tests/deep_phases_parity.rs` 中连续 ≥ 10 行的长注释块，按文件内出现顺序迁移至此。
> 代码内原位置已替换为一行简要注释 + 相对路径。

## 注释块 1（原文件第 1-26 行）

# Deep Phases 跨语言一致性测试（CI 守护）

## 背景
Deep Mode 的工具→阶段映射表在 TS 与 Rust 两端各有一份：
- TS 端：`packages/shared-ui/src/agent/bubbles/deepPhases.ts` 的 `DEEP_PHASES` 数组
- Rust 端：`crates/agent-runtime/src/deep_phases.rs` 的 `DEEP_PHASES` 常量

两份映射表必须保持一致，否则会出现：
- Rust 端判定阶段 A，前端 UI 显示阶段 B
- 前端 DeepMessageArea 计算的 phaseSegments 与 Rust 端广播的 DeepPhaseChanged 不匹配
- 工具被 Rust 端归为"其他操作"但前端认为属于某阶段

## 实现策略
1. 通过 `include_str!` 在编译期嵌入 TS 源文件（路径相对本文件）
2. 用简单字符扫描解析 TS 文件，提取 `tools: [...]` 块中的字符串字面量
3. 与 Rust 端 `all_phase_tools()` 返回值逐项对比

## 选择简单字符扫描而非完整 TS 解析器的原因
- TS 语法复杂，完整解析需引入 swc/typescript 等重依赖
- 本文件结构固定（`tools: [...]` 块），简单扫描足够稳健
- 测试失败时人工 diff 即可定位差异，无需精确错误定位

## 维护提示
- 修改 `deepPhases.ts` 或 `deep_phases.rs` 任一文件后，运行 `cargo test -p agent-runtime --test deep_phases_parity` 验证
- 新增工具时，请同步更新两端，并确保阶段归属一致
- 此测试不依赖任何外部依赖，可在 CI 中无网络环境运行

---

## 注释块 2（原文件第 60-70 行）

解析 TS 端 `DEEP_PHASES` 数组中的所有工具名

# 解析逻辑
1. 逐行扫描，识别 `tools: [` 标记（行首或行内）
2. 进入 tools 块后，逐行提取 `'...'` 字符串
3. 遇到 `]` 行结束当前 tools 块

# 注意
- 跳过 `label:` 字段（在 tools 块外）
- 同行可能有多个 `'...'`（如 `'a', 'b'`）
- 同行 `tools: ['a', 'b']` 也要正确处理
