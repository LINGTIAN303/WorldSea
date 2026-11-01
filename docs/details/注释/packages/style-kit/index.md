# style-kit 包 · 注释说明

> 代码内只保留一行简要注释；本文件承载设计决策、约束与扩展办法。
> 架构总览见 [UI风格机制.md](../../../架构/UI风格机制.md)。

## 一、为什么是「表面契约」而不是「多套皮肤」

存量 315 个 Vue 组件里，只有 16 个消费 `--bg-surface`，但 171 处硬编码 `box-shadow`。逐组件写三套样式必然分叉，也无法表达新拟态的双向阴影与玻璃的高光边。因此：

- 组件只消费角色变量 `--sf-*`；
- 风格包只提供角色配方；
- 现有通用令牌（`--bg-surface` / `--border` / `--shadow-*` / `--glass-*`）在 `base.css` 里重指向角色层，存量组件自动跟随。

## 二、文件职责

| 文件 | 职责 |
|---|---|
| `packs.ts` | 风格注册表、四维默认值、轴元数据 |
| `contract.ts` | 必需角色变量与禁写变量清单（测试的唯一真源） |
| `presets/base.css` | 四维公式 + 通用令牌重指向 |
| `presets/<id>.css` | 单套风格的角色配方（含明暗两块）；`liquid-glass.css` 另含 `--sf-liquid-*` 设置弹层专属令牌 |
| `presets/perf.css` | 性能模式覆盖，必须最后引入 |
| `styles.css` | 单一引入口 |
| `composables/useStyle.ts` | 运行时状态、持久化、`data-style` / `data-perf` 唯一控制源 |

## 三、硬约束

1. **风格包不得引用会被重指向的令牌**：`--bg-app`、`--bg-surface`、`--bg-muted`、`--border*`、`--shadow-*`、`--glass-*`。否则形成 CSS 变量循环，计算结果为空。契约测试会拦截。
2. **风格包不得定义文字/语义/强调色令牌**。这些属于红线，由 `theme.css` 与强调色引擎负责。
3. **只有 `useStyle` 能写 `data-style`**。防闪脚本在挂载前读 localStorage 并直接写一次，是唯一例外。
4. **不写入壳 `prefs.json`**。风格是产品域私有轴，避免与 dsh 主题同步链耦合。
5. **性能模式只改模糊变量**，不改变任何颜色与尺寸。

## 四、运行时契约

- 持久化键：
  - `worldsea_ui_style`：预设 id；
  - `worldsea_ui_style_axes`：四维覆盖 JSON，缺省键 = 跟随预设；
  - `worldsea_ui_style_perf`：性能模式 `'1' | '0'`。
- 启动顺序：`theme.css` → `web-tokens-bridge.css` → `style-kit/styles.css` → `motion-kit/presets.css`；随后 `applyPersistedStyle()` 再挂载应用。
- 防闪：`apps/tauri/workspace/index.html` 内联脚本先写 `data-style`，四维覆盖在启动后应用。
- 四维覆盖以行内变量写在 `<html>` 上，优先级高于预设，重置时由 `useStyle` 重新写回预设值。

## 五、新增一套风格

1. 在 `packs.ts` 增加 `StyleId` 与注册项（含四维默认值）。
2. 新建 `presets/<id>.css`，覆盖 `REQUIRED_VARS` 全集，明暗各一组。
3. 在 `styles.css` 增加 `@import`（排在 `perf.css` 之前）。
4. 若风格需要专属 DOM 层（如液化玻璃的设置弹层），把层结构放在对应组件的样式里，由 `useStyle().styleId` 条件渲染；令牌仍放本包。
5. 跑 `packages/style-kit` 契约测试与 `npm run style:check`。
6. 外观面板与 ThemeEditor 自动出现新预设，无需改 UI。

## 六、踩坑记录

- **循环变量**：最初想让风格包引用 `--bg-app` 再反向重指向，会形成循环；改为风格包直接给中性色原值。
- **桥接层半径自引用**：`web-tokens-bridge.css` 曾写 `--radius-sm: var(--radius-sm)`，自引用使令牌失效、`border-radius` 实测渲染为 0px；已移除两组自引用。改动风格相关圆角前，先用浏览器探针确认 `--radius-sm` 的解析值。
- **TuiButton 按压**：`--press-scale` 是旧全局令牌，风格化后改用 `--sf-press-scale`，并保留旧值作 fallback。
- **Tooltip 反色面**：全局 tooltip 是「深底浅字」的反色面，不能直接套 `--sf-overlay-bg`，否则浅色主题下文字与底色同明度；只接入阴影角色。
- **backdrop root**：玻璃容器加 `isolation: isolate`、祖先加 `filter`/`contrast()` 都会创建 backdrop root，嵌套的 `backdrop-filter` 只会采样到同层内容，中心变重模糊。液化玻璃必须去掉这些属性，并用 `mask-composite` 把边带层裁成环，避免半透明本体让重模糊透上来。
