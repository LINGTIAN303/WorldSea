/**
 * 详情 Tab 槽位覆盖守卫（2026-10-08，随「时间线关联页空白」缺陷反证落库）。
 *
 * 【为什么需要】`resolveDetailTabs` 恒尾内置「关联」页（PINNED），宿主视图必须给出同名
 * 内容槽——载体内容区只渲 `<slot :name="activeTab">`，无 fallback，缺槽＝点进即空白
 * （时间线事件详情正踩此型：批 A 组装单点接管后多出「关联」页，但视图只给了
 * info/cover/causal 三槽，relations 落进空分支）。GEV 的槽在组件内齐全，本守卫锁
 * apps 侧唯一的手绘槽宿主（时间线）：扫源码取 `<template #xxx` 槽名全集比对组装清单。
 * （NODE_TABS/UNIT_TABS 两个 dock 为手写单页数组、未走组装单点，天然不在守卫范围。）
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveDetailTabs } from '@worldsea/plugin-sdk'
import { DETAIL_TAB_DECLARATIONS } from '../detailTabDeclarations'

const TIMELINE_SRC = readFileSync(
  join(process.cwd(), 'apps', 'tauri', 'src', 'world', 'plugins', 'timeline', 'TimelineView.vue'),
  'utf8',
)
/** 槽名全集：正则失败会全部「缺失」→ 断言报红（失败向安全侧闭拢） */
const SLOT_NAMES = new Set([...TIMELINE_SRC.matchAll(/<template\s+#([\w-]+)/g)].map(m => m[1]))

describe('detailTabSlots / 时间线详情槽位覆盖', () => {
  it('组装清单锚点：事件详情含恒尾「关联」页（防守卫因清单搬空而恒绿）', () => {
    const tabs = resolveDetailTabs({ hasCover: true, extras: DETAIL_TAB_DECLARATIONS.event?.extras })
    expect(tabs.map(t => t.id)).toEqual(['info', 'cover', 'causal', 'relations'])
  })

  it('提供的具名槽覆盖组装单点的全部 tab（缺一即点进空白）', () => {
    const tabs = resolveDetailTabs({ hasCover: true, extras: DETAIL_TAB_DECLARATIONS.event?.extras })
    const missing = tabs.filter(t => !SLOT_NAMES.has(t.id)).map(t => t.id)
    expect(missing, `时间线缺内容槽：${missing.join('、')}`).toEqual([])
  })
})
