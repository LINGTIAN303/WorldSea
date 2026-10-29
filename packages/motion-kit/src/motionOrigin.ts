export interface MotionAnchor {
  x: number
  y: number
}

export interface MotionRect {
  left: number
  top: number
}

/** 把视口坐标的触发点换算为面板内的 transform-origin。 */
export function motionOrigin(anchor: MotionAnchor, panel: MotionRect): string {
  return `${Math.round(anchor.x - panel.left)}px ${Math.round(anchor.y - panel.top)}px`
}
