// 内置创作模板汇总

import type { CreationTemplate } from '../types'
import { medievalKingdom } from './medieval-kingdom'
import { magicSystem } from './magic-system'
import { characterNetwork } from './character-network'

export const builtinTemplates: CreationTemplate[] = [
  medievalKingdom,
  magicSystem,
  characterNetwork,
]

export { medievalKingdom, magicSystem, characterNetwork }
