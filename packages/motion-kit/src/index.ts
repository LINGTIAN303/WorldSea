export {
  type DurationToken,
  type EasingToken,
  type MotionTokens,
  type SemanticMotionTokens,
  DURATION_VALUES,
  EASING_VALUES,
  CSS_VAR_DURATION,
  CSS_VAR_EASING,
  COSMIC_MOTION_TOKENS,
  cssDuration,
  cssEasing,
  msDuration,
  cssTransition,
} from './tokens'

export {
  type MotionAnchor,
  type MotionRect,
  motionOrigin,
} from './motionOrigin'

export {
  type KeyframeName,
  KEYFRAMES,
  injectKeyframe,
  injectKeyframes,
  injectAllKeyframes,
  getKeyframeCss,
  getAllKeyframeNames,
} from './keyframes'

export {
  type TransitionPresetName,
  type TransitionPreset,
  TRANSITION_PRESETS,
  getPreset,
  getTransitionName,
  getAllPresetNames,
} from './transitions'

export {
  useReducedMotion,
  isReducedMotion,
  useTransition,
  useTransitionStyle,
  useMotion,
  useTextLayout,
  useAnimationCapture,
} from './composables'

export type {
  UseTransitionReturn,
  MotionKeyframe,
  MotionOptions,
  UseMotionReturn,
  TextLayoutResult,
  UseTextLayoutReturn,
  MotionCaptureFrame,
  MotionCaptureOptions,
  MotionCaptureResult,
  UseAnimationCaptureReturn,
} from './composables'

export {
  type GifFrame,
  type GifEncodeOptions,
  encodeGif,
  gifFrameFromCanvas,
} from './GifEncoder'

export {
  type CaptureFrame,
  type CaptureOptions,
  type CaptureResult,
  captureFromCanvas,
  framesToImageDataArray,
} from './FrameCapture'

