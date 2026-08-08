// 魔法体系创作模板
//
// 设计一个完整的魔法体系：
// 概念定义 → 魔法类型 → 法术列表 → 施法者角色 → 关联道具 → 校验

import type { CreationTemplate } from '../types'

export const magicSystem: CreationTemplate = {
  id: 'magic-system',
  name: '魔法体系',
  description: '设计一个逻辑自洽的魔法体系：包括魔法规则、类型分类、代表性法术、施法者角色和魔法道具。',
  icon: 'magic',
  tags: ['魔法', '体系', '奇幻', '规则'],
  steps: [
    {
      type: 'agent-task',
      title: '魔法规则与概念',
      config: {
        prompt: '设计这个世界的魔法基本概念：魔法的来源（先天/后天/外界）、施法代价、魔法规则限制（不能做什么）、魔法与世界的关系。给出 3-5 条核心魔法规则。',
        skillIds: ['worldbuilding'],
        targetEntityType: 'concept',
        expectedOutput: '1 个核心概念实体（魔法体系概述）+ 若干规则概念',
      },
      position: { x: 80, y: 60 },
    },
    {
      type: 'user-review',
      title: '审阅魔法规则',
      config: {
        instruction: '魔法规则是整个体系的基石。请确认规则是否合理、有趣、有足够限制。你可以修改或补充规则。',
        skippable: false,
      },
      position: { x: 80, y: 160 },
    },
    {
      type: 'batch-create',
      title: '魔法类型分类',
      config: {
        entityType: 'magic',
        count: 6,
        context: '基于已确定的魔法规则，创建 6 个主要魔法流派/类型，每个流派有独特的特点、优缺点和代表色。',
      },
      position: { x: 80, y: 260 },
    },
    {
      type: 'agent-task',
      title: '代表法术设计',
      config: {
        prompt: '为每个魔法流派设计 2-3 个代表性法术：包括法术名、等级（初阶/中阶/高阶）、效果描述、施法条件、副作用。',
        skillIds: ['content-craft'],
        targetEntityType: 'magic',
        expectedOutput: '每个流派 2-3 个法术实体（作为 magic 类型的子条目）',
      },
      position: { x: 80, y: 360 },
    },
    {
      type: 'agent-task',
      title: '施法者角色',
      config: {
        prompt: '设计 4-6 个代表性施法者角色：每个角色精通不同流派，有不同的社会地位（学院教师、野法师、宫廷魔法师、禁忌研究者等），需要有个人背景和施法风格。',
        skillIds: ['content-craft'],
        targetEntityType: 'character',
        expectedOutput: '4-6 个角色实体，关联到对应的魔法流派',
      },
      position: { x: 80, y: 460 },
    },
    {
      type: 'agent-task',
      title: '魔法道具',
      config: {
        prompt: '设计 3-4 件标志性魔法道具：与特定魔法流派关联，有独特的能力和限制。每件道具需要有：名称、关联流派、能力描述、使用限制、历史背景。',
        skillIds: ['content-craft'],
        targetEntityType: 'item',
        expectedOutput: '3-4 个道具实体',
      },
      position: { x: 80, y: 560 },
    },
    {
      type: 'consistency-check',
      title: '魔法体系一致性校验',
      config: {
        scope: 'all',
        strictness: 'strict',
      },
      position: { x: 80, y: 660 },
    },
  ],
  connections: [
    { fromIndex: 0, toIndex: 1 },
    { fromIndex: 1, toIndex: 2 },
    { fromIndex: 2, toIndex: 3 },
    { fromIndex: 3, toIndex: 4 },
    { fromIndex: 4, toIndex: 5 },
    { fromIndex: 5, toIndex: 6 },
  ],
}
