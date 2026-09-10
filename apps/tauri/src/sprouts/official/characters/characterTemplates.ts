export interface CharacterTemplate {
  id: string
  name: string
  icon: string
  defaults: Record<string, string>
}

export const characterTemplates: CharacterTemplate[] = [
  {
    id: 'hero',
    name: '英雄',
    icon: 'hero',
    defaults: {
      role: '主角',
      gender: '男',
      personality: '勇敢、正直、有责任感',
      occupation: '冒险者',
    },
  },
  {
    id: 'mentor',
    name: '导师',
    icon: 'wizard',
    defaults: {
      role: '导师',
      gender: '男',
      age: '50',
      personality: '智慧、沉稳、严厉但慈爱',
      occupation: '贤者',
    },
  },
  {
    id: 'villain',
    name: '反派',
    icon: 'devil',
    defaults: {
      role: '反派',
      gender: '男',
      personality: '野心勃勃、冷酷无情',
      occupation: '统治者',
    },
  },
  {
    id: 'sidekick',
    name: '配角',
    icon: 'person',
    defaults: {
      role: '配角',
      personality: '忠诚、幽默',
      occupation: '随从',
    },
  },
  {
    id: 'love_interest',
    name: '恋人',
    icon: 'love',
    defaults: {
      role: '重要角色',
      gender: '女',
      personality: '温柔、坚强',
    },
  },
  {
    id: 'antihero',
    name: '反英雄',
    icon: 'sunglasses',
    defaults: {
      role: '主角',
      gender: '男',
      personality: '愤世嫉俗、手段狠辣但心存正义',
      occupation: '独行侠',
    },
  },
]