import { describe, it, expect, vi, beforeEach } from 'vitest'
import { GroupChatEngine } from '../../engine/GroupChatEngine'
import type { IChatStrategy } from '../../engine/IChatStrategy'

// ─── Helper: create a minimal GroupChatEngine with mocked strategy ───

function createEngine(): GroupChatEngine {
  const mockStrategy: IChatStrategy = {
    selectSpeakers: vi.fn().mockReturnValue([]),
    buildSystemPrompt: vi.fn().mockReturnValue(''),
    buildDynamicContext: vi.fn().mockReturnValue(''),
    shouldTerminate: vi.fn().mockReturnValue({ shouldTerminate: false, confidence: 0 }),
    getConfig: vi.fn().mockReturnValue({
      maxRounds: 20,
      maxTotalMessages: 60,
      maxDurationMs: 600000,
      reviewInterval: 5,
      parallelCount: 1,
      autoDegradation: true,
    }),
  }
  return new GroupChatEngine(mockStrategy)
}

// ─── Tests ────────────────────────────────────────────────────────────

describe('GroupChatEngine request tracking', () => {
  let engine: GroupChatEngine

  beforeEach(() => {
    engine = createEngine()
  })

  it('startRequestTrace creates a pending record with correct agentId, agentName, protocol', () => {
    const id = engine.startRequestTrace('agent-1', 'Alice', 'openai-completions')

    const snapshot = engine.getRequestSnapshot()
    const record = snapshot.records.find(r => r.id === id)

    expect(record).toBeDefined()
    expect(record!.agentId).toBe('agent-1')
    expect(record!.agentName).toBe('Alice')
    expect(record!.protocol).toBe('openai-completions')
    expect(record!.status).toBe('pending')
    expect(record!.startTime).toBeTypeOf('number')
    expect(record!.endTime).toBeUndefined()
  })

  it('endRequestTrace marks record as success with latency and tokens', () => {
    const id = engine.startRequestTrace('agent-1', 'Alice')

    // We can't directly set startTime, so we just call endRequestTrace and verify structure
    engine.endRequestTrace(id, 100, 200)

    const snapshot = engine.getRequestSnapshot()
    const record = snapshot.records.find(r => r.id === id)!

    expect(record.status).toBe('success')
    expect(record.latencyMs).toBeTypeOf('number')
    expect(record.inputTokens).toBe(100)
    expect(record.outputTokens).toBe(200)
    expect(record.endTime).toBeTypeOf('number')
  })

  it('failRequestTrace marks record as error with error message', () => {
    const id = engine.startRequestTrace('agent-1', 'Alice')
    engine.failRequestTrace(id, 'Rate limit exceeded')

    const snapshot = engine.getRequestSnapshot()
    const record = snapshot.records.find(r => r.id === id)!

    expect(record.status).toBe('error')
    expect(record.error).toBe('Rate limit exceeded')
    expect(record.latencyMs).toBeTypeOf('number')
    expect(record.endTime).toBeTypeOf('number')
  })

  it('getRequestSnapshot returns correct perAgent stats', () => {
    const id1 = engine.startRequestTrace('agent-1', 'Alice')
    engine.endRequestTrace(id1, 50, 100)

    const id2 = engine.startRequestTrace('agent-1', 'Alice')
    engine.failRequestTrace(id2, 'timeout')

    const id3 = engine.startRequestTrace('agent-2', 'Bob')
    engine.endRequestTrace(id3, 30, 60)

    const snapshot = engine.getRequestSnapshot()

    expect(snapshot.perAgent['agent-1']).toEqual({
      total: 2,
      success: 1,
      errors: 1,
      avgLatencyMs: expect.any(Number),
      lastError: 'timeout',
    })
    expect(snapshot.perAgent['agent-2']).toEqual({
      total: 1,
      success: 1,
      errors: 0,
      avgLatencyMs: expect.any(Number),
    })
  })

  it('getRequestSnapshot calculates average latency correctly', () => {
    // We'll manually verify by checking the latency values
    const id1 = engine.startRequestTrace('agent-1', 'Alice')
    engine.endRequestTrace(id1)

    const id2 = engine.startRequestTrace('agent-1', 'Alice')
    engine.endRequestTrace(id2)

    const snapshot = engine.getRequestSnapshot()
    const completedRecords = snapshot.records.filter(
      r => r.agentId === 'agent-1' && r.status === 'success' && r.latencyMs != null,
    )

    // avgLatencyMs should equal the average of completed records' latencyMs
    const expectedAvg = Math.round(
      completedRecords.reduce((sum, r) => sum + (r.latencyMs ?? 0), 0) / completedRecords.length,
    )
    expect(snapshot.perAgent['agent-1'].avgLatencyMs).toBe(expectedAvg)
  })

  it('clearRequestRecords empties all records', () => {
    engine.startRequestTrace('agent-1', 'Alice')
    engine.startRequestTrace('agent-2', 'Bob')

    expect(engine.getRequestSnapshot().records.length).toBe(2)

    engine.clearRequestRecords()

    const snapshot = engine.getRequestSnapshot()
    expect(snapshot.records).toEqual([])
    expect(snapshot.perAgent).toEqual({})
  })

  it('records are capped at MAX_REQUEST_RECORDS (200)', () => {
    // Add 201 records
    for (let i = 0; i < 201; i++) {
      const id = engine.startRequestTrace('agent-1', 'Alice')
      engine.endRequestTrace(id)
    }

    const snapshot = engine.getRequestSnapshot()
    // After adding 201, the oldest should be trimmed, leaving 200
    expect(snapshot.records.length).toBe(200)
  })

  it('multiple agents tracked independently in perAgent', () => {
    const id1 = engine.startRequestTrace('agent-1', 'Alice')
    engine.endRequestTrace(id1)

    const id2 = engine.startRequestTrace('agent-2', 'Bob')
    engine.failRequestTrace(id2, 'error')

    engine.startRequestTrace('agent-3', 'Charlie')
    // leave as pending

    const snapshot = engine.getRequestSnapshot()

    expect(snapshot.perAgent['agent-1']).toEqual(
      expect.objectContaining({ total: 1, success: 1, errors: 0 }),
    )
    expect(snapshot.perAgent['agent-2']).toEqual(
      expect.objectContaining({ total: 1, success: 0, errors: 1, lastError: 'error' }),
    )
    expect(snapshot.perAgent['agent-3']).toEqual(
      expect.objectContaining({ total: 1, success: 0, errors: 0 }),
    )
  })

  it('endRequestTrace / failRequestTrace with unknown requestId is a no-op', () => {
    // Should not throw
    expect(() => engine.endRequestTrace('nonexistent-id')).not.toThrow()
    expect(() => engine.failRequestTrace('nonexistent-id', 'error')).not.toThrow()

    // No records should be created
    const snapshot = engine.getRequestSnapshot()
    expect(snapshot.records).toEqual([])
    expect(snapshot.perAgent).toEqual({})
  })
})
