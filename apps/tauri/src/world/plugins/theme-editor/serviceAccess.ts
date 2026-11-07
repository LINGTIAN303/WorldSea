/**
 * theme-editor 芽的服务取值器。
 *
 * 与 notebook 同一模式：本插件多个文件经 `world.*` 服务取数（唯一取数通道，换数据源
 * 只改 `services.ts`），收敛成单份避免每文件重复。取不到属时序被破坏的编程错误
 * （服务在起树时登记，视图由树的注册表驱动挂载），故报错而非静默降级。
 */
import { getWorldService } from '../../service-registry'
import type { WorldUiService } from '../../services'

export function uiSvc(): WorldUiService {
  const svc = getWorldService<WorldUiService>('world.ui')
  if (!svc) throw new Error('[theme-editor] world.ui 服务未就绪（视图渲染早于起树）')
  return svc
}
