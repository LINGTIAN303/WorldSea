import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8')
const base = 'apps/tauri/src/world/plugins/outline/board/'

describe('白板卡片动效契约', () => {
  it('BoardCanvas 用 board-card TransitionGroup 并暴露 FLIP', () => {
    const src = read(`${base}components/BoardCanvas.vue`)
    expect(src).toContain('<TransitionGroup name="board-card">')
    expect(src).toContain('useBoardFlip')
    expect(src).toContain('capturePositions')
    expect(src).toContain('playPositionFlip')
    expect(src).toContain('cancelPositionFlip')
  })

  it('BoardContainerView 带 FLIP 定位属性与边框过渡', () => {
    const src = read(`${base}components/BoardContainerView.vue`)
    expect(src).toContain(':data-board-container-id="container.id"')
    expect(src).toContain('transition: border-color var(--dur-fast')
    expect(src).toContain('.bc:hover:not(.bc--selected):not(.bc--dangling)')
  })

  it('进出场 CSS 存在且可降级', () => {
    const css = read(`${base}board-motion.css`)
    expect(css).toContain('.board-card-enter-active')
    expect(css).toContain('.board-card-leave-active')
    expect(css).toContain("data-anim-content='off'")
    expect(css).toContain("data-reduce-motion='on'")
  })
})

describe('BoardView FLIP 接线', () => {
  const src = read(`${base}BoardView.vue`)

  it('重排前 capture、nextTick 后 play', () => {
    expect(src).toContain('function flipLayoutChange(')
    expect(src).toContain('flipLayoutChange(() => layoutApi.rearrangeSection(sectionId))')
  })

  it('撤销 / 重做前后 capture/play', () => {
    expect(src).toMatch(/async function onUndo\(\)[\s\S]*capturePositions\(\)[\s\S]*playPositionFlip\(before\)/)
    expect(src).toMatch(/async function onRedo\(\)[\s\S]*capturePositions\(\)[\s\S]*playPositionFlip\(before\)/)
  })

  it('手势开始取消 FLIP', () => {
    expect(src).toMatch(/function onInteractionStart\(\)[\s\S]*cancelPositionFlip\(\)/)
  })
})
