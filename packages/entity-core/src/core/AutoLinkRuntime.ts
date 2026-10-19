import { ref } from 'vue'

export type AutoLinkRuntimeEventKind =
  | 'index:start'
  | 'index:end'
  | 'link:add'
  | 'link:resolve'
  | 'decision:record'
  | 'refresh:target'

export interface AutoLinkRuntimeEvent {
  id: number
  kind: AutoLinkRuntimeEventKind
  at: string
  summary: string
  payload?: Record<string, unknown>
}

const MAX_EVENTS = 200
const events = ref<AutoLinkRuntimeEvent[]>([])
const version = ref(0)
let seq = 0

export function recordAutoLinkEvent(
  kind: AutoLinkRuntimeEventKind,
  summary: string,
  payload?: Record<string, unknown>,
): AutoLinkRuntimeEvent {
  seq += 1
  const event: AutoLinkRuntimeEvent = {
    id: seq,
    kind,
    at: new Date().toISOString(),
    summary,
    payload,
  }
  events.value = [event, ...events.value].slice(0, MAX_EVENTS)
  version.value += 1
  return event
}

export function clearAutoLinkEvents(): void {
  events.value = []
  version.value += 1
}

export const autoLinkRuntime = {
  events,
  version,
  clear: clearAutoLinkEvents,
}
