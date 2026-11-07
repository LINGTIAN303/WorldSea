/**
 * outline 芽的服务取值器。
 *
 * 与 notebook / custom / theme-editor / mindmap 同一模式：经 `world.*` 服务取数/取配置
 * （唯一通道，换来源只改 `services.ts`），收敛成单份避免每文件重复。取不到属时序被
 * 破坏的编程错误（服务在起树时登记，视图由树的注册表驱动挂载），故报错而非静默降级。
 */
import { getWorldService } from '../../service-registry'
import type { WorldFontService } from '../../services'

export function fontSvc(): WorldFontService {
  const svc = getWorldService<WorldFontService>('world.font')
  if (!svc) throw new Error('[outline] world.font 服务未就绪（视图渲染早于起树）')
  return svc
}
