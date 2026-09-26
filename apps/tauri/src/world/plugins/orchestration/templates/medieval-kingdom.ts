// 中世纪王国创作模板
//
// 从零设计一个完整的中世纪奇幻王国：
// 地理 → 区域 → 物种 → 文化 → 势力 → 角色 → 一致性检查

import type { CreationTemplate } from '../types'

export const medievalKingdom: CreationTemplate = {
  id: 'medieval-kingdom',
  name: '中世纪王国',
  description: '从零构建一个包含地理、区域、物种、文化、势力和角色的中世纪奇幻王国。',
  icon: 'crown',
  tags: ['王国', '中世纪', '奇幻', '完整世界观'],
  steps: [
    {
      type: 'agent-task',
      title: '大陆地理设计',
      config: {
        prompt: '为这个世界设计一个主要大陆的地理概貌：包括山脉、河流、平原、森林、海岸线等自然地形。给出 3-5 个主要地理区域的名称和简要描述。',
        skillIds: ['worldbuilding'],
        targetEntityType: 'region',
        expectedOutput: '3-5 个主要地理区域实体',
      },
      position: { x: 80, y: 60 },
    },
    {
      type: 'user-review',
      title: '审阅地理设定',
      config: {
        instruction: '请查看 Agent 生成的地理设定。你可以修改区域名称、描述，或添加/删除区域。满意后点击「继续」。',
        skippable: false,
      },
      position: { x: 80, y: 160 },
    },
    {
      type: 'agent-task',
      title: '物种与生态',
      config: {
        prompt: '基于已有的地理区域，设计 3-4 个智慧物种/种族。每个物种需要有：名称、生理特征、栖息地偏好、文化倾向简述。同时设计 2-3 种标志性动植物。',
        skillIds: ['worldbuilding', 'content-craft'],
        targetEntityType: 'species',
        expectedOutput: '3-4 个物种实体 + 若干动植物实体',
      },
      position: { x: 80, y: 260 },
    },
    {
      type: 'agent-task',
      title: '文化体系构建',
      config: {
        prompt: '为每个物种/种族设计一套文化体系：包括宗教信仰、社会制度、语言特点、风俗习惯、艺术风格。不同文化之间应有差异和交融。',
        skillIds: ['worldbuilding'],
        targetEntityType: 'culture',
        expectedOutput: '每个物种对应一个文化实体',
      },
      position: { x: 80, y: 360 },
    },
    {
      type: 'agent-task',
      title: '势力与组织',
      config: {
        prompt: '设计 4-6 个主要势力/组织（王国、教团、商会、秘密结社等）。每个势力需要：名称、类型、控制区域、核心目标、与其他势力的关系（同盟/敌对/中立）。',
        skillIds: ['worldbuilding', 'content-craft'],
        targetEntityType: 'organization',
        expectedOutput: '4-6 个组织实体 + 势力间关系',
      },
      position: { x: 80, y: 460 },
    },
    {
      type: 'agent-task',
      title: '关键角色创作',
      config: {
        prompt: '为每个势力创作 1-2 个关键角色（领袖、英雄、反派）。每个角色需要：姓名、年龄、身份、性格特点、与所属势力的关系、个人目标与动机。',
        skillIds: ['content-craft'],
        targetEntityType: 'character',
        expectedOutput: '每个势力 1-2 个角色实体',
      },
      position: { x: 80, y: 560 },
    },
    {
      type: 'consistency-check',
      title: '世界观一致性校验',
      config: {
        scope: 'all',
        strictness: 'normal',
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
