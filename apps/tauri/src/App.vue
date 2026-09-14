<script setup lang="ts">
import { computed, onMounted, watch } from 'vue'
import Shell from './ui/layout/Shell.vue'
import AgentSpace from './space/AgentSpace.vue'
import AvatarBadge from './ui/AvatarBadge.vue'
import { provideAgentUiDeps, type ActivityLogItem, type AgentFontPrefs, type PersonaFontInfo } from '@worldsea/shared-composables/agent/deps'
import { useFontStore } from './stores/fontStore'
import { usePersonaFontStore } from './space/stores/persona-font-store'
import { useActivityLog } from './agent/composables/useActivityLog'
import { useUIStore } from './stores/uiStore'
import { useTheme } from './components/ui/useTheme'
import { useTheme as useEntityTheme, useSettingsStore } from '@worldsea/entity-core'
import { useGlobalEvents, setActiveViewId, setAgentSpaceActive, enableGlobalTooltips } from '@worldsea/ui-kit'
import { bootstrapSprouts } from './plugins/bootstrap'
import { useProjectSwitcher } from './composables/useProjectSwitcher'
import { registerProjectSwitchListener } from './agent/composables/useAgentRust'
import { useSystemBridge } from './composables/useSystemBridge'
import { installAgentDataBridges } from './agent/agentDataBridges'
import { useMcpConnections } from '@worldsea/shared-composables/agent/useMcpConnections'
import { useAgent } from './agent/composables/useAgent'
import { toastWarn } from '@/composables/useToast'
import SplashScreen from './ui/boot/SplashScreen.vue'
import GlobalEditMenu from './ui/GlobalEditMenu.vue'
import BootErrorScreen from './ui/boot/BootErrorScreen.vue'

// ── 无障碍：减弱动态效果（应用级配置） ──
// 写入根元素 data-reduce-motion，CSS 据此关闭界面动效（Agent 设置翻卡等）；
// 默认不减弱（保留动画），由「设置 → 动画效果」开关控制
const settingsStore = useSettingsStore()
watch(() => settingsStore.reduceMotion, (v) => {
  document.documentElement.dataset.reduceMotion = v ? 'on' : 'off'
}, { immediate: true })

// ── 动画效果分组开关（应用级配置） ──
// 每组合开关写入根元素 data-anim-<组>（如 data-anim-messages），CSS 据此关闭对应组件动画；
// 默认全部开启，由「设置 → 动画效果」面板逐项控制
watch(() => settingsStore.animations, (a) => {
  for (const [k, v] of Object.entries(a ?? {})) {
    document.documentElement.dataset[`anim${k[0].toUpperCase()}${k.slice(1)}`] = v ? 'on' : 'off'
  }
}, { immediate: true, deep: true })

// 主题初始化：Shell 与 AgentSpace 共用（三态；components/ui/useTheme 已内置
// 跟随系统——preference 'system' 默认态 + matchMedia 实时监听，无需额外实现）
const { theme: themeMode, apply: applyTheme, setMode, followSystem } = useTheme()
// 系统层桥：托盘事件监听 + 状态同步（App 启动时 setup，幂等）
const { setup: setupSystemBridge } = useSystemBridge()

const uiStore = useUIStore()
const projectSwitcher = useProjectSwitcher()
// entity-core 主题引擎（强调色轴）：模块加载时已完成旧主题 id → accent id 迁移
const { setAccent, restorePersistedTheme } = useEntityTheme()

// ── Agent UI 依赖注入（AgentUiDeps）────────────────────────────
// 深度模式消息气泡（DeepMessageArea / useMarkdownRender）依赖 useAgentUiDeps()，
// Tauri 端此前未注入导致「[useAgentUiDeps] 未注入 AgentUiDeps」崩溃。此处补齐。
// - fontPrefs 取 fontStore.prefs.agent（FontLayer 含 'agent'）
// - persona/enterAnimation 取 persona-font-store 当前档案
// - activityLogs 取 useActivityLog 模块级日志
// - replaceFontSpans：{font:...} 内联标记解析，先做 passthrough（后续可接 fontSpanParser 完整实现）
const fontStore = useFontStore()
const personaFontStore = usePersonaFontStore()
const { logs: activityLogsValue } = useActivityLog()

// fontFamily：Agent 层字体串（fallback 兜底）
const agentFontFamily = computed(() => {
  const family = fontStore.prefs.agent.family
  return family ? `"${family}", sans-serif` : 'sans-serif'
})

provideAgentUiDeps({
  fontFamily: agentFontFamily,
  enterAnimation: computed(() => personaFontStore.activeProfile.animationStyle.messageEnter),
  fontPrefs: computed<AgentFontPrefs>(() => {
    const { family, weight, style } = fontStore.prefs.agent
    return { family, weight, style }
  }),
  persona: computed<PersonaFontInfo>(() => {
    const p = personaFontStore.activeProfile
    return { fontFamily: p.fontFamily, sizeScale: p.sizeScale, weightDefault: p.weightDefault as string }
  }),
  activityLogs: computed<ActivityLogItem[]>(() => activityLogsValue.value as unknown as ActivityLogItem[]),
  replaceFontSpans: (text: string) => text, // {font:...} 标记暂 passthrough，后续接完整 parser
  AvatarBadge,
})

/**
 * 主题两轴统一落地（2026-09-13 收束：主题 = 底色 × 强调色；AppearancePanel 派发 ws-set-theme）。
 * App.vue 恒挂载（AgentSpace / Shell 平级切换），在此注册保证两种壳都生效。
 * - detail.mode（'light'|'dark'|'system'）→ App 壳三态（data-theme 唯一控制源；system 恢复跟随）
 * - detail.accent（强调色 id）→ entity-core setAccent（深浅双段规则注入 + 用户令牌重放）
 */
function onSetTheme(e: Event) {
  const detail = (e as CustomEvent).detail ?? {}
  try {
    if (detail.mode === 'system') {
      followSystem()
    } else if (detail.mode === 'light' || detail.mode === 'dark') {
      setMode(detail.mode)
    }
    if (typeof detail.accent === 'string' && detail.accent) {
      setAccent(detail.accent)
    }
  } catch (err) {
    console.error('[ws-set-theme] 处理失败:', err)
  }
}
const { on: onGlobalEvent } = useGlobalEvents()
onGlobalEvent('ws-set-theme', onSetTheme)

// N9 视图上下文注入：Agent 空间（currentShell==='space'）→ view 快捷键失效（setActiveViewId(null)），
// 主视图（workbench）→ 跟随当前 view。两壳 v-show 常驻，芽视图组件在 Agent 空间仍挂载，
// 不注入会导致其 view 快捷键（角色 n/delete 等）在 Agent 空间误触发。
// space 上下文（2026-09-06）：Agent 空间壳激活时 space scope 快捷键生效，workbench 下失效。
watch(
  () => [uiStore.currentShell, uiStore.currentView] as const,
  ([shell, view]) => {
    setAgentSpaceActive(shell === 'space')
    setActiveViewId(shell === 'space' ? null : view)
  },
  { immediate: true },
)

onMounted(async () => {
  // 全局 Tooltip 接管：摘除全站原生 title，统一为自定义浮层（2026-09-06 方案A）
  enableGlobalTooltips()
  // 全局拦截浏览器原生右键菜单（2026-09-06 桌面应用惯例）：事件仍正常传播，
  // 各组件自定义右键菜单（SessionSidebar/TerminalView 等）不受影响；
  // 输入元素的编辑菜单由 GlobalEditMenu 组件接管
  document.addEventListener('contextmenu', e => e.preventDefault())
  // 应用初始主题（html data-theme 由此建立；apply 为同步函数，需传入当前主题模式）
  applyTheme(themeMode.value)
  // 主题恢复第二轴：强调色规则注入 + 用户令牌覆盖重放（圆角/密度等）。
  // 收束前缺失此步——重启后 --accent 与覆盖令牌不恢复，观感回退裸基准。
  try {
    restorePersistedTheme()
  } catch (err) {
    console.error('[App] 主题恢复失败:', err)
  }
  // 项目系统初始化 + projectDir 绑定（必须在 bootstrapSprouts 之前：
  // 芽初始化 / Store loadAll 依赖 FileStorageBackend 已就绪，否则 isReady=false
  // 会降级到不可用的 TauriStorageBackend，导致 cmd_get_all_entities 等 IPC 失败）
  try {
    await projectSwitcher.initialize()
  } catch (err) {
    console.error('[App] 项目系统初始化失败:', err)
  }
  // 项目=目录（2026-09-03）：注册「项目切换 → Agent 新会话」联动（幂等单例；init 之后再监听，
  // 避免启动时无项目也触发草稿会话）
  try {
    await registerProjectSwitchListener()
  } catch (err) {
    console.warn('[App] 注册项目切换联动失败:', err)
  }
  // Agent 工作台视图已退役（2026-08-09）：能力迁入 AgentSpace 执行面板，
  // Shell 仅承载官方芽视图；默认进入 AgentSpace（currentShell 持久化）
  // 启动已迁移芽（Phase C：注册视图/实体类型）
  await bootstrapSprouts()
  // Agent→芽 数据动作全局桥（2026-09-14 架构拍板）：App 启动即注册、与视图挂载
  // 解耦——写/查动作必达 store；UI 动作仍由视图内 useAgentPluginBridge 消费。
  // 幂等；须在 bootstrapSprouts 之后（实体类型/视图注册完成）
  try {
    installAgentDataBridges()
  } catch (err) {
    console.error('[App] Agent 数据桥安装失败:', err)
  }
  // 系统层桥初始化：托盘事件监听 + 最近项目同步（异步，不阻塞启动）
  void setupSystemBridge()
  // T09②（2026-09-01）：MCP 启动自动重连失败提示——启动拉取配置+状态合并视图，
  // 已启用但未连上的连接（服务器未起/网络/鉴权）toast 提示一次，便于用户排查。
  try {
    const { ensureLoaded: ensureMcpLoaded, takeAutoReconnectFailed } = useMcpConnections({ getAgent: () => useAgent() })
    await ensureMcpLoaded()
    const failed = takeAutoReconnectFailed()
    if (failed.length > 0) {
      const names = failed.map((f) => f.name).join('、')
      toastWarn(`MCP 自动重连失败：${names}（请检查服务器是否启动或配置是否正确）`)
    }
  } catch (err) {
    console.error('[App] MCP 启动状态检测失败:', err)
  }
  // 核心启动完成 → 通知 SplashScreen 淡出（bootState: 'booting' → 'ready'）
  uiStore.markReady()
})
</script>

<template>
  <!-- 跳过导航直达主内容（WCAG 2.4.1 Bypass Blocks）：仅键盘/读屏聚焦时可见。
       两壳常驻故 id 各一，按当前壳路由到可见目标 -->
  <a :href="uiStore.currentShell === 'space' ? '#agent-space-main' : '#main-content'" class="skip-link">跳到主内容</a>
  <!-- 两壳 v-show 常驻（2026-08-10）：AgentSpace 与 Shell 均不卸载。
       视图工具条已在 ViewContainer 随流占位，其 Teleport 目标 #view-toolbar-*
       随 ViewContainer 常驻——壳切换时目标始终存在，避免同树卸载冲突。
       代价：两壳常驻内存增加（见项目记忆预估）。 -->
  <AgentSpace v-show="uiStore.currentShell === 'space'" />
  <Shell v-show="uiStore.currentShell === 'workbench'" />

  <!-- 统一输入框右键菜单（撤销/重做/剪切/复制/粘贴/删除/全选）；
       非输入元素的右键由 onMounted 的全局 contextmenu 拦截 -->
  <GlobalEditMenu />

  <!-- 启动流程：bootState 驱动 Splash（booting）/ 错误页（error）。ready 后均卸载。 -->
  <SplashScreen v-if="uiStore.bootState === 'booting'" />
  <BootErrorScreen v-if="uiStore.bootState === 'error'" />
</template>

<style>
/* App.vue 根样式：Shell 占满窗口 */
html, body, #app {
  height: 100%;
  margin: 0;
  overflow: hidden;
}

/* 跳过导航链接：默认移出屏幕，聚焦时滑入可见（WCAG 2.4.1） */
.skip-link {
  position: fixed;
  top: 0;
  left: 0;
  z-index: 10000;
  padding: 10px 16px;
  background: var(--bg-surface, #fff);
  color: var(--text-primary, #18181b);
  border: 2px solid var(--accent, #4f46e5);
  border-radius: 0 0 var(--radius-sm, 6px) 0;
  font-size: var(--fs-md, 14px);
  text-decoration: none;
  transform: translateY(-200%);
  transition: transform var(--dur-fast, 0.15s) ease;
}
.skip-link:focus,
.skip-link:focus-visible {
  transform: translateY(0);
}
</style>
