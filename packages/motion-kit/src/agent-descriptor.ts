import type { LibraryDescriptor, CapabilityDeclaration, AvailabilitySpec } from '@agent/toolbus/capability-types'
import type { ToolParameter } from '@agent/bridge-types'

const MOTION_AVAILABILITY: AvailabilitySpec = {
  platforms: ['web', 'tauri'],
  chain: ['internal'],
  requiresUI: true,
}

export const motionKitDescriptor: LibraryDescriptor = {
  id: '@worldsmith/motion-kit',
  name: 'Motion Kit',
  version: '0.1.0',
  capabilities: [
    {
      id: 'motion.animate',
      name: 'Animate Element',
      description: '对页面元素执行动画效果。支持淡入淡出、滑动、缩放、弹跳等预设动画，也支持自定义关键帧动画。使用场景：消息入场动画、面板展开/折叠、元素状态变化过渡、交错入场等。',
      category: 'animation',
      parameters: {
        selector: { type: 'string', description: 'CSS 选择器，指定要动画的元素', required: true } satisfies ToolParameter,
        effect: {
          type: 'string',
          description: '动画效果: "fadeIn"/"fadeOut"/"slideUp"/"slideDown"/"slideRight"/"slideLeft"/"scaleIn"/"scaleOut"/"bounce"/"pulse"/"shake"',
          required: true,
          enum: ['fadeIn', 'fadeOut', 'slideUp', 'slideDown', 'slideRight', 'slideLeft', 'scaleIn', 'scaleOut', 'bounce', 'pulse', 'shake'],
        } satisfies ToolParameter,
        duration: { type: 'string', description: '动画时长令牌: "instant"/"fast"/"normal"/"slow"/"slower"，默认 "normal"', required: false } satisfies ToolParameter,
        easing: { type: 'string', description: '缓动函数: "default"/"in"/"out"/"spring"/"bounce"，默认 "out"', required: false } satisfies ToolParameter,
        stagger: { type: 'number', description: '交错延迟(ms)，用于多个元素的交错入场，默认 0', required: false } satisfies ToolParameter,
      } satisfies Record<string, ToolParameter>,
      availability: MOTION_AVAILABILITY,
      execute: async (args, _ctx) => {
        const selector = String(args.selector)
        const effect = String(args.effect)
        const elements = document.querySelectorAll(selector)
        if (elements.length === 0) {
          return JSON.stringify({ ok: false, error: `No elements found for selector: ${selector}` })
        }
        const detail = { elements: Array.from(elements), effect, duration: args.duration, easing: args.easing, stagger: args.stagger }
        window.dispatchEvent(new CustomEvent('ws-motion-animate', { detail }))
        return JSON.stringify({ ok: true, elementCount: elements.length, effect })
      },
    } satisfies CapabilityDeclaration,
  ],
}
