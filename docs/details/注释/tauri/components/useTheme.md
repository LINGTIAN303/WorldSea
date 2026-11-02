# useTheme 注释

## 职责
Tauri 端主题管理。模块级单例：读取偏好、应用到 `<html data-theme>`、持久化。

> 2026-09-13 主题收束：主题模型 = **底色 × 强调色 两轴**。本文件只承载「底色」轴（data-theme 三态）；「强调色」轴落在 entity-core `useTheme`（`ACCENT_PRESETS` + `setAccent`，深浅双段规则注入 `<style id="ws-accent-override">`）。原六个预设主题（极光深渊/明亮/锻造炉/水墨卷轴/晶体棱镜/宇宙）退役，旧 id 经 `THEME_ID_MIGRATIONS` 自动迁移为强调色 id。theme-kit 风格包（纹理/图标风格/动效覆盖引擎）**已删除**（真机确认后清理；取证：`--texture-*`、`data-interaction-mode`、`--ease-enter` 等全仓零消费点，从未真实生效），`@worldsea/theme-kit` 仅剩退役说明骨架；WsIcon 的主题图标覆盖分支一并移除（行为等价，该分支退役后恒为空）。

## 设计决策
- **令牌覆盖驱动**：深色不是每个组件各自处理，而是在 `theme.css` 的 `[data-theme="dark"]` 块覆盖全部 CSS 变量——所有组件经 `var()` 引用，切主题即全端生效，零组件改动。
- **三态偏好**：`light | dark | system`（批次99 使 system 可达）。localStorage 已保存值 > 系统偏好 > 默认跟随系统。手动切换后写 localStorage；system 态由 `matchMedia` 监听实时联动。
- **data-theme 唯一控制源**：底色只能经本模块 `setMode` / `followSystem` / `toggle` 落地；命名主题 id 写 `data-theme` 会让 theme.css 的 light/dark 覆盖失效（历史坑）。
- **强调色不写内联单值**：内联样式无法按 `[data-theme]` 分支深浅两套值 → entity-core `setAccent` 改注入 style 标签双段规则；派生令牌（hover/soft/soft-border/grad-to/ring/on-accent）用 `color-mix` 随主值自动跟随。默认「靛蓝」不注入（theme.css 基准即靛蓝）。
- **切换协议**：面板/编辑器派发 `ws-set-theme` 事件，detail = `{ mode?: 'light'|'dark'|'system', accent?: id }`，由 App.vue 统一落地（底色 → 本模块，强调色 → entity-core `setAccent`）。三态变化经 `ws-theme-mode-changed` 事件广播回面板（同页无 storage 事件）。
- **壳广播单向应用**：`worldsea:theme-changed` 只应用不回写壳（回写会形成「壳→产品→壳」回声）；只有用户主动切换才经 `__WORLDSEA_SET_THEME__` 写壳。壳侧对同值写入幂等，并在 dsh 对齐期间用写入代数/在途标志阻止 `adopt_from_dsh` 覆盖新真源。
- **初始应用时机**：`useTheme` 模块顶层只计算 `theme` ref；实际写 `html[data-theme]` 在 App.vue `onMounted` 调 `apply()`（避免模块加载时 DOM 未就绪）。强调色与用户令牌覆盖（圆角/密度）由 App.vue `onMounted` 调 entity-core `restorePersistedTheme()` 恢复——修复此前重启后强调色/覆盖丢失、观感回退裸基准的问题。

## 约束
- 新样式一律用令牌变量；新增色值时同步补浅色 + 深色两处。
- 勿在组件内硬编码色值（除品牌渐变等特殊场景）。
- 强调色系令牌（`--accent` 及派生）勿再写入 `userOverrides` 内联覆盖（`setAccent` 会清除它们；手动覆盖走主题编辑器「专业」页并理解其优先级高于预设）。
