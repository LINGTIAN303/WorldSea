# 注释分层整改计划

status: 执行中

## 目标

落实《交付与质量规范》注释分层约束：
- 代码内只写**一行内简要注释**（说明"这行/这段在做什么"，what），并附详细注释文档的**相对路径**
- `docs/details/注释/` 承载详细注释：设计决策、整体思路、模块职责、踩坑约束（why/how）
- 判定线：what 留代码内就地；why/how 进文档
- 代码变更影响注释含义时，同步更新 `docs/details/注释/` 对应文档

## 摸底数据（2026-08-06 扫描）

- 全库 `apps/` + `crates/` + `packages/` 共 1250 个 `.rs/.ts/.vue` 文件
- 连续注释 ≥ 10 行的长注释块共 **495 块 / 262 文件**
- 重灾区：`crates/agent-runtime/src/agent.rs`（343 行/21 块）、`apps/tauri/useLoopControlRust.ts`（329 行/15 块）、`apps/web/AgentChat.vue`（176 行/11 块，已随 apps/web 删除 2026-08-08）

## 排除项（不整改，依据如下）

| 排除范围 | 依据 |
|---|---|
| `crates/vendor/`（memory-center-core*，外部复制代码） | 保持与上游 MemoryCenter 原样一致，便于后续同步；改注释会造成 diff 噪音 |
| `packages/memory-archive/`（TS 版记忆归档） | 项目决策：MemoryCenter 集成落地后清理 TS 版（阶段 5），避免白改 |

其余自有活跃代码全部整改。

## 整改规则（判定与动作）

1. **抽取对象**：连续 ≥ 10 行、且内容属于"架构图 / 流程图 / 事件协议 / 设计决策 / 模块职责 / 踩坑说明"的注释块
2. **代码内保留**：一行简要说明 + 相对路径，示例：
   - Rust：`//! AgentLoop — ReAct 核心循环，详细见 docs/details/注释/agent-runtime/agent.md`
   - TS/Vue：`// 事件协议说明见 docs/details/注释/tauri/useAgentRust.md`
3. **文档落位**：`docs/details/注释/<模块>/<文件基名>.md`，按代码文件一一对应；文档内按"文件内注释块"组织，记录原起始行号便于回查
4. **不变更逻辑**：只动注释，不碰任何可执行代码；`// --- 区块分隔 ---` 类结构性短注释可保留
5. **短注释不动**：单行/3 行内自解释注释保持原样

## 批次划分

| 批次 | 范围 | 说明 |
|---|---|---|
| 1 | `crates/agent-runtime` | 核心，含 21 个有长注释的文件 |
| 2 | `crates/agent-commands`、`crates/agent-memory`、`crates/server`（如有） | 命令层 + 记忆适配层 |
| 3 | `apps/tauri/src/agent/` | useAgentRust / useLoopControlRust / useLongTaskRust 等 |
| 4 | ~~`apps/web/`~~ | AgentChat.vue、governor、memory-archive 调用层（**已删除 2026-08-08，批次取消**） |
| 5 | ~~`apps/cli/`~~ | serve.ts 等（**已删除 2026-08-08，批次取消**） |
| 6 | `packages/` 活跃包 | agent-core / agent-runtime / entity-core / governor-core / canvas-engine / font-kit / motion-kit 等（排除 memory-archive） |

## 文档组织

```
docs/details/注释/
├── README.md            # 索引（模块 → 文档清单 + 一句话摘要）
├── agent-runtime/       # crates/agent-runtime 各文件
├── agent-commands/
├── tauri/
├── web/
├── cli/
└── packages/
```

## 验收

1. 无长注释块残留（重新跑扫描脚本，≥10 行连续注释块清零或仅剩允许保留的区块分隔）
2. `docs/details/注释/` 与代码文件一一对应，注释内相对路径可点击直达
3. `cargo check`（各 crate）/ `vue-tsc` 通过（注释改动不影响编译）
4. `docs/index/README.md` 索引同步
