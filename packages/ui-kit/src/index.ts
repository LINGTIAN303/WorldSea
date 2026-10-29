// ui-kit 包说明（FACADE：聚合/委托各包导出，自身不含业务逻辑），详细见 docs/details/注释/packages/ui-kit/index.md
// Ws* 组件（纯 UI 原子）— 原生于 ui-kit，见 docs/details/注释/packages/ui-kit/index.md
export { default as WsIcon } from './components/WsIcon.vue'
export { default as TuiButton } from './components/TuiButton.vue'
export { default as WsEmpty } from './components/WsEmpty.vue'
// 文件类型图标（vscode-great-icons 资产下沉——apps 文件树/tab/预览头与对话区行段两端共用）
export { default as FileIcon } from './components/FileIcon.vue'
export { fileIconDataOf } from './assets/fileIcons'

// 图标注册表（从根 src/assets/iconRegistry.ts 下沉）
export {
  getIcon,
  hasIcon,
  getAllIconNames,
  getIconsByCategory,
} from './assets/iconRegistry'
export type {
  IconDef,
  IconName,
  IconCategory,
} from './assets/iconRegistry'

// 自定义图标解析位（应用启动时注册 id → 文件 URL）
export { registerCustomIconResolver, resolveCustomIcon, hasCustomIcon } from './components/customIconResolver'
export type { CustomIconRender } from './components/customIconResolver'

// 世界观精选图标目录（图标库选择器的内容层）
export {
  ICON_CATALOG,
  ICON_DOMAIN_IDS,
  isCatalogIconAvailable,
  searchIconCatalog,
} from './assets/iconCatalog'
export type { IconCatalogEntry, IconDomain } from './assets/iconCatalog'

// 多风格内置图标包（精选生成，命名 `<packId>:<iconName>`）
export {
  ICON_PACKS,
  getIconPack,
  packIconFullName,
  parsePackIconName,
  resolvePackIcon,
  hasPackIcon,
  searchPackIcons,
} from './assets/iconPacks'
export type { IconPackDef, PackIconDef, IconPackColorMode, PackSearchEntry } from './assets/iconPacks'

// settings 模块共用工具与类型（从根 src/ui/settings/utils.ts 下沉）
export {
  matchKeywords,
  SHORTCUT_CATALOG,
  SCOPE_ORDER,
  scopeLabel,
  FONT_LAYERS,
  weightLabel,
  sourceLabel,
  formatSize,
} from './components/settings/utils'
export type {
  ShortcutItem,
  FontLayerConfig,
} from './components/settings/utils'

// App 级 UI 组件（壳层 / 布局 / 导航 / 反馈）——已原生于 ui-kit 的 components/ 目录
export { default as RichTextEditor } from './components/editor/RichTextEditor.vue'
export { default as FloatingPanel } from './components/layout/FloatingPanel.vue'
export { default as ColorPickerDialog } from './components/editor/ColorPickerDialog.vue'
export { default as DialogContainer } from './components/layout/DialogContainer.vue'
export { default as Toast } from './components/feedback/Toast.vue'
// 加载反馈（R0–R4 产品域；不涉 dsh）
export { default as WsInlineLoading } from './components/feedback/loading/WsInlineLoading.vue'
export { default as WsSkeleton } from './components/feedback/loading/WsSkeleton.vue'
export { default as WsStageRoute } from './components/feedback/loading/WsStageRoute.vue'
export { default as WsLoadingOverlay } from './components/feedback/loading/WsLoadingOverlay.vue'
export { default as WsScanRadar } from './components/feedback/loading/WsScanRadar.vue'
export { default as WsAmbientLine } from './components/feedback/loading/WsAmbientLine.vue'
export type { LoadingStage, LoadingStatus } from './components/feedback/loading/types'
export { default as Sidebar } from './components/layout/Sidebar.vue'
export { default as ViewContainer } from './components/layout/ViewContainer.vue'
export { default as ViewToolbar } from './components/layout/ViewToolbar.vue'
export { default as ViewToolbarFilter } from './components/layout/ViewToolbarFilter.vue'
export { default as GlobalSearch } from './components/search/GlobalSearch.vue'
export { default as WelcomeOverlay } from './components/layout/WelcomeOverlay.vue'
export { default as ShortcutHelpModal } from './components/settings/ShortcutHelpModal.vue'
export { default as CardDeck } from './components/settings/CardDeck.vue'
export { default as VersionHistory } from './components/data/VersionHistory.vue'
export { default as UndoHistoryPanel } from './components/data/UndoHistoryPanel.vue'
export { default as DocExport } from './components/data/DocExport.vue'
export { default as ImportExportModal } from './components/data/ImportExportModal.vue'
export { default as DataTable } from './components/data/DataTable.vue'
export type { DataTableColumn, DataTableEditPayload } from './components/data/DataTable.vue'
export { default as RegionMap } from './components/entity/RegionMap.vue'
export { default as TemplateManager } from './components/entity/TemplateManager.vue'
export { default as GlobalCaretIndicator } from './components/layout/GlobalCaretIndicator.vue'
export { default as GenericTreeView } from './components/entity/GenericTreeView.vue'
export type { TreeNodeData } from './components/entity/GenericTreeView.vue'
export { default as FontSelector } from './components/font/FontSelector.vue'
export { default as TextRenderPreview } from './components/font/TextRenderPreview.vue'
export { default as FontPreviewPanel } from './components/font/FontPreviewPanel.vue'

// ----------------------------------------------------------------------------
// 数据类 composables — 委托自 @worldsea/entity-core
// 智能字段联动、自动建实体、双向关联等
// ----------------------------------------------------------------------------
export {
  useSmartFieldLink,
  useAutoCreateEntity,
  useBidirectional,
  deduplicateEdges,
  type MergedEdge,
  useTypeMapping,
  useUndoRedo,
  isUndoing,
  setUndoHistoryProvider,
  useEntityImage,
  useBackgroundTask,
  startBackgroundTask,
  BACKGROUND_TASK_DELAY_MS,
  type BackgroundTaskHandle,
} from '@worldsea/entity-core/composables'

// ----------------------------------------------------------------------------
// 画布类 composables — 委托自 @worldsea/canvas-engine
// 画布状态、图数据、算法、几何等
// ----------------------------------------------------------------------------
export { useCanvas, type CanvasState } from '@worldsea/canvas-engine/core'
export {
  useSmallCanvasGraph,
  type SGNode,
  type SGEdge,
  type SGCamera,
  type SGCallbacks,
} from '@worldsea/canvas-engine/core'
export { useGraphData, GRAPH_NODE_THRESHOLD, type GraphNode, type GraphEdge } from '@worldsea/canvas-engine/graph'
export { useGraphFilter, type FilterCriteria } from '@worldsea/canvas-engine/graph'
export { graphToWeightedGraph, useGraphAlgorithms } from '@worldsea/canvas-engine/algorithms'
export {
  bridgePointInPolygon,
  bridgeSegmentsIntersect,
  bridgeSimplifyPoints,
  bridgeComputeMergedPolygon,
  bridgeChaikinSmooth,
  bridgeFindLinePolygonIntersections,
  bridgePolygonSplit,
  bridgePolygonAugment,
  bridgeMergePolygons,
  bridgeFindSharedEdges,
} from '@worldsea/canvas-engine/geometry'

// ----------------------------------------------------------------------------
// 应用级 composables — ui-kit 原生
// Toast 通知、浮层面板、文件系统项目管理等
// ----------------------------------------------------------------------------
export {
  toasts,
  dismiss,
  toast,
  useToast,
  toastSuccess,
  toastError,
  toastInfo,
  toastWarn,
  toastWithUndo,
  type ToastType,
} from './composables/useToast'
export {
  useAsyncTask,
  type AsyncTaskStatus,
  type UseAsyncTaskOptions,
  type UseAsyncTaskReturn,
  LOADING_DELAY_MS,
  LOADING_MIN_VISIBLE_MS,
  LOADING_SUCCESS_HOLD_MS,
} from './composables/useAsyncTask'
export {
  useFloatingPanel,
  Z_INDEX,
  type AnchorCorner,
  type FloatingPanelOptions,
} from './composables/useFloatingPanel'
export {
  useResizable,
  getAllPanelWidths,
  resetPanelWidth,
  resetAllPanelWidths,
  PANEL_LABELS,
  type ResizableOptions,
} from './composables/useResizable'
export { useViewEntering } from './composables/useViewEntering'
export { useDialog } from './composables/useDialog'
export { useCardDeck } from './composables/useCardDeck'
export { useConfirm, type ConfirmType, type ConfirmExtraAction } from './composables/useConfirm'
export {
  useAsk,
  type AskOption,
  type AskQuestion,
  type AskAnswer,
  type AskRequest,
} from './composables/useAsk'
export {
  useShortcuts,
  setActiveViewId,
  setShortcutModalActive,
  isShortcutModalActive,
  normalizeKeys,
  currentSequence,
  formatKeysForDisplay,
  formatKeyForDisplay,
  type ShortcutScope,
  type ShortcutKind,
  type ShortcutDef,
  type ShortcutConflict,
} from './composables/useShortcuts'
export { useScopedShortcuts } from './composables/useScopedShortcuts'
export { useModalShortcuts } from './composables/useModalShortcuts'
export { useFileSystemProject } from '@worldsea/entity-core/composables'

// ----------------------------------------------------------------------------
// 纯工具 composables（自根 src/composables/ 迁入）：
// 全局事件注册、文本选择监听、右键菜单状态管理
// ----------------------------------------------------------------------------
export { useGlobalEvents } from './composables/useGlobalEvents'
export {
  useTextSelection,
  type TextSelectionInfo,
} from './composables/useTextSelection'

// ----------------------------------------------------------------------------
// 动效类 composables — 委托自 @worldsea/motion-kit
// 动画 token、关键帧、过渡、减弱动效、文本排版
// ----------------------------------------------------------------------------
export {
  type DurationToken,
  type EasingToken,
  type MotionTokens,
  type SemanticMotionTokens,
  DURATION_VALUES,
  EASING_VALUES,
  CSS_VAR_DURATION,
  CSS_VAR_EASING,
  COSMIC_MOTION_TOKENS,
  cssDuration,
  cssEasing,
  msDuration,
  cssTransition,
  type KeyframeName,
  KEYFRAMES,
  injectKeyframe,
  injectKeyframes,
  injectAllKeyframes,
  getKeyframeCss,
  getAllKeyframeNames,
  type TransitionPresetName,
  type TransitionPreset,
  TRANSITION_PRESETS,
  getPreset,
  getTransitionName,
  getAllPresetNames,
  useReducedMotion,
  isReducedMotion,
  useTransition,
  useTransitionStyle,
  type UseTransitionReturn,
  useMotion,
  type MotionKeyframe,
  type MotionOptions,
  type UseMotionReturn,
  useTextLayout,
  type TextLayoutResult,
  type UseTextLayoutReturn,
} from '@worldsea/motion-kit'

// ----------------------------------------------------------------------------
// 字体类 composables — 委托自 @worldsea/font-kit
// 字体 token、注册表、加载器、渲染器、文字转图导出
// ----------------------------------------------------------------------------
export {
  type FontSizeToken,
  type FontWeightToken,
  type LineHeightToken,
  type LetterSpacingToken,
  type FontCategoryToken,
  FONT_SIZE_VALUES,
  FONT_WEIGHT_VALUES,
  LINE_HEIGHT_VALUES,
  LETTER_SPACING_VALUES,
  FONT_FAMILY_VALUES,
  CSS_VAR_FONT_SIZE,
  CSS_VAR_FONT_WEIGHT,
  CSS_VAR_LINE_HEIGHT,
  CSS_VAR_LETTER_SPACING,
  CSS_VAR_FONT_FAMILY,
  type FontTokens,
  type SemanticFontTokens,
  COSMIC_FONT_TOKENS,
  cssFontSize,
  cssFontWeight,
  cssLineHeight,
  cssLetterSpacing,
  cssFontFamily,
  pxFontSize,
  numericWeight,
  numericLineHeight,
  cssFontShorthand,
  type FontEntryStatus,
  type FontSourceUrl,
  type FontSourceBuffer,
  type FontSource,
  type FontEntry,
  type FontQuery,
  register as registerFont,
  unregister as unregisterFont,
  get as getFont,
  list as listFonts,
  findByFamily as findFontsByFamily,
  query as queryFonts,
  loadFont,
  loadFontFromDB,
  unloadFont,
  persistToDB as persistFontToDB,
  loadFromDB as loadFontFromDBStorage,
  removeFromDB as removeFontFromDB,
  listDBKeys as listFontDBKeys,
  type ImageFormat,
  type TextRenderOptions,
  type RenderResult,
  renderText,
  measureText,
  toBlob as fontToBlob,
  toDataURL as fontToDataURL,
  type TextAnimationEffect,
  type AnimatedTextOptions,
  type AnimatedTextResult,
  type AnimatedTextFrame,
  renderAnimatedText,
  useFontRegistry,
  useFontRenderer,
  type UseFontRegistryReturn,
  type UseFontRendererReturn,
  type WsFontPackInput,
  type WsFontManifest,
  type UseFontPackReturn,
  useFontPack,
  WSFONT_VERSION,
  WSFONT_MAGIC,
  WSFONT_EXTENSION,
  type WsFontVariant,
  packWsFont,
  unpackWsFont,
  readWsFontManifest,
  isWsFontFile,
  isTauriAvailable,
  scanSystemFonts,
  readFontFile as readTauriFontFile,
  type TauriSystemFontInfo,
  useSystemFonts,
  type SystemFontInfo,
  type UseSystemFontsReturn,
} from '@worldsea/font-kit'

// ----------------------------------------------------------------------------
// 动画采集 — 委托自 @worldsea/motion-kit
// 帧采集、GIF 编码、采集 composable
// ----------------------------------------------------------------------------
export {
  type GifFrame,
  type GifEncodeOptions,
  encodeGif,
  gifFrameFromCanvas,
  type CaptureFrame,
  type CaptureOptions,
  type CaptureResult,
  captureFromCanvas,
  framesToImageDataArray,
  useAnimationCapture,
  type MotionCaptureFrame,
  type MotionCaptureOptions,
  type MotionCaptureResult,
  type UseAnimationCaptureReturn,
} from '@worldsea/motion-kit'

// ----------------------------------------------------------------------------
// Global Tooltip — 浏览器原生 title 提示统一接管（全局浮层）
// ----------------------------------------------------------------------------
export { enableGlobalTooltips, disableGlobalTooltips } from './components/tooltip/globalTooltip'
