import { describe, it, expect } from 'vitest'
import { memberToProfile, casualToBackendMsg, backendToCasualMsg } from '../TypeBridge'
import type { GroupMember, GroupChatMessage as FrontendMsg } from '../../types'
import type { GroupChatMessage as BackendMsg } from '@agent/group-chat/types'

// ─── Fixtures ─────────────────────────────────────────────────────────

function createMember(overrides: Partial<GroupMember> = {}): GroupMember {
  return {
    id: 'agent-1',
    name: 'Alice',
    avatar: 'https://example.com/avatar.png',
    color: '#ff0000',
    role: '作家',
    systemPrompt: '你是一位擅长比喻的文学创作者',
    providerConfig: undefined,
    providerSlotId: undefined,
    modelId: undefined,
    speakCount: 0,
    lastSpokeAt: 0,
    groupRole: 'member',
    joinedAt: 1700000000000,
    muted: false,
    lastActiveAt: 1700000000000,
    enabledTools: [],
    enabledSkills: [],
    baseLayerMode: 'auto',
    ...overrides,
  }
}

function createFrontendMsg(overrides: Partial<FrontendMsg> = {}): FrontendMsg {
  return {
    id: 'msg-1',
    role: 'user',
    content: 'Hello!',
    timestamp: 1700000000000,
    type: 'text',
    ...overrides,
  }
}

function createBackendMsg(overrides: Partial<BackendMsg> = {}): BackendMsg {
  return {
    id: 'msg-1',
    role: 'assistant',
    agentId: 'agent-1',
    agentName: 'Alice',
    agentAvatar: 'https://example.com/avatar.png',
    agentColor: '#ff0000',
    content: 'Hi there!',
    timestamp: 1700000000000,
    ...overrides,
  }
}

// ─── Tests ────────────────────────────────────────────────────────────

describe('TypeBridge', () => {
  describe('memberToProfile', () => {
    it('maps id, name, avatar, color, systemPrompt correctly', () => {
      const member = createMember()
      const profile = memberToProfile(member)

      expect(profile.id).toBe('agent-1')
      expect(profile.name).toBe('Alice')
      expect(profile.avatar).toBe('https://example.com/avatar.png')
      expect(profile.color).toBe('#ff0000')
      expect(profile.systemPrompt).toBe('你是一位擅长比喻的文学创作者')
    })

    it('sets enabled = !muted', () => {
      const active = createMember({ muted: false })
      const muted = createMember({ muted: true })

      expect(memberToProfile(active).enabled).toBe(true)
      expect(memberToProfile(muted).enabled).toBe(false)
    })

    it('with muted member sets talkativeness to 0', () => {
      const member = createMember({ muted: true })
      const profile = memberToProfile(member)

      expect(profile.speakingDesire!.talkativeness).toBe(0)
    })

    it('with enabledSkills uses them as expertise', () => {
      const member = createMember({ enabledSkills: ['writing', 'poetry'] })
      const profile = memberToProfile(member)

      expect(profile.personality!.expertise).toEqual(['writing', 'poetry'])
    })

    it('without enabledSkills extracts keywords from systemPrompt', () => {
      const member = createMember({
        enabledSkills: [],
        systemPrompt: '你是一位擅长比喻的文学创作者，关注美感与表达',
      })
      const profile = memberToProfile(member)

      // extractKeywords splits by commas/spaces, filters words > 1 char, takes up to 10
      expect(profile.personality!.expertise!.length).toBeGreaterThan(0)
      for (const kw of profile.personality!.expertise!) {
        expect(kw.length).toBeGreaterThan(1)
      }
    })

    it('with empty systemPrompt and no enabledSkills returns empty expertise', () => {
      const member = createMember({ enabledSkills: [], systemPrompt: '' })
      const profile = memberToProfile(member)

      expect(profile.personality!.expertise).toEqual([])
    })

    it('builds topicAffinities from enabledSkills', () => {
      const member = createMember({ enabledSkills: ['coding', 'debugging'] })
      const profile = memberToProfile(member)

      expect(profile.speakingDesire!.topicAffinities).toEqual({
        coding: 1.2,
        debugging: 1.2,
      })
    })

    it('with no enabledSkills returns empty topicAffinities', () => {
      const member = createMember({ enabledSkills: [] })
      const profile = memberToProfile(member)

      expect(profile.speakingDesire!.topicAffinities).toEqual({})
    })

    it('infers speaking style from role', () => {
      const roles: [string, string][] = [
        ['作家', '文学性，善用比喻'],
        ['科学家', '严谨精确，引用数据'],
        ['艺术家', '感性浪漫，关注美感'],
        ['历史学家', '沉稳厚重，引经据典'],
        ['哲学家', '思辨深邃，追问本质'],
        ['工程师', '务实简洁，关注可行性'],
        ['商人', '精明干练，关注价值'],
      ]

      for (const [role, expected] of roles) {
        const member = createMember({ role })
        expect(memberToProfile(member).personality.speakingStyle).toBe(expected)
      }
    })

    it('falls back to default speaking style for unknown role', () => {
      const member = createMember({ role: '未知角色' })
      const profile = memberToProfile(member)

      expect(profile.personality!.speakingStyle).toBe('自然随性')
    })

    it('sets providerSlotId to empty string', () => {
      const member = createMember()
      const profile = memberToProfile(member)

      expect(profile.providerSlotId).toBe('')
    })

    it('sets createdAt from joinedAt and updatedAt to current ISO string', () => {
      const member = createMember({ joinedAt: 1700000000000 })
      const profile = memberToProfile(member)

      expect(profile.createdAt).toBe(new Date(1700000000000).toISOString())
      expect(profile.updatedAt).toBeTypeOf('string')
      // updatedAt should be a valid ISO date
      expect(new Date(profile.updatedAt).getTime()).not.toBeNaN()
    })

    it('sets baseProbability to 0.3', () => {
      const member = createMember()
      const profile = memberToProfile(member)

      expect(profile.speakingDesire!.baseProbability).toBe(0.3)
    })

    it('with unmuted member sets talkativeness to 1.0', () => {
      const member = createMember({ muted: false })
      const profile = memberToProfile(member)

      expect(profile.speakingDesire!.talkativeness).toBe(1.0)
    })
  })

  describe('casualToBackendMsg', () => {
    it('maps frontend user message correctly', () => {
      const msg = createFrontendMsg({
        role: 'user',
        content: 'Hello!',
        speakerId: 'user-1',
        speakerName: 'Bob',
        speakerAvatar: 'https://example.com/bob.png',
        speakerColor: '#00ff00',
        timestamp: 1700000000000,
      })
      const result = casualToBackendMsg(msg)

      expect(result.id).toBe('msg-1')
      expect(result.role).toBe('user')
      expect(result.agentId).toBe('user-1')
      expect(result.agentName).toBe('Bob')
      expect(result.agentAvatar).toBe('https://example.com/bob.png')
      expect(result.agentColor).toBe('#00ff00')
      expect(result.content).toBe('Hello!')
      expect(result.timestamp).toBe(1700000000000)
    })

    it('converts system role to assistant', () => {
      const msg = createFrontendMsg({ role: 'system' })
      const result = casualToBackendMsg(msg)

      expect(result.role).toBe('assistant')
    })

    it('converts toolResult role to assistant', () => {
      const msg = createFrontendMsg({ role: 'toolResult' })
      const result = casualToBackendMsg(msg)

      expect(result.role).toBe('assistant')
    })

    it('preserves assistant role as-is', () => {
      const msg = createFrontendMsg({ role: 'assistant' })
      const result = casualToBackendMsg(msg)

      expect(result.role).toBe('assistant')
    })

    it('maps speakerId to agentId (null when undefined)', () => {
      const withSpeaker = createFrontendMsg({ speakerId: 'agent-1' })
      const withoutSpeaker = createFrontendMsg({ speakerId: undefined })

      expect(casualToBackendMsg(withSpeaker).agentId).toBe('agent-1')
      expect(casualToBackendMsg(withoutSpeaker).agentId).toBeNull()
    })

    it('preserves metadata (replyTo, type, imageUrl, fileName, fileUrl)', () => {
      const msg = createFrontendMsg({
        type: 'image',
        replyTo: 'msg-0',
        imageUrl: 'https://example.com/img.png',
        fileName: 'report.pdf',
        fileUrl: 'https://example.com/report.pdf',
      })
      const result = casualToBackendMsg(msg)

      expect(result.metadata).toEqual({
        replyTo: 'msg-0',
        type: 'image',
        imageUrl: 'https://example.com/img.png',
        fileName: 'report.pdf',
        fileUrl: 'https://example.com/report.pdf',
      })
    })

    it('preserves thinking and mentions', () => {
      const msg = createFrontendMsg({
        thinking: 'Let me think...',
        mentions: ['agent-2', 'agent-3'],
      })
      const result = casualToBackendMsg(msg)

      expect(result.thinking).toBe('Let me think...')
      expect(result.mentions).toEqual(['agent-2', 'agent-3'])
    })
  })

  describe('backendToCasualMsg', () => {
    it('converts moderator role to system', () => {
      const msg = createBackendMsg({ role: 'moderator' })
      const result = backendToCasualMsg(msg)

      expect(result.role).toBe('system')
    })

    it('preserves user and assistant roles as-is', () => {
      const userMsg = createBackendMsg({ role: 'user' })
      const assistantMsg = createBackendMsg({ role: 'assistant' })

      expect(backendToCasualMsg(userMsg).role).toBe('user')
      expect(backendToCasualMsg(assistantMsg).role).toBe('assistant')
    })

    it('maps agentId to speakerId (undefined when null)', () => {
      const withAgent = createBackendMsg({ agentId: 'agent-1' })
      const withoutAgent = createBackendMsg({ agentId: null })

      expect(backendToCasualMsg(withAgent).speakerId).toBe('agent-1')
      expect(backendToCasualMsg(withoutAgent).speakerId).toBeUndefined()
    })

    it('extracts type from metadata, defaults to text', () => {
      const withType = createBackendMsg({ metadata: { type: 'image' } })
      const withoutMetadata = createBackendMsg({ metadata: undefined })

      expect(backendToCasualMsg(withType).type).toBe('image')
      expect(backendToCasualMsg(withoutMetadata).type).toBe('text')
    })

    it('maps agent fields to speaker fields', () => {
      const msg = createBackendMsg({
        agentName: 'Alice',
        agentAvatar: 'https://example.com/avatar.png',
        agentColor: '#ff0000',
      })
      const result = backendToCasualMsg(msg)

      expect(result.speakerName).toBe('Alice')
      expect(result.speakerAvatar).toBe('https://example.com/avatar.png')
      expect(result.speakerColor).toBe('#ff0000')
    })

    it('extracts replyTo, imageUrl, fileName, fileUrl from metadata', () => {
      const msg = createBackendMsg({
        metadata: {
          replyTo: 'msg-0',
          imageUrl: 'https://example.com/img.png',
          fileName: 'report.pdf',
          fileUrl: 'https://example.com/report.pdf',
        },
      })
      const result = backendToCasualMsg(msg)

      expect(result.replyTo).toBe('msg-0')
      expect(result.imageUrl).toBe('https://example.com/img.png')
      expect(result.fileName).toBe('report.pdf')
      expect(result.fileUrl).toBe('https://example.com/report.pdf')
    })

    it('returns undefined for metadata fields when metadata is missing', () => {
      const msg = createBackendMsg({ metadata: undefined })
      const result = backendToCasualMsg(msg)

      expect(result.replyTo).toBeUndefined()
      expect(result.imageUrl).toBeUndefined()
      expect(result.fileName).toBeUndefined()
      expect(result.fileUrl).toBeUndefined()
    })

    it('preserves thinking and mentions', () => {
      const msg = createBackendMsg({
        thinking: 'Deep thought',
        mentions: ['agent-2'],
      })
      const result = backendToCasualMsg(msg)

      expect(result.thinking).toBe('Deep thought')
      expect(result.mentions).toEqual(['agent-2'])
    })
  })

  describe('round-trip: casualToBackendMsg → backendToCasualMsg', () => {
    it('preserves core fields for an assistant message', () => {
      const original = createFrontendMsg({
        role: 'assistant',
        content: 'Round trip test',
        speakerId: 'agent-1',
        speakerName: 'Alice',
        speakerAvatar: 'https://example.com/a.png',
        speakerColor: '#ff0000',
        timestamp: 1700000000000,
        type: 'text',
        mentions: ['agent-2'],
        thinking: 'hmm',
      })

      const backend = casualToBackendMsg(original)
      const roundTripped = backendToCasualMsg(backend)

      expect(roundTripped.id).toBe(original.id)
      expect(roundTripped.content).toBe(original.content)
      expect(roundTripped.speakerId).toBe(original.speakerId)
      expect(roundTripped.speakerName).toBe(original.speakerName)
      expect(roundTripped.speakerAvatar).toBe(original.speakerAvatar)
      expect(roundTripped.speakerColor).toBe(original.speakerColor)
      expect(roundTripped.timestamp).toBe(original.timestamp)
      expect(roundTripped.type).toBe(original.type)
      expect(roundTripped.mentions).toEqual(original.mentions)
      expect(roundTripped.thinking).toBe(original.thinking)
    })

    it('preserves metadata fields through round-trip', () => {
      const original = createFrontendMsg({
        role: 'assistant',
        type: 'image',
        replyTo: 'msg-0',
        imageUrl: 'https://example.com/img.png',
        fileName: 'photo.jpg',
        fileUrl: 'https://example.com/photo.jpg',
      })

      const roundTripped = backendToCasualMsg(casualToBackendMsg(original))

      expect(roundTripped.type).toBe('image')
      expect(roundTripped.replyTo).toBe('msg-0')
      expect(roundTripped.imageUrl).toBe('https://example.com/img.png')
      expect(roundTripped.fileName).toBe('photo.jpg')
      expect(roundTripped.fileUrl).toBe('https://example.com/photo.jpg')
    })

    it('preserves user role through round-trip', () => {
      const original = createFrontendMsg({ role: 'user' })
      const roundTripped = backendToCasualMsg(casualToBackendMsg(original))

      expect(roundTripped.role).toBe('user')
    })

    it('system role becomes assistant after round-trip (lossy conversion)', () => {
      const original = createFrontendMsg({ role: 'system' })
      const roundTripped = backendToCasualMsg(casualToBackendMsg(original))

      // system → assistant (backend has no system role), stays assistant on way back
      expect(roundTripped.role).toBe('assistant')
    })

    it('preserves null/undefined speakerId through round-trip', () => {
      const original = createFrontendMsg({ speakerId: undefined })
      const roundTripped = backendToCasualMsg(casualToBackendMsg(original))

      expect(roundTripped.speakerId).toBeUndefined()
    })
  })
})
