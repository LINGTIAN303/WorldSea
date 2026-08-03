import { useFontLibraryStore } from '../stores/fontLibraryStore'

export interface SetFontParams {
  family: string
  weight?: number
  style?: 'normal' | 'italic' | 'oblique'
  install?: boolean
}

export type SetFontResult =
  | { status: 'applied'; family: string; weight: number; style: string }
  | { status: 'not_found'; family: string; suggestion: string; availableFamilies: string[] }
  | { status: 'install_rejected'; family: string }
  | { status: 'install_failed'; family: string }

/** 安装确认回调，由 UI 层注入 */
let installConfirmFn: ((family: string) => Promise<boolean>) | null = null

export function setFontInstallConfirm(fn: (family: string) => Promise<boolean>) {
  installConfirmFn = fn
}

async function installFontForAgent(family: string, weight: number): Promise<boolean> {
  try {
    const { installFromWindfonts } = await import('../composables/fontInstaller')
    const { useFontLibraryStore } = await import('../stores/fontLibraryStore')
    const libraryStore = useFontLibraryStore()
    const result = await installFromWindfonts(family, String(weight))
    if (result) {
      libraryStore.addEntry(result.entry)
      return true
    }
    return false
  } catch {
    return false
  }
}

export async function executeSetFont(params: SetFontParams): Promise<SetFontResult> {
  const libraryStore = useFontLibraryStore()
  const entry = libraryStore.getEntryByFamily(params.family)

  if (entry) {
    return {
      status: 'applied',
      family: params.family,
      weight: params.weight ?? 400,
      style: params.style ?? 'normal',
    }
  }

  if (!params.install) {
    const available = libraryStore.getAllEntries().map(e => e.family)
    return {
      status: 'not_found',
      family: params.family,
      suggestion: '可设置 install: true 请求安装',
      availableFamilies: available,
    }
  }

  // 请求用户确认
  if (!installConfirmFn) {
    return { status: 'install_rejected', family: params.family }
  }

  const confirmed = await installConfirmFn(params.family)
  if (!confirmed) {
    return { status: 'install_rejected', family: params.family }
  }

  const installed = await installFontForAgent(params.family, params.weight ?? 400)
  if (installed) {
    return {
      status: 'applied',
      family: params.family,
      weight: params.weight ?? 400,
      style: params.style ?? 'normal',
    }
  }
  return { status: 'install_failed', family: params.family }
}

/** 工具定义（供 Agent 工具注册系统使用） */
export const setFontTool = {
  name: 'set_font',
  description: '设置后续输出文本的字体。从字体库中选择已安装字体，或请求安装新字体。',
  parameters: {
    type: 'object' as const,
    properties: {
      family: {
        type: 'string' as const,
        description: '字体 family 名称，优先从字体库中选择',
      },
      weight: {
        type: 'number' as const,
        description: '字体粗细，100-900，默认 400',
        default: 400,
      },
      style: {
        type: 'string' as const,
        enum: ['normal', 'italic', 'oblique'],
        description: '字体样式，默认 normal',
        default: 'normal',
      },
      install: {
        type: 'boolean' as const,
        description: '字体库中不存在时是否请求安装（需用户确认），默认 false',
        default: false,
      },
    },
    required: ['family'] as const,
  },
}
