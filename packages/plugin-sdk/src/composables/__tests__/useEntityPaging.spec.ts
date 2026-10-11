import { describe, it, expect } from 'vitest'
import { computed, nextTick, ref } from 'vue'
import { useEntityPaging } from '../useEntityPaging'

const nums = (n: number) => Array.from({ length: n }, (_, i) => i)

// 2026-10-01 分页口径下沉：GEV 与自有列表（时间线时序表）共用，切片/收敛/重置三件事锁在此处
describe('useEntityPaging 分页口径', () => {
  it('切片：totalPages 与当前页内容随 page 变化', () => {
    const source = ref(nums(5))
    const { totalPages, pagedList, pageNext } = useEntityPaging(source, 2)

    expect(totalPages.value).toBe(3)
    expect(pagedList.value).toEqual([0, 1])

    pageNext()
    expect(pagedList.value).toEqual([2, 3])
    pageNext()
    expect(pagedList.value).toEqual([4])
  })

  it('边界：首页不能往前、末页不能往后', () => {
    const source = ref(nums(3))
    const { page, pagePrev, pageNext } = useEntityPaging(source, 2)

    pagePrev()
    expect(page.value).toBe(1)
    pageNext()
    pageNext()
    expect(page.value).toBe(2)
  })

  it('源列表缩短 → 当前页收敛到末页（不停在空页）', async () => {
    const source = ref(nums(6))
    const { page, pageNext } = useEntityPaging(source, 2)
    pageNext()
    pageNext()
    expect(page.value).toBe(3)

    source.value = nums(2)
    await nextTick()
    expect(page.value).toBe(1)
  })

  it('resetPage 回第 1 页（搜索/过滤条件变化时调用）', () => {
    const source = ref(nums(9))
    const { page, pageNext, resetPage } = useEntityPaging(source, 3)
    pageNext()
    pageNext()
    expect(page.value).toBe(3)

    resetPage()
    expect(page.value).toBe(1)
  })

  it('pageSize 可传 getter，改值后页数与切片同步', () => {
    const source = computed(() => nums(10))
    const size = ref(5)
    const { totalPages, pagedList } = useEntityPaging(source, () => size.value)

    expect(totalPages.value).toBe(2)
    expect(pagedList.value).toHaveLength(5)

    size.value = 4
    expect(totalPages.value).toBe(3)
    expect(pagedList.value).toEqual([0, 1, 2, 3])
  })

  it('空源：totalPages 兜底为 1（分页器据 totalPages > 1 判定是否出现）', () => {
    const source = ref<number[]>([])
    const { totalPages, pagedList } = useEntityPaging(source, 100)
    expect(totalPages.value).toBe(1)
    expect(pagedList.value).toEqual([])
  })
})
