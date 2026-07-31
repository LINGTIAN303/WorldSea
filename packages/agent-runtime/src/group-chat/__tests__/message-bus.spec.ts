import { describe, it, expect, vi } from 'vitest'
import { GroupChatMessageBus } from '../message-bus'
import type { GroupChatMessage } from '../types'

function makeMessage(overrides: Partial<GroupChatMessage> = {}): GroupChatMessage {
  return {
    id: '1',
    role: 'user',
    agentId: null,
    content: 'hello',
    timestamp: Date.now(),
    ...overrides,
  }
}

describe('GroupChatMessageBus', () => {
  describe('subscribe / unsubscribe', () => {
    it('subscribe adds a listener and returns an unsubscribe function', () => {
      const bus = new GroupChatMessageBus()
      const listener = vi.fn()
      const unsubscribe = bus.subscribe(listener)

      expect(typeof unsubscribe).toBe('function')

      bus.emit({ type: 'user_message', content: 'hi' })
      expect(listener).toHaveBeenCalledTimes(1)
    })

    it('unsubscribe removes the listener so it no longer receives events', () => {
      const bus = new GroupChatMessageBus()
      const listener = vi.fn()
      const unsubscribe = bus.subscribe(listener)

      unsubscribe()

      bus.emit({ type: 'user_message', content: 'hi' })
      expect(listener).not.toHaveBeenCalled()
    })
  })

  describe('emit', () => {
    it('sends events to all subscribed listeners', () => {
      const bus = new GroupChatMessageBus()
      const listener1 = vi.fn()
      const listener2 = vi.fn()

      bus.subscribe(listener1)
      bus.subscribe(listener2)

      const event = { type: 'user_message' as const, content: 'hi' }
      bus.emit(event)

      expect(listener1).toHaveBeenCalledWith(event)
      expect(listener2).toHaveBeenCalledWith(event)
    })

    it('emits user_message events', () => {
      const bus = new GroupChatMessageBus()
      const listener = vi.fn()
      bus.subscribe(listener)

      const event = { type: 'user_message' as const, content: 'hello', mentions: ['agent1'] }
      bus.emit(event)

      expect(listener).toHaveBeenCalledWith(event)
    })

    it('emits agent_start events', () => {
      const bus = new GroupChatMessageBus()
      const listener = vi.fn()
      bus.subscribe(listener)

      const event = { type: 'agent_start' as const, agentId: 'a1' }
      bus.emit(event)

      expect(listener).toHaveBeenCalledWith(event)
    })

    it('emits agent_streaming events', () => {
      const bus = new GroupChatMessageBus()
      const listener = vi.fn()
      bus.subscribe(listener)

      const event = { type: 'agent_streaming' as const, agentId: 'a1', delta: 'hel', thinking: 'hmm' }
      bus.emit(event)

      expect(listener).toHaveBeenCalledWith(event)
    })

    it('emits agent_message events', () => {
      const bus = new GroupChatMessageBus()
      const listener = vi.fn()
      bus.subscribe(listener)

      const event = { type: 'agent_message' as const, agentId: 'a1', content: 'world' }
      bus.emit(event)

      expect(listener).toHaveBeenCalledWith(event)
    })

    it('emits agent_end events', () => {
      const bus = new GroupChatMessageBus()
      const listener = vi.fn()
      bus.subscribe(listener)

      const event = { type: 'agent_end' as const, agentId: 'a1' }
      bus.emit(event)

      expect(listener).toHaveBeenCalledWith(event)
    })

    it('emits moderator_decision events', () => {
      const bus = new GroupChatMessageBus()
      const listener = vi.fn()
      bus.subscribe(listener)

      const event = { type: 'moderator_decision' as const, nextSpeakers: ['a1'], reason: 'test' }
      bus.emit(event)

      expect(listener).toHaveBeenCalledWith(event)
    })

    it('emits turn_complete events', () => {
      const bus = new GroupChatMessageBus()
      const listener = vi.fn()
      bus.subscribe(listener)

      const event = { type: 'turn_complete' as const }
      bus.emit(event)

      expect(listener).toHaveBeenCalledWith(event)
    })

    it('emits error events', () => {
      const bus = new GroupChatMessageBus()
      const listener = vi.fn()
      bus.subscribe(listener)

      const event = { type: 'error' as const, agentId: 'a1', error: 'oops' }
      bus.emit(event)

      expect(listener).toHaveBeenCalledWith(event)
    })

    it('emits error events with null agentId', () => {
      const bus = new GroupChatMessageBus()
      const listener = vi.fn()
      bus.subscribe(listener)

      const event = { type: 'error' as const, agentId: null, error: 'unknown' }
      bus.emit(event)

      expect(listener).toHaveBeenCalledWith(event)
    })

    it('multiple subscribers all receive events', () => {
      const bus = new GroupChatMessageBus()
      const listeners = [vi.fn(), vi.fn(), vi.fn()]
      listeners.forEach(l => bus.subscribe(l))

      const event = { type: 'turn_complete' as const }
      bus.emit(event)

      listeners.forEach(l => {
        expect(l).toHaveBeenCalledWith(event)
      })
    })
  })

  describe('appendMessage / getHistory', () => {
    it('appendMessage adds to history', () => {
      const bus = new GroupChatMessageBus()
      const msg = makeMessage({ id: '1', content: 'first' })

      bus.appendMessage(msg)

      const history = bus.getHistory()
      expect(history).toHaveLength(1)
      expect(history[0]).toEqual(msg)
    })

    it('getHistory returns all messages when no limit', () => {
      const bus = new GroupChatMessageBus()
      const msgs = [
        makeMessage({ id: '1', content: 'a' }),
        makeMessage({ id: '2', content: 'b' }),
        makeMessage({ id: '3', content: 'c' }),
      ]

      msgs.forEach(m => bus.appendMessage(m))

      const history = bus.getHistory()
      expect(history).toHaveLength(3)
      expect(history).toEqual(msgs)
    })

    it('getHistory with limit returns last N messages', () => {
      const bus = new GroupChatMessageBus()
      const msgs = [
        makeMessage({ id: '1', content: 'a' }),
        makeMessage({ id: '2', content: 'b' }),
        makeMessage({ id: '3', content: 'c' }),
        makeMessage({ id: '4', content: 'd' }),
        makeMessage({ id: '5', content: 'e' }),
      ]

      msgs.forEach(m => bus.appendMessage(m))

      const history = bus.getHistory(2)
      expect(history).toHaveLength(2)
      expect(history[0].id).toBe('4')
      expect(history[1].id).toBe('5')
    })

    it('getHistory returns a copy and does not expose internal array', () => {
      const bus = new GroupChatMessageBus()
      bus.appendMessage(makeMessage())

      const history1 = bus.getHistory()
      const history2 = bus.getHistory()

      expect(history1).not.toBe(history2)
    })
  })

  describe('clearHistory', () => {
    it('empties history', () => {
      const bus = new GroupChatMessageBus()
      bus.appendMessage(makeMessage())
      bus.appendMessage(makeMessage())

      bus.clearHistory()

      expect(bus.getHistory()).toHaveLength(0)
    })
  })

  describe('buildConversationContext', () => {
    it('returns empty string with empty history', () => {
      const bus = new GroupChatMessageBus()

      expect(bus.buildConversationContext()).toBe('')
    })

    it('formats user messages with "用户" prefix', () => {
      const bus = new GroupChatMessageBus()
      bus.appendMessage(makeMessage({ role: 'user', content: 'hi there' }))

      const context = bus.buildConversationContext()

      expect(context).toBe('[用户]: hi there')
    })

    it('formats moderator messages with "[主持人]" prefix', () => {
      const bus = new GroupChatMessageBus()
      bus.appendMessage(makeMessage({ role: 'moderator', content: 'next is agent1' }))

      const context = bus.buildConversationContext()

      expect(context).toBe('[[主持人]]: next is agent1')
    })

    it('formats assistant messages with agentName prefix', () => {
      const bus = new GroupChatMessageBus()
      bus.appendMessage(makeMessage({ role: 'assistant', agentName: 'Alice', content: 'hello' }))

      const context = bus.buildConversationContext()

      expect(context).toBe('[Alice]: hello')
    })

    it('formats assistant messages with "Agent" when agentName is undefined', () => {
      const bus = new GroupChatMessageBus()
      bus.appendMessage(makeMessage({ role: 'assistant', agentName: undefined, content: 'hi' }))

      const context = bus.buildConversationContext()

      expect(context).toBe('[Agent]: hi')
    })

    it('respects maxMessages limit', () => {
      const bus = new GroupChatMessageBus()
      for (let i = 1; i <= 5; i++) {
        bus.appendMessage(makeMessage({ id: String(i), role: 'user', content: `msg${i}` }))
      }

      const context = bus.buildConversationContext(3)

      expect(context).toBe(
        '[用户]: msg3\n[用户]: msg4\n[用户]: msg5'
      )
    })

    it('joins multiple messages with newlines', () => {
      const bus = new GroupChatMessageBus()
      bus.appendMessage(makeMessage({ role: 'user', content: 'hello' }))
      bus.appendMessage(makeMessage({ role: 'assistant', agentName: 'Bot', content: 'world' }))

      const context = bus.buildConversationContext()

      expect(context).toBe('[用户]: hello\n[Bot]: world')
    })
  })
})
