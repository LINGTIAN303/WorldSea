import { createApp } from 'vue'

import '../src/styles/theme.css'
import '../src/styles/web-tokens-bridge.css'
import { applySplashAccent } from './accent'
import SplashScreen from '../src/ui/boot/SplashScreen.vue'

// 首帧前还原用户强调色（独立入口不含主应用的主题引擎）
applySplashAccent()

createApp(SplashScreen).mount('#app')
