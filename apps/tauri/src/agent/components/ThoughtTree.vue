<template>
  <div class="ttree">
    <div v-for="(node, i) in roots" :key="node.id" class="ttree-root">
      <Branch :node="node" :last="i === roots.length - 1" :is-root="true" />
    </div>
  </div>
</template>

<script lang="ts">
/**
 * ThoughtTree：ToT/GoT 思维树递归可视化（父子连线 + 分支展开/折叠 + 评分着色）。
 * 由 OrchestratorPanel 传入 treeRoots（按 parentId 构建）；流式节点实时追加。
 * 折线连线：非根节点左侧 18px 槽位绘制竖线延续 + 横线接入，清晰表达父子层级。
 * 评分着色：≥70 绿 / 40-69 黄 / <40 红（无评分中性）。
 *
 * 递归实现：Options API 组件 + 自身注册为子组件（Branch），避免 script setup 自引用限制。
 */
import { defineComponent, h, type PropType } from 'vue'

export interface ThoughtTreeNode {
  id: string
  parentId: string | null
  depth: number
  text: string
  score?: number
  children: ThoughtTreeNode[]
}

const Branch = defineComponent({
  name: 'ThoughtTreeBranch',
  props: {
    node: { type: Object as PropType<ThoughtTreeNode>, required: true },
    last: { type: Boolean, default: false },
    isRoot: { type: Boolean, default: false },
  },
  data() {
    return { collapsed: false }
  },
  computed: {
    hasChildren(): boolean {
      return this.node.children.length > 0
    },
    scoreClass(): string {
      const s = this.node.score
      if (s === undefined) return ''
      if (s >= 70) return 'sc-high'
      if (s >= 40) return 'sc-mid'
      return 'sc-low'
    },
  },
  methods: {
    toggle(): void {
      this.collapsed = !this.collapsed
    },
  },
  render() {
    const node = this.node
    return h('div', { class: ['ttree-branch', { 'is-root': this.isRoot }] }, [
      h('div', { class: 'ttree-row' }, [
        h('span', {
          class: 'ttree-guide',
          'data-last': this.last ? '1' : '0',
          style: { marginLeft: `${Math.max(0, node.depth - 1) * 18}px` },
        }),
        h('span', { class: 'ttree-toggle' }, [
          this.hasChildren
            ? h(
                'button',
                {
                  class: 'ttree-fold',
                  title: this.collapsed ? '展开分支' : '折叠分支',
                  'aria-expanded': String(!this.collapsed),
                  onClick: this.toggle,
                },
                this.collapsed ? '+' : '−',
              )
            : h('span', { class: 'ttree-dot' }),
        ]),
        h('span', { class: ['ttree-node', this.scoreClass] }, [
          h('span', { class: 'ttree-depth' }, `L${node.depth}`),
          h('span', { class: 'ttree-text', title: node.text }, node.text),
          node.score !== undefined ? h('span', { class: 'ttree-score' }, `${node.score}/100`) : null,
        ]),
      ]),
      !this.collapsed && node.children.length
        ? h(
            'div',
            { class: 'ttree-children' },
            node.children.map((c, i) =>
              h(Branch, {
                node: c,
                last: i === node.children.length - 1,
                isRoot: false,
                key: c.id,
              }),
            ),
          )
        : null,
    ])
  },
})

export default defineComponent({
  name: 'ThoughtTree',
  components: { Branch },
  props: {
    roots: { type: Array as PropType<ThoughtTreeNode[]>, required: true },
  },
})
</script>

<style scoped>
.ttree { display: flex; flex-direction: column; gap: 2px; }
.ttree-root { margin-bottom: 2px; }
.ttree-row { display: flex; align-items: flex-start; }
/* 连线槽位：竖线（延续）+ 横线（分支） */
.ttree-guide {
  flex-shrink: 0;
  width: 18px;
  height: 22px;
  position: relative;
}
.ttree-guide::before {
  /* 竖线：垂直延续（非末项有子，末项无） */
  content: '';
  position: absolute;
  left: 50%;
  top: 0;
  bottom: 0;
  width: 1px;
  background: var(--border);
}
.ttree-guide[data-last='1']::before { display: none; }
.ttree-guide::after {
  /* 横线：从竖线向右接入节点 */
  content: '';
  position: absolute;
  left: 50%;
  top: 11px;
  width: 9px;
  height: 1px;
  background: var(--border);
}
.ttree-toggle { flex-shrink: 0; width: 18px; display: inline-flex; align-items: center; justify-content: center; margin-top: 3px; }
.ttree-fold {
  width: 16px; height: 16px;
  display: inline-flex; align-items: center; justify-content: center;
  border: 1px solid var(--border-strong); border-radius: 4px;
  background: var(--bg-surface); color: var(--text-muted);
  font-size: var(--fs-sm); line-height: 1; cursor: pointer;
  transition: color 0.15s, border-color 0.15s;
}
.ttree-fold:hover { color: var(--accent); border-color: var(--accent); }
.ttree-fold:focus-visible { outline: none; border-color: var(--accent); box-shadow: 0 0 0 2px var(--accent-soft); }
.ttree-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--border-strong); }
.ttree-node {
  flex: 1; min-width: 0;
  display: flex; align-items: baseline; gap: 6px;
  padding: 4px 8px; border-radius: var(--radius-sm);
  background: var(--bg-surface); border: 1px solid var(--border);
}
.ttree-depth { flex-shrink: 0; font-family: var(--font-mono); font-size: var(--fs-2xs); color: var(--text-muted); }
.ttree-text { flex: 1; min-width: 0; font-size: var(--fs-xs); color: var(--text-secondary); line-height: 1.4; overflow: hidden; text-overflow: ellipsis; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
.ttree-score { flex-shrink: 0; font-size: var(--fs-xs); font-weight: 600; font-variant-numeric: tabular-nums; }
/* 评分着色 */
.ttree-node.sc-high .ttree-score { color: var(--success, #2ea043); }
.ttree-node.sc-mid .ttree-score { color: var(--warning, #c49633); }
.ttree-node.sc-low .ttree-score { color: var(--danger, #e5484d); }
.ttree-children { margin-top: 1px; }
</style>