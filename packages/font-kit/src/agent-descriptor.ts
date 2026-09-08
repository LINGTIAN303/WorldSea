import type { LibraryDescriptor, CapabilityDeclaration } from '@agent/toolbus/capability-types'
import type { ToolParameter } from '@agent/bridge-types'

const FONT_AVAILABILITY: { platforms: ('web' | 'tauri')[]; chain: ('internal')[]; requiresUI: boolean } = {
  platforms: ['web', 'tauri'],
  chain: ['internal'],
  requiresUI: true,
}

export const fontKitDescriptor: LibraryDescriptor = {
  id: '@worldsea/font-kit',
  name: 'Font Kit',
  version: '0.1.0',
  capabilities: [
    {
      id: 'font.render-text',
      name: 'Render Text to Image',
      description: '将文本渲染为图片。支持自定义字体、字号、字重、颜色、背景色等。使用场景：字体预览、文本图片导出、字帖生成等。',
      category: 'render',
      parameters: {
        text: { type: 'string', description: '要渲染的文本内容', required: true } satisfies ToolParameter,
        fontFamily: { type: 'string', description: '字体族名称，如 "Inter"、"Noto Serif SC"', required: false } satisfies ToolParameter,
        fontSize: { type: 'number', description: '字号(px)，默认 14', required: false } satisfies ToolParameter,
        fontWeight: { type: 'number', description: '字重(100-900)，默认 400', required: false } satisfies ToolParameter,
        color: { type: 'string', description: '文字颜色，如 "#000000"、"rgba(0,0,0,1)"', required: false } satisfies ToolParameter,
        backgroundColor: { type: 'string', description: '背景颜色，如 "#ffffff"、"transparent"', required: false } satisfies ToolParameter,
        format: { type: 'string', description: '导出格式: "png"/"jpeg"/"webp"，默认 "png"', required: false, enum: ['png', 'jpeg', 'webp'] } satisfies ToolParameter,
      } satisfies Record<string, ToolParameter>,
      availability: FONT_AVAILABILITY,
      execute: async (args, _ctx) => {
        const { renderText, toBlob } = await import('./FontRenderer')
        try {
          const result = renderText({
            text: String(args.text),
            fontFamily: args.fontFamily as string | undefined,
            fontSize: args.fontSize as number | undefined,
            fontWeight: args.fontWeight as number | undefined,
            color: args.color as string | undefined,
            backgroundColor: args.backgroundColor as string | undefined,
          })
          const blob = await toBlob(result.canvas, (args.format as any) ?? 'png')
          return JSON.stringify({ ok: true, width: result.width, height: result.height, blobSize: blob.size })
        } catch (err) {
          return JSON.stringify({ ok: false, error: String(err) })
        }
      },
    } satisfies CapabilityDeclaration,
    {
      id: 'font.load',
      name: 'Load Font',
      description: '加载自定义字体到页面。支持从 URL 加载字体文件，加载后可在渲染和页面样式中使用。使用场景：加载用户上传的字体、加载远程字体包等。',
      category: 'render',
      parameters: {
        id: { type: 'string', description: '字体唯一标识符', required: true } satisfies ToolParameter,
        family: { type: 'string', description: '字体族名称，如 "MyCustomFont"', required: true } satisfies ToolParameter,
        url: { type: 'string', description: '字体文件 URL', required: true } satisfies ToolParameter,
        weight: { type: 'number', description: '字重(100-900)，默认 400', required: false } satisfies ToolParameter,
        style: { type: 'string', description: '字体样式: "normal"/"italic"，默认 "normal"', required: false } satisfies ToolParameter,
      } satisfies Record<string, ToolParameter>,
      availability: FONT_AVAILABILITY,
      execute: async (args, _ctx) => {
        const { register } = await import('./FontRegistry')
        const { loadFont } = await import('./FontLoader')
        try {
          register({
            id: String(args.id),
            family: String(args.family),
            weight: (args.weight as number) ?? 400,
            style: (args.style as string) ?? 'normal',
            source: { type: 'url', url: String(args.url) },
          })
          const entry = await loadFont(String(args.id))
          return JSON.stringify({ ok: true, id: entry.id, family: entry.family, status: entry.status })
        } catch (err) {
          return JSON.stringify({ ok: false, error: String(err) })
        }
      },
    } satisfies CapabilityDeclaration,
  ],
}
