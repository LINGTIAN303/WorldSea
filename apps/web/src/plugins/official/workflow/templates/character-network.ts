// 角色关系网创作模板
//
// 围绕角色关系网创作：
// 核心角色 → 性格/背景 → 关系构建 → 冲突设计 → 关联势力 → 校验

import type { CreationTemplate } from '../types'

export const characterNetwork: CreationTemplate = {
  id: 'character-network',
  name: '角色关系网',
  description: '构建一组有深度关联的角色：包括性格背景、复杂关系网络、内在冲突和所属势力。',
  icon: 'character',
  tags: ['角色', '关系', '冲突', '势力'],
  steps: [
    {
      type: 'batch-create',
      title: '核心角色群',
      config: {
        entityType: 'character',
        count: 6,
        context: '创建 6 个核心角色原型：只需要姓名、角色定位（主角/反派/配角/导师/信使）和基本职业。详细背景后续步骤补充。',
        namePrefix: '',
      },
      position: { x: 80, y: 60 },
    },
    {
      type: 'user-review',
      title: '确认角色阵容',
      config: {
        instruction: '请查看 6 个核心角色的基本定位。你可以调整角色类型、添加或删除角色。后续步骤会为他们填充详细背景和关系。',
        skippable: false,
      },
      position: { x: 80, y: 160 },
    },
    {
      type: 'agent-task',
      title: '性格与背景填充',
      config: {
        prompt: '为每个核心角色补充详细设定：年龄、性别、外貌特征、性格特点（至少 3 个）、个人背景故事（100字左右）、个人目标与内在动机。角色之间应有差异性。',
        skillIds: ['content-craft'],
        targetEntityType: 'character',
        expectedOutput: '更新 6 个角色实体的详细属性',
      },
      position: { x: 80, y: 260 },
    },
    {
      type: 'agent-task',
      title: '关系网络构建',
      config: {
        prompt: '为角色之间建立有意义的关系：至少包括 1 对盟友、1 对宿敌、1 段师徒、1 段亲属、1 段复杂关系（如既是盟友又有秘密矛盾）。每段关系需要描述关系的性质和形成原因。',
        skillIds: ['worldbuilding'],
        targetEntityType: 'character',
        expectedOutput: '8-12 条角色关系',
      },
      position: { x: 80, y: 360 },
    },
    {
      type: 'agent-task',
      title: '核心冲突设计',
      config: {
        prompt: '设计 2-3 个核心冲突：每个冲突涉及 2-3 个角色，有明确的矛盾焦点（利益冲突、价值观对立、情感纠葛等）。冲突应该是推动故事的引擎。创建 conflict 实体来记录。',
        skillIds: ['worldbuilding', 'content-craft'],
        targetEntityType: 'conflict',
        expectedOutput: '2-3 个 conflict 实体，关联到相关角色',
      },
      position: { x: 80, y: 460 },
    },
    {
      type: 'agent-task',
      title: '关联势力归属',
      config: {
        prompt: '为角色分配势力归属：创建 2-3 个组织/势力实体，并将角色分配到其中。某些角色可以跨势力（如双面间谍），某些势力可以没有核心角色（作为背景势力）。',
        skillIds: ['worldbuilding'],
        targetEntityType: 'organization',
        expectedOutput: '2-3 个组织实体 + 角色归属关系',
      },
      position: { x: 80, y: 560 },
    },
    {
      type: 'consistency-check',
      title: '角色网络一致性校验',
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
