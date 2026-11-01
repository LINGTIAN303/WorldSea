/**
 * FilePickerApi —— 自绘文件选择器的注入接口（entity-core 定义、apps 实现、启动时注册）。
 *
 * 为什么不直接 import plugin-dialog：调用点分散在 entity-core / plugin-sdk / ui-kit / apps，
 * 而 entity-core 在架构门禁里不允许依赖 ui-kit，packages 也不允许依赖 apps。
 * 接口下沉到 entity-core 后，三层调用方都能用同一入口，UI 实现只在 apps 注册一次。
 *
 * 未注册（浏览器预览 / 单测 / 非 Tauri）返回 null —— 与 ioServices 的 noop 口径一致，
 * 不用 ProjectSwitcherApi 的「null + 消费方抛错」（那条链因启动未注册而长期不可达）。
 *
 * 详细 why 见 docs/details/注释/packages/entity-core/core/FilePickerApi.md
 */

/** 扩展名过滤器（与 plugin-dialog 的 filter 结构对齐，便于原生兜底一一映射） */
export interface FilePickerFilter {
  /** 展示名（如「静态图片」） */
  name: string
  /** 不含点的扩展名列表（如 ['png', 'jpg']） */
  extensions: string[]
}

/** 一次选择请求 */
export interface FilePickerRequest {
  /** 选文件还是选目录 */
  mode: 'file' | 'directory'
  /** 是否多选（目录模式忽略） */
  multiple?: boolean
  /** 扩展名过滤器（多组按「切换过滤器」理解；文件模式有效） */
  filters?: FilePickerFilter[]
  /** 面板标题 */
  title?: string
  /** 初始目录（不存在或不可读时选择器回落到快捷位置） */
  defaultPath?: string | null
  /** 单文件大小上限（字节）：超限条目置灰并给行内原因，选中前就拦住 */
  maxBytes?: number
}

/** 文件选择器能力（实现方负责 UI；取消与未注册都返回 null） */
export interface FilePickerApi {
  /** 弹出选择器；返回绝对路径列表（恒正斜杠），用户取消返回 null */
  pick(req: FilePickerRequest): Promise<string[] | null>
}

/** 未注册时的空实现：静默取消，不抛错 */
const nullPicker: FilePickerApi = {
  async pick() {
    return null
  },
}

let _filePickerApi: FilePickerApi | null = null

/** 注册实现（apps 启动链调用；后注册覆盖先注册） */
export function registerFilePickerApi(api: FilePickerApi): void {
  _filePickerApi = api
}

/** 取得当前实现；未注册返回空实现（pick 恒 null） */
export function getFilePickerApi(): FilePickerApi {
  return _filePickerApi ?? nullPicker
}

/** 是否已接入自绘选择器（调用点可据此决定是否显示「用系统对话框」之外的降级提示） */
export function hasFilePicker(): boolean {
  return _filePickerApi !== null
}
