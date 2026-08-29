# Agent 设置整合·迭代二（风险决策 + 模型区重构 + 图标/矩阵）

> status: 已完成
>
> 创建于 2026-08-23，执行完成于同日。在第一版整合基础上完成：4 项风险决策、模型区横向布局与
> 「供应商→模型」左右分栏子面板、供应商官方图标（@lobehub/icons-static-svg 本地 vendor）、
> 图像/视频/音频矩阵补充与分类核实。

## 依据文档（现状锚点）
- 第一版计划：`docs/plans/2026-08-23-agent-settings-integration-plan.md`（已完成）
- 供应商/模型矩阵：`.trae/documents/provider-models-matrix-20260823.md`（26 家供应商官方链接、协议/解析、聚合定夺、文本+视觉矩阵）
- 模型卡片现状：`apps/tauri/src/agent/panels/model/`（ModelsSection/ProviderTypeDialog/SessionWindowForm/ModelParamsDialog/ModelDialog/model-classify.ts）
- 权限分级现状：`apps/tauri/src/space/chat/ChatInput.vue`（`perm-seg` 分段控件）
- 图标参考：`@lobehub/icons`（React 组件；Vue 端取 PNG/SVG 静态资源）

---

## 里程碑 P0 — 4 项风险决策

### T-P0-1: 保存即触发连接测试 + 结果提示
- **goal**: 点击「保存」必触发一次连接检测（验证 endpoint + key 是否正确），并 toast 提示对/错。
- **files**: `apps/tauri/src/agent/panels/model/ProviderTypeDialog.vue`（`onSave`/`testConnection`）
- **acceptance**: 保存时自动测连接并在界面/`toastWarn`/`toastInfo` 反馈成功或失败；失败不阻断其它字段保存。

### T-P0-2: TopP/TopK/思考 保存即对当前模型生效
- **goal**: 会话窗口参数在保存该模型时即写入对应模型（而非仅依赖后续选中）；参数按「当前保存的模型」绑定。
- **files**: `ProviderTypeDialog.vue`、`useAgentRust.updateModel`（已支持）、`SpaceAgentSettingsPanel`
- **acceptance**: 三级面板保存后，该模型下次调用（任一会话）即携带 top_p/top_k/thinking（参数按模型归档存储）。

### T-P0-3: 供应商/模态分类按矩阵文档核实
- **goal**: 依据 `provider-models-matrix` 的供应商官方链接与模型能力，修正 `model-classify.ts` 的供应商「官方/聚合/应用」与模型「全模态/文本/图像/视频/语音」映射。
- **files**: `apps/tauri/src/agent/panels/model/model-classify.ts`
- **acceptance**: 供应商与模型分类与文档标注一致（聚合平台归 aggregate、视频/图像模型归对应模态等）。

### T-P0-4: 权限分级改图标下拉 + 三档（手动确认/自动判断/完全通过）
- **goal**: 主输入栏权限分级由分段控件改为图标下拉；三档「手动确认 / 自动判断 / 完全通过」，其中「完全通过」用黄色字体（放开全部权限，视觉警示）。
- **files**: `apps/tauri/src/space/chat/ChatInput.vue`（`perm-seg` 区）
- **acceptance**: 下拉三档可选；「完全通过」为黄色；切换写穿后端 SecurityLevel（映射确认见下）。
- **spec**: 三档→security level 映射（已确认 2026-08-23）：完全通过=off｜自动判断=dangerous_only｜手动确认=moderate_and_dangerous；「完全通过」用黄色字体

---

## 里程碑 P1 — 模型区重构（横向布局 + 供应商图标 + 面板合并）

### T-P1-1: 一级卡片 3 类型改横向
- **goal**: 云端 API/本地模型/第三方自定义 由纵排改横向平铺。
- **files**: `ModelsSection.vue`
- **acceptance**: 三类型横向排列。

### T-P1-2: 供应商二级面板横向 3 列 + 官方图标
- **goal**: 云二级供应商横排并排三列，每供应商 UI 带官方图标。
- **files**: `ProviderTypeDialog.vue`（cloud 二级列表）、图标接入（见 P2-1）
- **acceptance**: 供应商按三列网格横排并显图标。

### T-P1-3: 模型三级并入二级子面板（供应商左移 + 右侧模型子面板）
- **goal**: 点击供应商，供应商二级面板左移，右侧就地展开该模型子面板，减少一次弹层切换。
- **files**: `ProviderTypeDialog.vue`（二级→三级由叠加改为左右分栏 wizard）
- **acceptance**: 选供应商后左右分栏：左侧供应商、右侧模型子面板；返回/切供应商不弹新层。

### T-P1-4: 模型子面板内容调整
- **goal**: ① 供应商项=官方名+图标；② 模型项=下拉可输入（combobox）；③ API key：保存后清空输入、记住已测通过的 key，交互可输可选（可能要动后端存 key 列表）；④ 会话窗口项（上下文/输出/温度/TopP/TopK）滑条→填写且限制最大数；⑤ 本地/自定义的「模型类型」下拉→单选（全模态/文本/图像/视频/语音）。
- **files**: `ProviderTypeDialog.vue`、`SessionWindowForm.vue`、`ModelParamsDialog.vue`、可能的后端 key 存储
- **acceptance**: 上述 5 项在 UI 上落实；key 记忆/清空行为正确。

### T-P1-5: 可用模型（一级卡片）跨供应商全面展示
- **goal**: 统一「已保存模型」列表（跨供应商持久化）；已保存模型无论供应商都横向三列 UI 罗列 + 图标。
- **files**: `ModelsSection.vue`、新增「已保存模型」存储（统一列表）
- **acceptance**: 已保存模型跨供应商在「可用模型」区横向三列展示并显图标。
- **spec**: 已确认持久化为「统一已保存模型列表」

---

## 里程碑 P2 — 图标接入与矩阵补充

### T-P2-1: 供应商官方图标接入（本地 vendor SVG）
- **goal**: 把 `@lobehub/icons-static-svg` 的供应商 SVG 本地化到项目并离线引用，用于供应商项与可用模型项。
- **files**: 图标 vendor 目录 + 图标映射模块（`providerIcons` 扩展或新增）
- **acceptance**: 供应商/模型均显示对应官方 SVG 图标（离线可用）。
- **spec**: 已确认采用「本地 vendor SVG」方案

### T-P2-2: 图像/视频/语音模型矩阵补充
- **goal**: 在 `provider-models-matrix-20260823.md` 补充图像/视频/语音（非对话 LLM）模型矩阵表（kling、agnes-image/video、stepaudio、doubao-seedance 等）。
- **files**: `.trae/documents/provider-models-matrix-20260823.md`
- **acceptance**: 文档含图像/视频/语音分块矩阵。

### T-P2-3: 模型模态分类接入矩阵数据
- **goal**: `model-classify.ts` 的模态/供应商分类直接消费矩阵文档同步出的注册数据，减少硬编码覆盖。
- **files**: `model-classify.ts`、`model-registry.ts`（如补充模态字段）
- **acceptance**: 分类以数据驱动，覆盖表仅作兜底。

---

## 推进方式
- P0-1/P0-2/P0-4 为独立小改，可先落地保 repo 绿；P0-3 与 P1-2/P1-4 耦合（分类+面板）。
- P1 模型区重构是核心，串行推进（P1-1→P1-2→P1-3→P1-4→P1-5）。
- P2 图标与矩阵可与 P1 并行/后置。
- 每批即时 7 点自检；需用户决策项列出风险点，不自动处理。

## 变更记录
- **2026-08-23**：创建迭代二计划（P0 决策 + P1 重构 + P2 图标/矩阵）。
- **2026-08-23（执行完成）**：
  - P0：权限分级改图标下拉三档（手动确认=moderate_and_dangerous/自动判断=dangerous_only/完全通过=off，黄色）；保存即测连接+toast；会话窗口参数按当前模型归档+即生效
  - P1：一级卡片 3 类型横向；`ProviderTypeDialog` 重写为左列表(供应商横向3列+官方图标)+右表单主从分栏；模型 combobox/API Key 记住+清空/会话窗口数字填写限界/模型类型单选；可用模型跨供应商统一网格(3列+图标)
  - P2：`@lobehub/icons-static-svg` 本地 vendor 官方图标（`providerIconUrl`/`ProviderLogo`，24 家官方 SVG + monogram 兜底）；`model-classify` 聚合平台(openrouter/tencentcloud/bailian/modelscope/siliconflow/doubao)与图像/视频/音频/全模态覆盖；矩阵文档补 图像/视频/音频 分块