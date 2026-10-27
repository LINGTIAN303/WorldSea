/**
 * 模型动作序列状态机（F4）：start 播首项，model-viewer 的 finished 事件推进下一项；
 * 序列结束停在末帧；再次 start 从头播放。与渲染元素解耦，便于单测。
 */
export function createModelSequence(play: (name: string) => void) {
  let names: string[] = []
  let index = 0

  return {
    start(list: string[]) {
      names = list.filter(Boolean)
      index = 0
      if (names.length) play(names[0])
    },
    finished() {
      if (!names.length) return
      index++
      if (index < names.length) play(names[index])
      else names = []
    },
    cancel() {
      names = []
    },
    get active() {
      return names.length > 0
    },
  }
}
