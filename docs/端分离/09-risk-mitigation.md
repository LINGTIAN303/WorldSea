# 09 - 风险与回滚策略

> 识别端分离全流程中的技术风险、流程风险，并制定可执行的缓解与回滚方案。

## 1. 风险分级标准

| 等级 | 定义 | 响应要求 |
|------|------|----------|
| **P0 致命** | 导致三端功能不可用、数据丢失、无法回滚 | 立即停止，回滚，修复后重试 |
| **P1 严重** | 单端功能不可用、构建失败、性能显著退化 | 暂停该阶段，修复或回滚 |
| **P2 中等** | 部分功能受限、需要手工 workaround | 记录 issue，继续推进，后续修复 |
| **P3 轻微** | 代码异味、文档滞后、非关键路径警告 | 记录技术债，择机处理 |

## 2. 技术风险清单

### R-01: 共享代码层抽离导致循环依赖

| 项 | 内容 |
|----|------|
| **等级** | P0 |
| **阶段** | Phase 1 |
| **描述** | `packages/agent-runtime` 抽离时，agent.ts / tools / skills / session 之间存在循环引用，导致 tsc 报错或运行时 `Cannot access before initialization` |
| **触发信号** | tsc 报 `Circular dependency`；运行时 `ReferenceError` |
| **缓解** | 1. 抽离前用 `madge` 检测循环依赖<br>2. 通过接口倒置（trait + DI）解耦<br>3. 公共类型独立到 `types.ts`，不依赖任何实现 |
| **回滚** | git revert Phase 1 commit，恢复 worldsmith-agent 原结构 |

### R-02: IAgentBackend 接口设计不合理需返工

| 项 | 内容 |
|----|------|
| **等级** | P1 |
| **阶段** | Phase 1 |
| **描述** | 接口遗漏关键方法（如 abort、streaming cancel），或参数设计不合理，导致三端实现时需修改接口，连锁影响所有调用方 |
| **触发信号** | 实现端 backend 时发现接口不足；review 时发现设计缺陷 |
| **缓解** | 1. 接口先 review 再实现<br>2. 参考现有 useAgent.ts 的调用面推导接口<br>3. 预留扩展点（`extra?: Record<string, unknown>`） |
| **回滚** | 接口修改属于增量变更，无需回滚，补充方法即可 |

### R-03: Tauri 专用 composables 迁移后引用断裂

| 项 | 内容 |
|----|------|
| **等级** | P1 |
| **阶段** | Phase 3 |
| **描述** | 8 个 Rust composables 迁移到 `apps/tauri/src/` 后，共享组件中的 import 路径未更新，导致 Tauri 端编译失败 |
| **触发信号** | tsc 报 `Cannot find module` |
| **缓解** | 1. 用 provide/inject 模式，共享组件不直接 import Rust composables<br>2. 迁移后全量 grep 确认无残留引用<br>3. 每迁移一个文件立即 tsc 验证 |
| **回滚** | git revert 对应 commit，恢复文件到原位置 |

### R-04: Web 端 WASM 路径被误删

| 项 | 内容 |
|----|------|
| **等级** | P0 |
| **阶段** | Phase 3 |
| **描述** | 改造 coreBackend.ts 时，误删 WASM 路径（仅保留 Tauri 分支），导致 Web 端无后端可用 |
| **触发信号** | Web 端功能全部失效，console 报 `getBackendType returns 'none'` |
| **缓解** | 1. Web 端 coreBackend.ts 从原文件复制后，仅删除 Tauri 分支<br>2. 保留 WASM 路径完整<br>3. 改造后立即在浏览器验证 |
| **回滚** | git checkout 原 coreBackend.ts |

### R-05: CLI serve 模式无法完全替代 worldsmith-server

| 项 | 内容 |
|----|------|
| **等级** | P1 |
| **阶段** | Phase 4 |
| **描述** | worldsmith-server 某些端点（如 PTY 管理、文件监听）在 CLI serve 中实现不完整，导致 Web 端功能退化 |
| **触发信号** | Web 端调用 CLI serve 返回 404；功能缺失 |
| **缓解** | 1. Phase 4 前先做能力盘点（P4-T2）<br>2. 逐端点迁移，每个端点 curl 验证<br>3. 保留 worldsmith-server 直到 CLI serve 完全覆盖 |
| **回滚** | Web 端 API 调用层切回 worldsmith-server |

### R-06: 三端构建产物互相污染

| 项 | 内容 |
|----|------|
| **等级** | P2 |
| **阶段** | Phase 5 |
| **描述** | Vite 配置未完全隔离，Web 端产物包含 Tauri 相关代码，或 Tauri 端产物包含 worldsmith-server 依赖 |
| **触发信号** | 产物体积异常；运行时加载非预期模块 |
| **缓解** | 1. 三端 vite.config.ts 独立，alias 不跨端<br>2. 构建后检查产物 chunk 列表<br>3. 用 `rollup-plugin-visualizer` 分析产物 |
| **回滚** | 恢复 vite.config.ts |

### R-07: 插件系统在三端加载异常

| 项 | 内容 |
|----|------|
| **等级** | P2 |
| **阶段** | Phase 3 |
| **描述** | 插件（mindmap、workflow）中 Rust 调用迁移后，插件在 Web 端加载失败，或 Tauri 端找不到 Rust 实现 |
| **触发信号** | 插件面板空白；console 报模块加载错误 |
| **缓解** | 1. 插件层用 ExecutionAdapter 抽象，不直接 import Rust composables<br>2. Web 端插件提供 JS 降级实现<br>3. 三端分别测试插件加载 |
| **回滚** | 恢复插件原文件 |

### R-08: 数据迁移导致用户数据丢失

| 项 | 内容 |
|----|------|
| **等级** | P0 |
| **阶段** | Phase 6 |
| **描述** | 删除旧目录时误删用户数据文件（如 SQLite 数据库、配置文件） |
| **触发信号** | 用户报告数据丢失 |
| **缓解** | 1. 数据文件（data/、*.db）不在代码迁移范围<br>2. 删除前确认 `.gitignore` 覆盖数据文件<br>3. 删除前备份 |
| **回滚** | 从 git 历史或备份恢复 |

## 3. 流程风险清单

### R-09: 长时间迁移导致主分支停滞

| 项 | 内容 |
|----|------|
| **等级** | P1 |
| **描述** | 端分离工作量大，若在主分支直接操作，会阻塞其他功能开发 |
| **缓解** | 1. 在独立分支（如 `feat/end-separation`）上推进<br>2. 定期 rebase main，保持同步<br>3. 按 Phase 拆分 PR，分阶段合并 |
| **回滚** | 废弃分支，主分支不受影响 |

### R-10: 文档与代码不同步

| 项 | 内容 |
|----|------|
| **等级** | P3 |
| **描述** | 迁移过程中实际代码变更与文档计划偏离，导致文档失去参考价值 |
| **缓解** | 1. 每个 Phase 完成后更新文档<br>2. 文档中标注"实际状态"与"计划状态"<br>3. 关键决策变更时同步更新 00-overview.md |
| **回滚** | 无需回滚，补充更新即可 |

### R-11: 上下文压缩丢失迁移进度

| 项 | 内容 |
|----|------|
| **等级** | P2 |
| **描述** | 会话上下文压缩后，AI 可能重复已完成的工作或遗漏关键决策 |
| **缓解** | 1. 每完成一个 Phase 更新 project_memory.md<br>2. TodoWrite 持续跟踪<br>3. 本文档库作为持久化知识库 |
| **回滚** | 无需回滚，从 project_memory 恢复进度 |

## 4. 回滚策略总表

### 4.1 分阶段回滚

| 阶段 | 回滚成本 | 回滚方式 | 数据影响 |
|------|----------|----------|----------|
| Phase 1 | 低 | git revert | 无 |
| Phase 2 | 极低 | 删除 apps/ 目录 | 无 |
| Phase 3 | 中 | git revert 多个 commit | 无 |
| Phase 4 | 中 | 恢复 worldsmith-server，Web 切回 | 无 |
| Phase 5 | 低 | 恢复构建配置 | 无 |
| Phase 6 | 高 | 从 git 历史恢复旧目录 | 需确认数据文件未删 |

### 4.2 回滚操作步骤

#### 场景 A: Phase 3 改造导致 Tauri 端编译失败

```bash
# 1. 确认失败范围
cd apps/tauri && npx tsc --noEmit

# 2. 定位问题 commit
git log --oneline -10

# 3. 回滚到上一个可工作状态
git revert <problem-commit>

# 4. 验证
cd apps/tauri && npx tsc --noEmit
cd apps/web && npx tsc --noEmit

# 5. 修复后重新推进
```

#### 场景 B: Phase 4 CLI serve 无法替代 worldsmith-server

```bash
# 1. 保留 CLI serve 代码，但不切换 Web 端
# 2. Web 端 API 调用层保持调 worldsmith-server
# 3. 标记 P4-T5 为 blocked
# 4. 后续修复 CLI serve 缺失能力后重新推进
```

#### 场景 C: Phase 6 误删数据文件

```bash
# 1. 立即停止所有操作
# 2. 从 git 历史恢复
git checkout HEAD~N -- path/to/data/

# 3. 若 git 未跟踪，从备份恢复
# 4. 验证数据完整性
```

## 5. 回滚预防措施

### 5.1 分支策略

```
main (稳定，可随时部署)
  └── feat/end-separation (端分离工作分支)
       ├── phase-1-agent-runtime
       ├── phase-2-apps-skeleton
       ├── phase-3-frontend-cleanup
       ├── phase-4-backend-integration
       ├── phase-5-build-config
       └── phase-6-verification
```

- 每个 Phase 一个子分支，完成后合并到 `feat/end-separation`
- `feat/end-separation` 定期 rebase `main`，保持同步
- 全部完成后，`feat/end-separation` 合并到 `main`

### 5.2 检查点（Checkpoint）

每个 Phase 完成后创建 git tag：

```bash
git tag -a end-separation-phase-1 -m "Phase 1 完成：agent-runtime 抽离"
git tag -a end-separation-phase-2 -m "Phase 2 完成：三端骨架建立"
# ...
```

回滚时可直接 `git reset --hard end-separation-phase-N`。

### 5.3 数据备份

Phase 6 删除旧目录前：

```bash
# 1. 备份数据目录
cp -r data/ data.backup.$(date +%Y%m%d)/

# 2. 确认 git status 干净
git status

# 3. 创建回滚 tag
git tag -a pre-cleanup -m "清理旧目录前"

# 4. 执行删除
# 5. 验证三端正常后删除备份
```

## 6. 风险监控清单

迁移过程中持续监控的指标：

| 指标 | 正常 | 异常 | 检查频率 |
|------|------|------|----------|
| 三端 tsc 编译 | 0 error | 出现新 error | 每次 commit |
| 三端 build 产物体积 | 与基线 ±10% | 显著增大 | 每个 Phase |
| CLI serve 端点覆盖率 | = worldsmith-server | 有端点缺失 | Phase 4 |
| `grep @tauri-apps/api apps/web/` | 空 | 有结果 | Phase 3 后 |
| `grep __TAURI__ apps/web/` | 空 | 有结果 | Phase 3 后 |
| `grep worldsmith-server apps/` | 仅 Web 端 | Tauri/CLI 端有 | Phase 4 后 |
| 浏览器 console 警告 | 无新增 | 出现 Tauri/WASM 相关警告 | 每个 Phase |

## 7. 应急联系人

| 场景 | 处理方式 |
|------|----------|
| 数据丢失 | 立即停止，从备份/git 恢复 |
| 主分支被污染 | `git reset --hard` 到最近 tag，强制推送需用户确认 |
| 无法回滚 | 保留问题现场，记录详细日志，寻求人工介入 |
