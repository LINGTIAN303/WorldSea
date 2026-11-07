/**
 * custom（自定义视窗）芽的服务取值器。
 *
 * 与 notebook / theme-editor / mindmap 同一模式：经 `world.*` 服务取数，收敛成单份。
 * 取不到属时序被破坏的编程错误，故报错而非静默降级。
 *
 * **注**：本芽是「视图容器」——它的职责就是动态渲染**其他视图的组件**，故仍需
 * `pluginStore.getView(id).component`。见 `custom` 迁移记录：组件引用不跨服务传递，
 * 这条读取留在芽内属有意保留（不是漏迁）。
 */
import { getWorldService } from '../../service-registry'
import type { WorldSettingsService, WorldUiService } from '../../services'

export function uiSvc(): WorldUiService {
  const svc = getWorldService<WorldUiService>('world.ui')
  if (!svc) throw new Error('[custom] world.ui 服务未就绪（视图渲染早于起树）')
  return svc
}

export function settingsSvc(): WorldSettingsService {
  const svc = getWorldService<WorldSettingsService>('world.settings')
  if (!svc) throw new Error('[custom] world.settings 服务未就绪（视图渲染早于起树）')
  return svc
}
