import { ref, onBeforeUnmount } from 'vue'

/**
 * 物理引擎常量(从原 Sidebar.vue 提取,保持行为一致)
 * FRICTION: 自由滑动摩擦系数(每帧 vel *= 0.92)
 * IMPULSE: 滚轮每次触发的冲量
 * SNAP_SPRING: 吸附到整数位置的弹簧系数
 * SNAP_DAMPING: 吸附阻尼
 * SNAP_VEL_THRESHOLD: 速度低于此值开始吸附
 * SETTLE_THRESHOLD: 收敛阈值,低于此值停止
 */
const FRICTION = 0.92
const IMPULSE = 0.32
const SNAP_SPRING = 0.22
const SNAP_DAMPING = 0.78
const SNAP_VEL_THRESHOLD = 0.15
const SETTLE_THRESHOLD = 0.0005

export interface PhysicsCallbacks {
  /** 每帧物理更新后调用,参数为当前 pos(浮点) */
  onTick?: (pos: number) => void
  /** pos 落到新整数位置时调用,参数为视图索引 */
  onSettle?: (viewIndex: number) => void
  /** 获取视图总数,用于循环取模 */
  getViewCount: () => number
}

/**
 * 侧边栏轮播物理引擎 composable
 *
 * 职责:
 *  - 维护 pos / vel / springTarget 状态
 *  - 运行 RAF 物理循环(摩擦 + 弹簧吸附)
 *  - 提供接口:applyImpulse(滚轮) / springTo(点击跳转) / stop
 *
 * 不含:
 *  - DOM 事件处理(由 useSidebarInteraction 负责)
 *  - 视图切换副作用(通过 onSettle 回调通知上层)
 *  - DOM 样式更新(由 SidebarV2 的 syncDomStyles 负责)
 *
 * 这样分离后,物理逻辑可独立单元测试,无需模拟 DOM。
 */
export function useSidebarPhysics(callbacks: PhysicsCallbacks) {
  /** 当前浮点位置(视图索引) */
  const pos = ref(0)
  /** 当前速度 */
  let vel = 0
  /** 弹簧目标位置(点击跳转时设置,物理循环会吸附到此位置) */
  let springTarget: number | null = null
  /** 上次落定的整数索引,用于检测视图切换 */
  let lastSettledIdx = 0

  let physicsRaf: number | null = null
  let isRunning = false

  /** 启动物理循环(幂等,已在运行则忽略) */
  function startPhysics() {
    if (isRunning) return
    isRunning = true
    tick()
  }

  /** 停止物理循环 */
  function stopPhysics() {
    if (physicsRaf !== null) {
      cancelAnimationFrame(physicsRaf)
      physicsRaf = null
    }
    isRunning = false
  }

  /** 物理循环单帧 */
  function tick() {
    if (springTarget !== null) {
      // 弹簧吸附模式(点击跳转)
      const diff = springTarget - pos.value
      vel = vel * 0.72 + diff * 0.18
      pos.value += vel

      if (Math.abs(diff) < SETTLE_THRESHOLD && Math.abs(vel) < SETTLE_THRESHOLD) {
        pos.value = springTarget
        vel = 0
        springTarget = null
        isRunning = false
        physicsRaf = null
        callbacks.onTick?.(pos.value)
        checkSettle()
        return
      }
    } else {
      // 自由滑动模式(滚轮/拖拽 fling)
      pos.value += vel

      if (Math.abs(vel) < SNAP_VEL_THRESHOLD) {
        // 速度过低,开始吸附到最近整数
        const target = Math.round(pos.value)
        const diff = target - pos.value
        vel = vel * SNAP_DAMPING + diff * SNAP_SPRING

        if (Math.abs(diff) < SETTLE_THRESHOLD && Math.abs(vel) < SETTLE_THRESHOLD) {
          pos.value = target
          vel = 0
          isRunning = false
          physicsRaf = null
          callbacks.onTick?.(pos.value)
          checkSettle()
          return
        }
      } else {
        vel *= FRICTION
      }
    }

    callbacks.onTick?.(pos.value)
    checkSettle()
    physicsRaf = requestAnimationFrame(tick)
  }

  /** 检测是否落到新整数位置,触发 onSettle 回调 */
  function checkSettle() {
    const current = Math.round(pos.value)
    if (current !== lastSettledIdx) {
      lastSettledIdx = current
      const viewCount = callbacks.getViewCount()
      if (viewCount > 0) {
        const idx = ((current % viewCount) + viewCount) % viewCount
        callbacks.onSettle?.(idx)
      }
    }
  }

  /**
   * 施加冲量(滚轮触发)
   * @param direction 1=向下/向下一个视图,-1=向上
   */
  function applyImpulse(direction: number) {
    springTarget = null
    vel += direction * IMPULSE
    startPhysics()
  }

  /**
   * 设置弹簧目标(点击跳转)
   * @param targetIndex 目标视图索引(浮点,会吸附到整数)
   */
  function springTo(targetIndex: number) {
    springTarget = targetIndex
    startPhysics()
  }

  /**
   * 直接设置位置(拖拽时调用,跳过物理)
   * @param newPos 新位置
   * @param shouldSettle 是否在停止后吸附到最近整数
   */
  function setPosition(newPos: number, shouldSettle: boolean = false) {
    pos.value = newPos
    vel = 0
    springTarget = null
    if (shouldSettle) {
      // 拖拽结束后,给一个小速度让物理循环吸附到最近整数
      const target = Math.round(newPos)
      const diff = target - newPos
      if (Math.abs(diff) > SETTLE_THRESHOLD) {
        vel = diff * 0.45
        startPhysics()
      }
    }
  }

  /**
   * 拖拽 fling:根据释放瞬间的速度启动惯性滑动
   * @param velocity 释放速度(px/ms)
   */
  function fling(velocity: number) {
    springTarget = null
    vel = -velocity * 6.5 // FLING_MULTIPLIER
    if (Math.abs(vel) < 0.05) {
      vel = 0
      const target = Math.round(pos.value)
      const diff = target - pos.value
      if (Math.abs(diff) > SETTLE_THRESHOLD) {
        vel = diff * 0.45
      }
    }
    startPhysics()
  }

  /** 强制同步 lastSettledIdx(初始化或外部 setView 时调用) */
  function syncSettledIdx(idx: number) {
    lastSettledIdx = idx
  }

  /** 获取当前落定的整数索引(浮点四舍五入) */
  function getSettledIdx(): number {
    return Math.round(pos.value)
  }

  onBeforeUnmount(() => {
    stopPhysics()
  })

  return {
    pos,
    applyImpulse,
    springTo,
    setPosition,
    fling,
    stopPhysics,
    syncSettledIdx,
    getSettledIdx,
    /** 内部测试用:获取当前 vel(只读) */
    _getVel: () => vel,
    /** 内部测试用:获取 springTarget(只读) */
    _getSpringTarget: () => springTarget,
    /** 内部测试用:是否正在运行 */
    _isRunning: () => isRunning,
  }
}
