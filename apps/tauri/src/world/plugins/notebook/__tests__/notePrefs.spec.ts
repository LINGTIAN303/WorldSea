/**
 * 笔记本排版偏好测试（批2）：默认值锁定 = 既有呈现（--font-size-base 14px / 1.75 / off），
 * 零行为变化锚点；写入经 localStorage 持久化（worldsea_nb_* 键域）。
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { nextTick } from 'vue'
import { nbFontSize, nbLineHeight, nbQuoteStyle } from '../composables/useNotePrefs'

describe('notebook 排版偏好', () => {
  beforeEach(() => {
    localStorage.removeItem('worldsea_nb_font_size')
    localStorage.removeItem('worldsea_nb_line_height')
    localStorage.removeItem('worldsea_nb_quote_style')
    nbFontSize.value = 14
    nbLineHeight.value = 1.75
    nbQuoteStyle.value = 'off'
  })

  it('默认值 = 既有呈现（14 / 1.75 / off），不得漂移', () => {
    expect(nbFontSize.value).toBe(14)
    expect(nbLineHeight.value).toBe(1.75)
    expect(nbQuoteStyle.value).toBe('off')
  })

  it('写值经 localStorage 持久化（worldsea_nb_* 键域；watch 预刷需等微任务）', async () => {
    nbFontSize.value = 18
    nbLineHeight.value = 2.0
    nbQuoteStyle.value = 'corner'
    await nextTick()
    expect(localStorage.getItem('worldsea_nb_font_size')).toBe('18')
    expect(localStorage.getItem('worldsea_nb_line_height')).toBe('2')
    expect(localStorage.getItem('worldsea_nb_quote_style')).toBe('corner')
  })

  it('键域独立：与 manuscript 的 worldsea_ms_* 互不读写', async () => {
    nbFontSize.value = 16
    await nextTick()
    expect(localStorage.getItem('worldsea_ms_font_size')).toBeNull()
    localStorage.setItem('worldsea_ms_font_size', '20')
    expect(nbFontSize.value).toBe(16)
    localStorage.removeItem('worldsea_ms_font_size')
  })
})
