<script lang="ts">
/**
 * re-export 兼容层 — 实际实现已迁移到 @worldsmith/ui-kit/components/data/ImportExportModal.vue
 * Phase 8d-3: 导入导出模态框迁移到 ui-kit
 *
 * 依赖来源：
 * - useEntityStore/useRelationStore/usePluginStore/useCustomModuleStore/fieldRegistry: @worldsmith/entity-core
 * - getExportController/getImportController/serializerRegistry: @worldsmith/entity-core（io 模块下沉）
 * - useAutoBackup: @worldsmith/entity-core（composables 下沉）
 * - useResizable: @worldsmith/ui-kit
 * - WsIcon: @worldsmith/ui-kit（同包内）
 */
import Actual from '@worldsmith/ui-kit/components/data/ImportExportModal.vue'
export default Actual
</script>
