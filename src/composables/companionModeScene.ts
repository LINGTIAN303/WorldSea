/**
 * companionModeScene — Companion Mode 场景配置（re-export）
 *
 * Phase 2：实现已下沉到 @worldsmith/shared-composables/companion/scene
 * 本文件保留向后兼容的 re-export。
 */
export {
  type TriggerMethod,
  type PopupPosition,
  type SceneConfig,
  type TriggerContext,
  SCENE_CONFIGS,
  getSceneConfig,
  getScenePosition,
  identifySceneFromEntityCreate,
  identifySceneFromEntityUpdate,
  identifySceneFromEntityDelete,
  identifySceneFromFieldChange,
  identifySceneFromRelationCreate,
  identifySceneFromRelationDelete,
  identifySceneFromViewSwitch,
  identifySceneFromNameInput,
  identifySceneFromBatchEdit,
} from '@worldsmith/shared-composables/companion/scene'
