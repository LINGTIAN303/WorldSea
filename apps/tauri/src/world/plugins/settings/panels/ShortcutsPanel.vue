<script lang="ts">
/**
 * re-export 兼容层 — 实际实现已迁移到 @worldsea/ui-kit/components/settings/panels/ShortcutsPanel.vue
 * Phase 8d: 设置面板迁移到 ui-kit
 *
 * 依赖来源：
 * - useSettingsStore: @worldsea/entity-core
 * - useShortcuts/formatKeyForDisplay: @worldsea/ui-kit
 * - matchKeywords/DEFAULT_SHORTCUTS/SCOPE_ORDER/scopeLabel/ShortcutItem: @worldsea/ui-kit (settings/utils)
 */
import Actual from '@worldsea/ui-kit/components/settings/panels/ShortcutsPanel.vue'
export default Actual
</script>
