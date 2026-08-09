<template>
  <div v-if="show" class="modal-overlay guide-overlay" @click.self="$emit('close')">
    <div ref="dialogRef" class="modal guide-modal" role="dialog" aria-modal="true" aria-labelledby="mgm-title" tabindex="-1">
      <div class="guide-modal-header">
        <h2 id="mgm-title"><WsIcon name="puzzle" size="sm" /> 自定义模块使用指南</h2>
        <button class="guide-close" @click="$emit('close')" aria-label="关闭"><WsIcon name="close" size="xs" /></button>
      </div>

      <div class="guide-modal-body">
        <section>
          <h3>什么是自定义模块？</h3>
          <p>官方模块（人物志、区域图谱等）覆盖了常见的世界观管理需求。但你的世界观是独一无二的——当官方模块不够用时，<strong>自定义模块</strong>让你在界面中创建属于自己的管理工具，就像我在代码中为你写一个新插件一样，但不需要写代码。</p>
        </section>

        <section>
          <h3><WsIcon name="book" size="xs" /> 实战：从零创建一个"货币体系"模块</h3>

          <div class="guide-example">
            <div class="ge-step">
              <span class="ge-num">1</span>
              <div>
                <strong>命名模块</strong>
                <p>在上方输入模块名"货币体系"，图标设为 <WsIcon name="coin" size="xs" /></p>
              </div>
            </div>
            <div class="ge-step">
              <span class="ge-num">2</span>
              <div>
                <strong>创建"货币"实体</strong>
                <p>在构件箱点击「新建实体类型」→ 在右侧属性面板将名称改为"货币"→ 点击卡片上的「添加字段」添加：面值（数字）、材质（文本）、发行国（文本）</p>
              </div>
            </div>
            <div class="ge-step">
              <span class="ge-num">3</span>
              <div>
                <strong>创建"汇率"关系（进阶）</strong>
                <p>点击「新建关系类型」→ 命名为"汇率"→ 设置来源和目标都是"货币"→ 这允许你记录"1 金币 = 100 银币"这样的兑换规则</p>
              </div>
            </div>
            <div class="ge-step">
              <span class="ge-num">4</span>
              <div>
                <strong>创建视图</strong>
                <p>点击「新建视图」→ 选择实体类型"货币"→ 选择要显示的字段→ 选择卡片网格样式</p>
              </div>
            </div>
            <div class="ge-step">
              <span class="ge-num">5</span>
              <div>
                <strong>发布使用</strong>
                <p>点击「发布到侧边栏」→ 侧边栏出现"<WsIcon name="coin" size="xs" /> 货币体系"→ 点进去就能增删改查货币数据了</p>
              </div>
            </div>
          </div>
        </section>

        <section>
          <h3><WsIcon name="target" size="xs" /> 字段类型选用建议</h3>
          <table class="guide-table">
            <tbody>
              <tr><td><strong>文本</strong></td><td>名称、产地、颜色描述…… 大部分短文本</td></tr>
              <tr><td><strong>数字</strong></td><td>面值、数量、年份、坐标…… 需要计算的</td></tr>
              <tr><td><strong>下拉选择</strong></td><td>状态、类型、等级…… 选项固定的</td></tr>
              <tr><td><strong>多选</strong></td><td>标签、特性、元素属性…… 可多选的</td></tr>
              <tr><td><strong>开关</strong></td><td>是否启用、是否可见、是否已解锁</td></tr>
              <tr><td><strong>评分</strong></td><td>危险等级、珍贵程度、影响力…… 1-5星</td></tr>
              <tr><td><strong>日期</strong></td><td>建立时间、发现时间、过期时间</td></tr>
              <tr><td><strong>图片/网址/邮箱/颜色</strong></td><td>多媒体信息的实体</td></tr>
              <tr><td><strong>长文本/富文本/Markdown</strong></td><td>描述、背景故事、详细说明…… 大段文字</td></tr>
            </tbody>
          </table>
        </section>

        <section>
          <h3><WsIcon name="inspiration" size="xs" /> 进阶技巧</h3>
          <ul class="guide-tips">
            <li><strong>用关系连接实体</strong>——"汇率"是货币之间的关系，"驻扎"是势力和区域之间的关系。善用关系让数据形成网络</li>
            <li><strong>一个模块可以有多个实体类型</strong>——"货币体系"可以包含"货币""铸币局""汇率"三个实体类型</li>
            <li><strong>标识键使用英文</strong>——如 <code>currency</code>、<code>exchange_rate</code>，名称用中文</li>
            <li><strong>发布后仍可修改</strong>——修改后重新发布即可，已有数据不会丢失</li>
          </ul>
        </section>
      </div>

      <div class="modal-actions">
        <button class="btn-primary" @click="$emit('close')">开始构建</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, nextTick } from 'vue'
import { WsIcon } from '@worldsmith/ui-kit'
import { useFocusTrap } from '@/composables/useFocusTrap'

const props = defineProps<{ show: boolean }>()
const emit = defineEmits<{ close: [] }>()

const dialogRef = ref<HTMLElement | null>(null)

const { activate, deactivate } = useFocusTrap(dialogRef, {
  escapeDeactivates: true,
  onEscape: () => emit('close'),
})

watch(() => props.show, (v) => {
  if (v) nextTick(() => activate())
  else deactivate()
})
</script>

<style scoped>
.guide-overlay { z-index: 200; }
.guide-modal { max-width: 640px !important; max-height: 85vh; }
.guide-modal-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
.guide-modal-header h2 { margin: 0; }
.guide-close { background: none; border: none; font-size: var(--font-size-xl); cursor: pointer; color: var(--text-tertiary); }
.guide-modal-body { overflow-y: auto; max-height: 60vh; }
.guide-modal-body section { margin-bottom: 20px; }
.guide-modal-body h3 { font-size: var(--font-size-md); margin: 0 0 8px; color: var(--text); }
.guide-modal-body p { font-size: var(--font-size-sm); color: var(--color-text-secondary); line-height: 1.6; margin: 0; }

.guide-example { display: flex; flex-direction: column; gap: 8px; }
.ge-step { display: flex; gap: 10px; background: var(--canvas-bg); border-radius: var(--radius-mid); padding: 10px; }
.ge-num { width: 24px; height: 24px; background: var(--primary); color: var(--text); border-radius: 50%; font-size: var(--font-size-sm); display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
.ge-step strong { font-size: var(--font-size-sm); display: block; margin-bottom: 2px; }
.ge-step p { font-size: var(--font-size-sm) !important; color: var(--color-text-tertiary) !important; }

.guide-table { width: 100%; font-size: var(--font-size-sm); border-collapse: collapse; }
.guide-table td { padding: 6px 8px; border-bottom: 1px solid var(--border-color); }
.guide-table td:first-child { width: 100px; color: var(--text); }

.guide-tips { padding-left: 20px; }
.guide-tips li { font-size: var(--font-size-sm); color: var(--color-text-secondary); margin-bottom: 6px; line-height: 1.5; }
.guide-tips code { background: var(--bg-secondary); padding: 1px 6px; border-radius: var(--radius-2xs); font-size: var(--font-size-sm); }

.modal-overlay { position: fixed; inset: 0; background: var(--overlay); display: flex; align-items: center; justify-content: center; z-index: var(--z-sticky); }
.modal { background: var(--color-bg-surface); border-radius: var(--radius-2xl); padding: 24px; max-width: 500px; width: 90%; }
.modal-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px; }
.btn-primary { padding: 8px 16px; background: var(--primary); color: var(--color-text-inverse); border: none; border-radius: var(--radius-sm); cursor: pointer; font-size: var(--font-size-base); }
</style>