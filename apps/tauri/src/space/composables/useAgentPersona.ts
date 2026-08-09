import { computed, watch, ref } from 'vue'
import { useSpaceStore, type AgentMood } from '../stores/space-store'
import { useAgent } from '@/agent/composables/useAgent'
import { loadPersonaFromKB } from '@agent/tools/persona'

function generateAvatarSeed(name: string): number {
  let hash = 0
  for (let i = 0; i < name.length; i++) {
    hash = ((hash << 5) - hash) + name.charCodeAt(i)
    hash |= 0
  }
  return Math.abs(hash)
}

let _kbPersonaLoaded = false

export function useAgentPersona() {
  const spaceStore = useSpaceStore()
  const { isStreaming } = useAgent()

  const preStreamingMood = ref<AgentMood | null>(null)

  const persona = computed(() => spaceStore.persona)
  const agentName = computed(() => persona.value.name)
  const avatarSeed = computed(() => generateAvatarSeed(persona.value.name))
  const mood = computed(() => persona.value.mood)
  const statusMessage = computed(() => persona.value.statusMessage)

  const moodIcon = computed(() => {
    switch (mood.value) {
      case 'active': return 'check-circle'
      case 'thinking': return 'loader'
      case 'focused': return 'target'
      case 'idle': return 'moon'
    }
  })

  const moodLabel = computed(() => {
    switch (mood.value) {
      case 'active': return '活跃'
      case 'thinking': return '思考中'
      case 'focused': return '专注执行'
      case 'idle': return '休眠'
    }
  })

  if (!_kbPersonaLoaded) {
    _kbPersonaLoaded = true
    loadPersonaFromKB().then(kbPersona => {
      const patch: { name?: string; avatar?: string } = {}
      if (kbPersona.name && spaceStore.persona.name === 'WorldSmith Agent') {
        patch.name = kbPersona.name
      }
      if (kbPersona.avatar && !spaceStore.persona.avatar) {
        patch.avatar = kbPersona.avatar
      }
      if (patch.name || patch.avatar) {
        spaceStore.updatePersona(patch)
      }
    }).catch(() => {})
  }

  watch(isStreaming, (streaming) => {
    if (streaming) {
      preStreamingMood.value = spaceStore.persona.mood
      spaceStore.updatePersona({ mood: 'thinking' })
    } else {
      const restore = preStreamingMood.value && preStreamingMood.value !== 'thinking'
        ? preStreamingMood.value
        : 'active'
      spaceStore.updatePersona({ mood: restore })
      preStreamingMood.value = null
    }
  })

  function setAgentName(name: string) {
    spaceStore.updatePersona({ name })
  }

  function setStatusMessage(msg: string) {
    spaceStore.updatePersona({ statusMessage: msg })
  }

  function setMood(m: AgentMood) {
    spaceStore.updatePersona({ mood: m })
  }

  return {
    persona, agentName, avatarSeed, mood, moodIcon, moodLabel,
    statusMessage, setAgentName, setStatusMessage, setMood,
  }
}
