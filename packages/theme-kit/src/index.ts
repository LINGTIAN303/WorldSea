/**
 * @worldsea/theme-kit —— 已退役（2026-09-13 主题收束，c3e7a3e 起）
 *
 * 主题模型收束为「底色 × 强调色」两轴：
 * - 底色：App 壳三态 data-theme（apps/tauri/src/components/ui/useTheme.ts + theme.css）
 * - 强调色：entity-core useTheme 的 ACCENT_PRESETS + setAccent（深浅双段规则注入）
 *
 * 本包原承载的「预设主题风格包」（manifests ×6 / 纹理引擎 / 图标风格引擎 / 动效覆盖引擎
 * / Manifest 注册表）已删除。取证依据：--texture-*、data-interaction-mode、
 * --ease-enter/--duration-enter/--motion-scale 等在全仓库零消费点，从未真实生效；
 * 形态令牌（圆角/边框/阴影）能力由用户令牌覆盖（主题编辑器）与 theme.css 承载。
 *
 * 包骨架保留：workspace alias（vite/vitest.config）与历史提交引用包路径，避免一次性
 * 大规模移除；如未来需要重建主题风格体系，以 git 历史为准恢复。
 */
export {}
