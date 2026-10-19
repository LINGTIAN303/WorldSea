import { computed, ref, type Ref } from 'vue'
import type { FieldMatrixModel, MatrixEntity, MatrixField } from '../model/types'
import { TYPE_ORDER, typeZh } from '../model/fieldMeta'

export function useFieldMatrixFilter(model: Ref<FieldMatrixModel>) {
  const query = ref('')
  const onlyRequired = ref(false)
  const onlyOwn = ref(false)
  const typeFilter = ref('')
  const normalizedQuery = computed(() => query.value.trim().toLowerCase())
  const isFiltering = computed(() => Boolean(
    normalizedQuery.value || onlyRequired.value || onlyOwn.value || typeFilter.value,
  ))

  function matchesContext(
    context: Pick<MatrixEntity, 'label' | 'type' | 'pluginId'>,
    field: MatrixField,
  ): boolean {
    if (normalizedQuery.value) {
      const haystack = `${context.label} ${context.type} ${context.pluginId} ${field.search}`.toLowerCase()
      if (!haystack.includes(normalizedQuery.value)) return false
    }
    if (onlyRequired.value && !field.required) return false
    if (onlyOwn.value && field.sourceKind !== 'own' && field.sourceKind !== 'replace') return false
    if (typeFilter.value && field.fieldType !== typeFilter.value) return false
    return true
  }

  function matches(entity: MatrixEntity, field: MatrixField): boolean {
    return matchesContext(entity, field)
  }

  const typeOptions = computed(() => {
    const types = new Set<string>()
    for (const entity of model.value.entities) {
      for (const field of entity.fields) types.add(field.fieldType)
    }
    for (const facet of model.value.facets) {
      for (const field of facet.fields) types.add(field.fieldType)
    }
    return [...types]
      .sort((left, right) => {
        const leftIndex = TYPE_ORDER.indexOf(left)
        const rightIndex = TYPE_ORDER.indexOf(right)
        return (leftIndex < 0 ? 999 : leftIndex) - (rightIndex < 0 ? 999 : rightIndex) || left.localeCompare(right)
      })
      .map(type => ({ value: type, label: `${type}（${typeZh(type)}）` }))
  })

  function clearFilters() {
    query.value = ''
    onlyRequired.value = false
    onlyOwn.value = false
    typeFilter.value = ''
  }

  return {
    query,
    onlyRequired,
    onlyOwn,
    typeFilter,
    normalizedQuery,
    isFiltering,
    matches,
    matchesContext,
    typeOptions,
    clearFilters,
  }
}
