// ============================================================================
// @worldsmith/ui-kit — Standalone UI Component Library
// ============================================================================
// This package serves as a FACADE that provides convenient access to all
// UI-related exports, delegating to the appropriate package.
// It should NOT contain business logic itself.
// ============================================================================

// ----------------------------------------------------------------------------
// Ws* Components (Pure UI Atoms) — native to ui-kit
// Currently re-exported from src/ui/; will eventually move into
// packages/ui-kit/src/components/
// ----------------------------------------------------------------------------
export { default as WsIcon } from './components/WsIcon.vue'
export { default as WsEmpty } from './components/WsEmpty.vue'

// Phase 8c: 图标注册表（从根 src/assets/iconRegistry.ts 下沉）
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

// Phase 8d: settings 模块共用工具与类型（从根 src/ui/settings/utils.ts 下沉）
export {
  matchKeywords,
  DEFAULT_SHORTCUTS,
  SCOPE_ORDER,
  scopeLabel,
  FONT_LAYERS,
  weightLabel,
  sourceLabel,
  formatSize,
  SCENE_PROB_ITEMS,
} from './components/settings/utils'
export type {
  ShortcutItem,
  FontLayerConfig,
  SceneProbItem,
  CompanionProviderEntry,
} from './components/settings/utils'

// ----------------------------------------------------------------------------
// App-Level UI Components — native to ui-kit
// Shell, layout, navigation, and application-level UI
// Currently re-exported from src/ui/; will eventually move into
// packages/ui-kit/src/components/
// ----------------------------------------------------------------------------
export { default as RichTextEditor } from './components/editor/RichTextEditor.vue'
export { default as FloatingPanel } from './components/layout/FloatingPanel.vue'
export { default as ColorPickerDialog } from './components/editor/ColorPickerDialog.vue'
export { default as InfoPanel } from './components/entity/InfoPanel.vue'
export { default as DialogContainer } from './components/layout/DialogContainer.vue'
export { default as Toast } from './components/feedback/Toast.vue'
export { default as Sidebar } from './components/layout/Sidebar.vue'
export { default as LayoutManager } from './components/layout/LayoutManager.vue'
export { default as ViewContainer } from './components/layout/ViewContainer.vue'
export { default as GlobalSearch } from './components/search/GlobalSearch.vue'
export { default as SettingsDialog } from '../../../src/ui/settings/SettingsDialog.vue'
export { default as WelcomeOverlay } from './components/layout/WelcomeOverlay.vue'
export { default as ShortcutHelpModal } from './components/settings/ShortcutHelpModal.vue'
export { default as VersionHistory } from './components/data/VersionHistory.vue'
export { default as UndoHistoryPanel } from './components/data/UndoHistoryPanel.vue'
export { default as DocExport } from './components/data/DocExport.vue'
export { default as ExportImportDialog } from './components/data/ExportImportDialog.vue'
export { default as ImportExportModal } from './components/data/ImportExportModal.vue'
export { default as RegionMap } from './components/entity/RegionMap.vue'
export { default as TemplateManager } from './components/entity/TemplateManager.vue'
export { default as CustomModuleView } from '../../../src/ui/entity/CustomModuleView.vue'
export { default as GlobalCaretIndicator } from './components/layout/GlobalCaretIndicator.vue'
export { default as GenericTreeView } from './components/entity/GenericTreeView.vue'
export type { TreeNodeData } from './components/entity/GenericTreeView.vue'
export { default as FontSelector } from './components/font/FontSelector.vue'
export { default as TextRenderPreview } from './components/font/TextRenderPreview.vue'
export { default as FontPreviewPanel } from './components/font/FontPreviewPanel.vue'
export { default as AnimatedFontExportPanel } from './components/font/AnimatedFontExportPanel.vue'

// ----------------------------------------------------------------------------
// Data Composables — delegated to @worldsmith/entity-core
// Smart field links, auto-create entities, bidirectional relations, etc.
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
} from '@worldsmith/entity-core/composables'

// ----------------------------------------------------------------------------
// Canvas Composables — delegated to @worldsmith/canvas-engine
// Canvas state, graph data, algorithms, geometry, etc.
// ----------------------------------------------------------------------------
export { useCanvas, type CanvasState } from '@worldsmith/canvas-engine/core'
export {
  useSmallCanvasGraph,
  type SGNode,
  type SGEdge,
  type SGCamera,
  type SGCallbacks,
} from '@worldsmith/canvas-engine/core'
export { useGraphData, GRAPH_NODE_THRESHOLD, type GraphNode, type GraphEdge } from '@worldsmith/canvas-engine/graph'
export { useGraphFilter, type FilterCriteria } from '@worldsmith/canvas-engine/graph'
export { graphToWeightedGraph, useGraphAlgorithms } from '@worldsmith/canvas-engine/algorithms'
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
} from '@worldsmith/canvas-engine/geometry'

// ----------------------------------------------------------------------------
// App Composables — native to ui-kit
// Toast notifications, floating panels, file system project management
// - useToast / useFloatingPanel: 已迁移至本地 ./composables/
// - useFileSystemProject: Phase 5a 已下沉到 @worldsmith/entity-core/composables
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
export { useDialog } from './composables/useDialog'
export { useConfirm, type ConfirmType } from './composables/useConfirm'
export { useSelection, SelectionKey, provideGlobalSelection, type SelectionState } from './composables/useSelection'
export {
  useShortcuts,
  formatKeysForDisplay,
  formatKeyForDisplay,
  type ShortcutScope,
  type ShortcutDef,
  type ShortcutConflict,
} from './composables/useShortcuts'
export { useFileSystemProject } from '@worldsmith/entity-core/composables'

// ----------------------------------------------------------------------------
// Phase 7 下沉的纯工具 composables（从 src/composables/ 迁入）
// 全局事件注册、文本选择监听、右键菜单状态管理
// ----------------------------------------------------------------------------
export { useGlobalEvents } from './composables/useGlobalEvents'
export {
  useTextSelection,
  type TextSelectionInfo,
} from './composables/useTextSelection'
export { useSmartFillContextMenu } from './composables/useSmartFillContextMenu'

// ----------------------------------------------------------------------------
// Motion Composables — delegated to @worldsmith/motion-kit
// Animation tokens, keyframes, transitions, reduced-motion, text layout
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
  motionKitDescriptor,
} from '@worldsmith/motion-kit'

// ----------------------------------------------------------------------------
// Font Composables — delegated to @worldsmith/font-kit
// Font tokens, registry, loader, renderer, text-to-image export
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
  fontKitDescriptor,
} from '@worldsmith/font-kit'

// ----------------------------------------------------------------------------
// Animation Capture — delegated to @worldsmith/motion-kit
// Frame capture, GIF encoding, animation capture composable
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
} from '@worldsmith/motion-kit'

// ----------------------------------------------------------------------------
// Agent Descriptor — A2UI capabilities for the internal chain registry
// ----------------------------------------------------------------------------
export { uiKitDescriptor } from './agent-descriptor'
