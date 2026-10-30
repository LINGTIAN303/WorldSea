# UI 风格机制（产品域）

> 状态：B1 已落地（2026-10-30），B2/B3 待施工。
> 计划：[2026-10-30-UI组件风格机制.md](../../plans/2026-10-30-UI组件风格机制.md) · 施工计划：[2026-10-30-UI组件风格机制-施工计划.md](../../plans/2026-10-30-UI组件风格机制-施工计划.md)
> 包内注释说明见 [style-kit/index.md](../注释/packages/style-kit/index.md)。

## 一、定位

风格 = **表面契约 + 风格包**。组件声明自己是什么表面角色，风格包只提供角色配方；现有通用令牌重指向角色层，让存量组件零改动跟随。

仅作用于产品域工作台窗（`/workspace/`），不进入壳 `prefs.json`、不影响 dsh。

## 二、分层与优先级

```mermaid
flowchart TD
  A["基础色板 theme.css<br/>底色 × 强调色"] --> B["风格包 --sf-*<br/>mist / soft-glass / neu"]
  B --> C["别名层<br/>--bg-surface / --border / --shadow-* / --glass-*"]
  C --> D["用户令牌覆盖<br/>entity-core userOverrides"]
  D --> E["组件级覆盖<br/>componentOverrides"]
  E --> F["组件渲染"]
```

- 风格包负责表面质感；底色与强调色仍由原两轴控制。
- 用户令牌覆盖（圆角/密度）与组件覆盖优先级更高，不被风格包清除。
- 运行时由 `<html data-style>` 决定风格，`<html data-perf="on">` 决定性能模式；四维覆盖以行内 CSS 变量写在根元素。

## 三、表面角色

| 角色 | 变量前缀 | 主要覆盖 |
|---|---|---|
| canvas | `--sf-canvas-bg` | 应用底 |
| chrome | `--sf-chrome-*` | 窗口栏 / 标题栏 |
| nav | `--sf-nav-*` | 侧栏 / 导航轨 |
| panel | `--sf-panel-*` | 区域 / 面板 |
| card | `--sf-card-*` | 实体卡 / 内容卡 |
| control | `--sf-control-*` | 按钮 / 输入 / 分段器 / chip |
| overlay | `--sf-overlay-*` | 浮层 / 菜单 / 下拉 / 抽屉 |
| modal | `--sf-modal-bg` | 模态 |
| table | 复用 `--sf-panel-*` | 表头 / 行 / 网格 |
| accent-surface | `--sf-accent-surface-bg` | 强调面 |

契约变量全集在 `packages/style-kit/src/contract.ts`；每个风格包必须全覆盖，缺一即测试失败。

## 四、不可风格化红线

文字、图标、语义色（danger/success/warning/info）、焦点环、代码与 Markdown 高亮、强调色本体，一律不由风格包定义。表格网格、分隔线、滚动条允许适配但保留可读性下限：文字对比度 ≥ 4.5:1，控件边界 ≥ 3:1。

## 五、四维

| 维度 | 变量 | 作用 |
|---|---|---|
| 材质强度 | `--sf-material` | 配方强度系数（当前用于透明度/高光扩展位） |
| 实体深度 | `--sf-depth` | 阴影长度乘数，0 = 贴底无影 |
| 形变弹性 | `--sf-morph` | 角色圆角乘数，联动 `motion-kit` 弹性曲线 |
| 触感反馈 | `--sf-tactile` | 按压缩放系数，100 ≈ 0.96 |

公式集中在 `presets/base.css`：`--sf-depth-scale`、`--sf-radius-scale`、`--sf-press-scale`。

## 六、三套预设

| | mist（默认） | soft-glass | neu |
|---|---|---|---|
| 表面 | 近不透明 | 半透明 0.55–0.75 | 与底色同色系 |
| 模糊 | 无 | 18–22px（tier A） | 无 |
| 边界 | 1px 实边 | 高光边 | 无边框 + 双向阴影 |
| 阴影 | 单级轻影 | 柔和扩散 | 双向外阴影 + 按压内陷 |
| 圆角 | 8–10 | 14–20 | 14–18 |

## 七、性能分级

- tier A（浮层/模态/导航/窗口栏）：真 `backdrop-filter`。
- tier B（卡片/面板/表格）：伪玻璃（半透明 + 高光边）。
- tier C（画布/白板）：不透明零模糊。
- 性能模式一键把 tier A 模糊归零；存量 25 处 `backdrop-filter` 在 B3 统一收编。

## 八、一致性门禁

`npm run style:check` 扫描 `packages/ui-kit/src` 与 `apps/tauri/src` 的样式块，禁止新增硬编码颜色、`box-shadow`、`backdrop-filter`；存量以 `scripts/style-conformance/baseline.json` 锁死，只许降不许升。白名单：品牌资产、图标资产、图谱绘制。
