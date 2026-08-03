<script lang="ts">
/**
 * re-export 兼容层 — 实际实现已迁移到 @worldsmith/ui-kit/components/settings/panels/CompanionPanel.vue
 * Phase 4: @agent/providers 业务代码下沉（陪伴模式面板迁移到 ui-kit）
 *
 * 依赖来源：
 * - useSettingsStore: @worldsmith/entity-core
 * - getModelsByProvider/getDefaultModelId/MODEL_REGISTRY/getProviderLabelMap: @worldsmith/agent-runtime
 *   （原 @agent/providers/provider-registry + agent/modelRegistry 已统一收敛至 agent-runtime）
 * - WsIcon: @worldsmith/ui-kit
 * - matchKeywords/SCENE_PROB_ITEMS/CompanionProviderEntry: @worldsmith/ui-kit (settings/utils)
 *
 * 注意：使用 `import X; export default X` 而非 `export { default } from`，
 * 后者会触发 vue-tsc TS2528（SFC 隐式默认导出与 re-export 冲突）。
 */
import Actual from '@worldsmith/ui-kit/components/settings/panels/CompanionPanel.vue'
export default Actual
</script>
