import { afterEach, describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import PhonePreview from '../components/PhonePreview.vue'
import { clearWorldServiceTable } from '../../../service-registry'
import { installFontServices } from './fontServices'

// 2026-10-02 手机预览右栏页升为真右栏：dock 模式经 Teleport disabled 原地渲染进
// .ms-body 布局流（编辑区让位）；popup 模式 Teleport 到 body 居中浮窗。
// 本测试锁两种模式的挂载位置契约。

function mountPreview(mode: 'dock' | 'popup') {
  const pinia = createPinia()
  setActivePinia(pinia)
  installFontServices() // 组件经 world.font / world.fontLibrary 取字号与字体清单
  return mount(PhonePreview, {
    props: { visible: true, html: '<p>正文</p>', title: '第一章', mode },
    global: { plugins: [pinia] },
    attachTo: document.body,
  })
}

afterEach(() => clearWorldServiceTable())

describe('PhonePreview 挂载位置', () => {
  it('dock 模式：原地渲染（不 Teleport），作为父容器内的真右栏列', () => {
    const w = mountPreview('dock')
    expect(w.find('.pp-layer--dock').exists()).toBe(true)
    // 真右栏契约：不在 body 直下（未传送），处于父容器布局流内
    expect(document.querySelector('body > .pp-layer--dock')).toBeNull()
    expect(w.find('.pp-dock-handle').exists()).toBe(true)
    w.unmount()
  })

  it('popup 模式：Teleport 到 body 居中浮窗', () => {
    const w = mountPreview('popup')
    expect(document.querySelector('.pp-layer--popup')).not.toBeNull()
    expect(document.body.querySelector('.pp-layer--popup')).not.toBeNull()
    w.unmount()
    document.querySelectorAll('.pp-layer--popup').forEach(el => el.remove())
  })

  it('dock 宽度持久化：拖宽后写 localStorage', () => {
    localStorage.setItem('worldsea_phone_preview_col_width', '500')
    const w = mountPreview('dock')
    const layer = w.find('.pp-layer--dock')
    expect(layer.attributes('style')).toContain('500px')
    w.unmount()
    localStorage.removeItem('worldsea_phone_preview_col_width')
  })
})
