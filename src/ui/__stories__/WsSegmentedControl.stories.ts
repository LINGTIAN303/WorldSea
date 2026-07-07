import type { Meta, StoryObj } from '@storybook/vue3'
import WsSegmentedControl from '../WsSegmentedControl.vue'

const meta: Meta<typeof WsSegmentedControl> = {
  title: 'Primitives/WsSegmentedControl',
  component: WsSegmentedControl as any,
  tags: ['autodocs'],
  argTypes: {
    size: { control: { type: 'inline-radio' }, options: ['sm', 'md'] },
  },
}
export default meta

type Story = StoryObj<typeof WsSegmentedControl>

const editOptions = [
  { value: 'sidebar', label: '侧边栏' },
  { value: 'inline', label: '内联' },
  { value: 'hover', label: '悬浮' },
] as const

const viewOptions = [
  { value: 'list', label: '列表', icon: '☰' },
  { value: 'grid', label: '网格', icon: '▦' },
  { value: 'card', label: '卡片', icon: '▭' },
] as const

export const EditMethod: Story = {
  args: { modelValue: 'sidebar', options: [...editOptions] },
}
export const ViewSwitch: Story = {
  args: { modelValue: 'grid', options: [...viewOptions] },
}
export const Medium: Story = {
  args: { modelValue: 'sidebar', options: [...editOptions], size: 'md' },
}
