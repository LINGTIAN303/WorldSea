/**
 * 社区划分与 Hull 轮廓。孤立星座本身就是按类型的社区，只为核心节点画轮廓。
 */
import { computed, ref, type Ref } from 'vue'
import { detectCommunities } from '../model/community'
import { communityColors } from '../policy/communityStyle'
import type { HullSpec } from '../view/GraphCanvas.vue'
import type { Overview } from '../model/types'

export function useGraphCommunities(options: {
  overview: Ref<Overview>
  canvasRef: Ref<{ setHulls(specs: HullSpec[]): Promise<void> } | null>
  themeMode: Ref<'dark' | 'theme'>
  loaded: Ref<boolean>
  typeLabel: (type: string) => string
}) {
  const communities = computed(() =>
    detectCommunities(options.overview.value).map(community => ({
      ...community,
      label: community.dominantType
        ? `${community.label} · ${options.typeLabel(community.dominantType)}`
        : community.label,
    })),
  )
  const communityCount = computed(() => communities.value.filter(community => community.size >= 3).length)
  const showCommunities = ref(false)

  async function syncHulls(): Promise<void> {
    if (!options.loaded.value) return
    if (!showCommunities.value) {
      await options.canvasRef.value?.setHulls([])
      return
    }
    const specs = communities.value
      .filter(community => community.size >= 3)
      .map((community, index) => {
        const colors = communityColors(index, options.themeMode.value)
        return {
          key: `hull:${community.id}`,
          members: community.nodeIds,
          fill: colors.fill,
          stroke: colors.stroke,
          label: community.label,
        }
      })
    await options.canvasRef.value?.setHulls(specs)
  }

  async function toggleCommunities(): Promise<void> {
    showCommunities.value = !showCommunities.value
    await syncHulls()
  }

  return { communities, communityCount, showCommunities, syncHulls, toggleCommunities }
}
