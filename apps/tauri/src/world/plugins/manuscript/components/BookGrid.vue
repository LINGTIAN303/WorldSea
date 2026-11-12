<template>
  <div class="ms-books">
    <div v-if="error" class="ms-books-error" role="alert">
      <WsEmpty title="书籍载入失败" :description="error">
        <template #action><TuiButton variant="primary" size="sm" @click="$emit('retry')">重试</TuiButton></template>
      </WsEmpty>
    </div>
    <div v-else-if="loading" class="ms-books-skeleton">
      <WsSkeleton v-for="n in 6" :key="n" variant="card" label="正在载入书籍" :aria-hidden="n > 1 || undefined" />
    </div>
    <template v-else>
      <!-- 书籍排序 = 网格拖拽（vuedraggable，sortOrder 落 book.properties）；
           draggable 原地改 props.books 数组（= 父级 computed 缓存），@end 持久化后 computed 重算对齐 -->
      <draggable
        :list="books"
        item-key="id"
        class="ms-books-grid"
        ghost-class="ms-book-ghost"
        drag-class="ms-book-drag"
        @end="onBooksReorder"
      >
        <template #item="{ element: b }">
          <article
            class="ms-book-card"
            role="button"
            tabindex="0"
            @click="$emit('open', b.id)"
            @keydown.enter.prevent="$emit('open', b.id)"
          >
            <div class="ms-book-actions">
              <button class="ms-book-act" title="编辑信息" aria-label="编辑信息" @click.stop="$emit('edit', b)"><WsIcon name="edit" size="xs" /></button>
              <button class="ms-book-act" title="删除书籍" aria-label="删除书籍" @click.stop="$emit('remove', b)"><WsIcon name="delete" size="xs" /></button>
            </div>
            <div class="ms-book-cover">
              <img v-if="bookCover(b)" :src="bookCover(b)" alt="" />
              <div v-else class="ms-book-cover-empty"><WsIcon name="book" size="lg" /></div>
            </div>
            <div class="ms-book-name">{{ b.name }}</div>
            <div class="ms-book-desc">{{ b.description || '暂无简介' }}</div>
            <div v-if="(b.tags as string[])?.length" class="ms-book-tags">
              <span v-for="t in (b.tags as string[]).slice(0, 3)" :key="t" class="ms-book-tag">{{ t }}</span>
              <span v-if="(b.tags as string[]).length > 3" class="ms-book-tag ms-book-tag--more">+{{ (b.tags as string[]).length - 3 }}</span>
            </div>
            <div class="ms-book-meta">
              <span>{{ chapterCount(b.id) }} 章</span>
              <span>{{ totalWords(b.id) }} 字</span>
            </div>
          </article>
        </template>
        <!-- 未归书虚拟卡片：不参与拖拽排序（#footer 不入排序列表） -->
        <template #footer>
          <article
            v-if="unfiledChapters.length > 0"
            class="ms-book-card ms-book-card--ghost"
            role="button"
            tabindex="0"
            @click="$emit('open', '')"
            @keydown.enter.prevent="$emit('open', '')"
          >
            <div class="ms-book-cover">
              <div class="ms-book-cover-empty"><WsIcon name="manuscript" size="lg" /></div>
            </div>
            <div class="ms-book-name">未归书章节</div>
            <div class="ms-book-desc">{{ unfiledChapters.length }} 个章节尚未归入任何书籍</div>
            <div class="ms-book-meta">
              <span>{{ unfiledChapters.length }} 章</span>
              <span>{{ unfiledWords }} 字</span>
            </div>
          </article>
        </template>
      </draggable>
      <WsEmpty v-if="loaded && books.length === 0 && unfiledChapters.length === 0" preset="no-data" title="还没有书籍——新建一本开始写作" />
    </template>
  </div>
</template>

<script setup lang="ts">
/**
 * 层1 书籍网格（批1 从 ManuscriptView 抽出）：书籍卡片（封面/简介/标签/章数字数）+
 * 拖拽排序 + 未归书虚拟卡片。数据动作（排序落库）经 entityStore 自持；
 * 编辑/删除/建书弹窗留在 ManuscriptView（跨层复用）。
 */
import { computed } from 'vue'
import draggable from 'vuedraggable'
import { type Entity } from '@worldsea/entity-core'
import { TuiButton, WsEmpty, WsSkeleton, WsIcon } from '@worldsea/ui-kit'
import { entitiesSvc } from '../serviceAccess'

const props = defineProps<{
  books: Entity[]
  /** 全部章节（manuscript 实体），供章数/字数/未归书统计 */
  chapters: Entity[]
  loading: boolean
  loaded: boolean
  error: string | null
}>()

defineEmits<{
  open: [bookId: string]
  edit: [book: Entity]
  remove: [book: Entity]
  retry: []
}>()

const es = entitiesSvc()

/** 书籍封面 asset URL（2026-10-07 归一：真值在顶层 coverImage；旧数据 properties.cover 回退） */
function bookCover(b: Entity): string {
  return (b.coverImage as string) || (b.properties.cover as string) || ''
}

function chapterCount(bookId: string): number {
  return props.chapters.filter(m => ((m.properties.bookId as string) || '') === bookId).length
}

function totalWords(bookId: string): number {
  return props.chapters
    .filter(m => ((m.properties.bookId as string) || '') === bookId)
    .reduce((s, m) => s + ((m.properties.wordCount as number) || 0), 0)
}

const unfiledChapters = computed(() => props.chapters.filter(m => !m.properties.bookId))
const unfiledWords = computed(() => unfiledChapters.value.reduce((s, m) => s + ((m.properties.wordCount as number) || 0), 0))

/** 拖拽结束：按新顺序落 sortOrder（旧书籍无该字段排最后，首次拖拽后自然收敛） */
async function onBooksReorder() {
  for (let i = 0; i < props.books.length; i++) {
    const b = props.books[i]
    if ((b.properties.sortOrder as number | undefined) !== i) {
      await es.update(b.id, { properties: { ...b.properties, sortOrder: i } })
    }
  }
}
</script>

<style scoped>
.ms-books { flex: 1; overflow-y: auto; padding: 8px 4px; }
.ms-books-skeleton {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 14px;
  align-content: start;
}
.ms-books-error { display: flex; align-items: center; justify-content: center; min-height: 240px; }
.ms-books-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 14px;
  align-content: start;
}
.ms-book-card {
  position: relative;
  padding: 0 16px 14px;
  border: 1px solid var(--border-light);
  border-radius: var(--radius-lg);
  background: var(--card-bg);
  cursor: pointer;
  overflow: hidden;
  transition: border-color 0.15s, box-shadow 0.15s, transform 0.15s;
}
.ms-book-card:hover { border-color: var(--primary); box-shadow: 0 4px 14px rgba(0,0,0,0.08); transform: translateY(-2px); }
.ms-book-card--ghost { border-style: dashed; background: transparent; }
/* 拖拽态（vuedraggable ghost/drag class） */
.ms-book-ghost { opacity: 0.5; }
.ms-book-drag { opacity: 0.92; box-shadow: 0 6px 18px rgba(0,0,0,0.18); }

/* hover 操作组（编辑信息 / 删除书籍） */
.ms-book-actions { position: absolute; top: 8px; right: 8px; z-index: 1; display: none; gap: 4px; }
.ms-book-card:hover .ms-book-actions { display: flex; }
.ms-book-act {
  width: 24px; height: 24px; padding: 0;
  border: none; background: var(--card-bg); border-radius: var(--radius-xs);
  color: var(--text-tertiary); cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  transition: background 0.15s, color 0.15s;
}
.ms-book-act:hover { background: var(--hover-bg); color: var(--primary); }
.ms-book-actions .ms-book-act:last-child:hover { color: var(--danger); }

/* 封面区：负 margin 出血到卡片三边（顶部圆角由卡片 overflow:hidden 裁齐） */
.ms-book-cover {
  height: 150px; margin: 0 -16px 12px;
  overflow: hidden; display: flex; align-items: center; justify-content: center;
  background: var(--bg-tertiary);
}
.ms-book-cover img { width: 100%; height: 100%; object-fit: cover; display: block; }
.ms-book-cover-empty { color: var(--text-tertiary); }
.ms-book-name {
  font-size: var(--font-size-base); font-weight: var(--font-weight-semibold);
  color: var(--text-color); margin-bottom: 4px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.ms-book-desc {
  font-size: var(--font-size-xs); color: var(--text-tertiary);
  margin-bottom: 10px; min-height: 2.4em;
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
}
.ms-book-meta { display: flex; gap: 10px; font-size: var(--font-size-xs); color: var(--text-secondary); }
/* 书籍标签 chips（BookInfoDialog 编辑 entity.tags；最多显 3 个 + 溢出计数） */
.ms-book-tags { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 8px; }
.ms-book-tag {
  font-size: var(--font-size-2xs); color: var(--text-secondary);
  background: var(--bg-tertiary); padding: 1px 6px; border-radius: var(--radius-2xs);
}
.ms-book-tag--more { color: var(--text-tertiary); }
</style>
