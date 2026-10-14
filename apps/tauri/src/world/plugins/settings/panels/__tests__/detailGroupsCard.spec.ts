/**
 * DetailGroupsCard「组内独立排序」行为测试（2026-10-08）。
 *
 * 锁的契约：组内字段次序＝`fieldKeys` 自身顺序（箭头调序改的就是它，随 commit 落盘）；
 * 首/末位的移动按钮禁用；「字段归属」加入组时排在组尾（可再调序）。
 */
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import DetailGroupsCard from '../DetailGroupsCard.vue'
import type { DetailGroup } from '@worldsea/plugin-sdk'

const GROUPS: DetailGroup[] = [
  { key: 'g1', label: '一组', fieldKeys: ['c', 'a'] },
  { key: 'g2', label: '二组', fieldKeys: ['b'] },
]
const FIELDS = [
  { key: 'a', label: '甲' },
  { key: 'b', label: '乙' },
  { key: 'c', label: '丙' },
]

function mountCard() {
  return mount(DetailGroupsCard, { props: { groups: GROUPS, fields: FIELDS, typeLabel: '角色' } })
}

async function commitPayload(w: ReturnType<typeof mountCard>): Promise<DetailGroup[]> {
  const btn = w.findAll('.set-btn').find(b => b.text().includes('保存'))!
  await btn.trigger('click')
  return w.emitted('commit')![0]![0] as DetailGroup[]
}

describe('DetailGroupsCard 组内独立排序', () => {
  it('组内字段按 fieldKeys 顺序渲染（不按字段表的全局顺序）', () => {
    const w = mountCard()
    const rows = w.findAll('.ds-gf-row')
    expect(rows.map(r => r.text())).toEqual(['丙', '甲', '乙'])
  })

  it('上移一格：交换并在 commit 载荷中落盘', async () => {
    const w = mountCard()
    const ups = w.findAll('.ds-gf-row .ds-btn[title="上移"]')
    await ups[1].trigger('click') // g1 的第二行（甲）上移
    const payload = await commitPayload(w)
    expect(payload[0].fieldKeys).toEqual(['a', 'c'])
  })

  it('下移一格：交换并在 commit 载荷中落盘', async () => {
    const w = mountCard()
    const downs = w.findAll('.ds-gf-row .ds-btn[title="下移"]')
    await downs[0].trigger('click') // g1 的首行（丙）下移
    const payload = await commitPayload(w)
    expect(payload[0].fieldKeys).toEqual(['a', 'c'])
  })

  it('首行禁上移、末行禁下移', () => {
    const w = mountCard()
    const ups = w.findAll('.ds-gf-row .ds-btn[title="上移"]')
    const downs = w.findAll('.ds-gf-row .ds-btn[title="下移"]')
    expect(ups[0].attributes('disabled')).toBeDefined()
    expect(downs[0].attributes('disabled')).toBeUndefined()
    expect(downs[2].attributes('disabled')).toBeDefined()
  })

  it('「字段归属」加入组时排在组尾（可再调序）', async () => {
    const w = mountCard()
    // 把 c（字段表第三行）从 g1 挪到 g2
    const selects = w.findAll('.ds-assign select')
    await selects[2].setValue('g2')
    const payload = await commitPayload(w)
    expect(payload[0].fieldKeys).toEqual(['a'])
    expect(payload[1].fieldKeys).toEqual(['b', 'c'])
  })
})
