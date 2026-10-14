<script lang="ts">
/**
 * re-export 兼容层 — 实际实现已迁移到 @worldsea/ui-kit/components/settings/panels/LayoutPanel.vue
 * Phase 8d: 设置面板迁移到 ui-kit
 *
 * 依赖来源：
 * - useSettingsStore/useFieldOrderStore/fieldRegistry: @worldsea/entity-core
 * - useConfirm/getAllPanelWidths/resetPanelWidth/resetAllPanelWidths/PANEL_LABELS/toastSuccess: @worldsea/ui-kit
 * - matchKeywords: @worldsea/ui-kit (settings/utils)
 */
import Actual from '@worldsea/ui-kit/components/settings/panels/LayoutPanel.vue'
export default Actual
</script>
