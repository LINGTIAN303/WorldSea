import { describe, it, expect } from 'vitest'
import { type QuantizedVectorRecord, packRecords, unpackRecords } from '../embedding/quantizer.worker'

describe('quantizer-worker helpers', () => {
  it('packRecords 应将记录序列化为可传输格式', () => {
    const records: QuantizedVectorRecord[] = [
      {
        id: 'test_1',
        collection: 'entities',
        data: new Int8Array([1, -2, 3]),
        scale: 0.01,
        offset: 0.5,
        metadata: { name: 'Test' },
      },
    ]
    const packed = packRecords(records)
    expect(packed).toBeDefined()
    expect(packed.ids).toHaveLength(1)
    expect(packed.ids[0]).toBe('test_1')
    expect(packed.dim).toBe(3)
    expect(packed.count).toBe(1)

    const unpacked = unpackRecords(packed)
    expect(unpacked.length).toBe(1)
    expect(unpacked[0].id).toBe('test_1')
    expect(unpacked[0].data).toBeInstanceOf(Int8Array)
    expect(unpacked[0].data[0]).toBe(1)
  })

  it('unpackRecords(packRecords(x)) 应无损还原', () => {
    // 同一批打包的记录维度必须一致
    const records: QuantizedVectorRecord[] = [
      {
        id: 'a',
        collection: 'entities',
        data: new Int8Array([127, -127, 0, 50]),
        scale: 0.005,
        offset: -0.3,
        metadata: { entityId: 'e1' },
      },
      {
        id: 'b',
        collection: 'memory',
        data: new Int8Array([10, -10, 20, 5]),
        scale: 0.02,
        offset: 0.1,
        metadata: {},
      },
    ]
    const packed = packRecords(records)
    const unpacked = unpackRecords(packed)
    expect(unpacked.length).toBe(2)
    for (let i = 0; i < records.length; i++) {
      expect(unpacked[i].id).toBe(records[i].id)
      expect(unpacked[i].collection).toBe(records[i].collection)
      // Float32Array 存储会有浮点精度损失，使用 toBeCloseTo 比较
      expect(unpacked[i].scale).toBeCloseTo(records[i].scale, 6)
      expect(unpacked[i].offset).toBeCloseTo(records[i].offset, 6)
      expect(unpacked[i].data.length).toBe(records[i].data.length)
      for (let j = 0; j < records[i].data.length; j++) {
        expect(unpacked[i].data[j]).toBe(records[i].data[j])
      }
      // 元数据也应无损还原
      expect(unpacked[i].metadata).toEqual(records[i].metadata)
    }
  })

  it('不同维度的多条记录应正确打包和解包', () => {
    // 第一组：4 维向量
    const group1: QuantizedVectorRecord[] = [
      {
        id: 'g1_a',
        collection: 'entities',
        data: new Int8Array([1, 2, 3, 4]),
        scale: 0.01,
        offset: 0.0,
        metadata: { group: 1 },
      },
      {
        id: 'g1_b',
        collection: 'entities',
        data: new Int8Array([-1, -2, -3, -4]),
        scale: 0.02,
        offset: 0.5,
        metadata: { group: 1 },
      },
    ]

    const packed1 = packRecords(group1)
    const unpacked1 = unpackRecords(packed1)

    expect(unpacked1.length).toBe(2)
    expect(unpacked1[0].data.length).toBe(4)
    expect(unpacked1[1].data.length).toBe(4)
    expect(Array.from(unpacked1[0].data)).toEqual([1, 2, 3, 4])
    expect(Array.from(unpacked1[1].data)).toEqual([-1, -2, -3, -4])

    // 第二组：8 维向量
    const group2: QuantizedVectorRecord[] = [
      {
        id: 'g2_a',
        collection: 'memory',
        data: new Int8Array([10, 20, 30, 40, 50, 60, 70, 80]),
        scale: 0.003,
        offset: -1.0,
        metadata: { group: 2, label: '八维测试' },
      },
    ]

    const packed2 = packRecords(group2)
    const unpacked2 = unpackRecords(packed2)

    expect(unpacked2.length).toBe(1)
    expect(unpacked2[0].data.length).toBe(8)
    expect(unpacked2[0].scale).toBeCloseTo(0.003)
    expect(unpacked2[0].offset).toBeCloseTo(-1.0)
    expect(unpacked2[0].metadata.label).toBe('八维测试')
    expect(Array.from(unpacked2[0].data)).toEqual([10, 20, 30, 40, 50, 60, 70, 80])
  })

  it('空记录数组应安全处理', () => {
    const packed = packRecords([])
    expect(packed.count).toBe(0)
    expect(packed.dim).toBe(0)
    expect(packed.ids).toHaveLength(0)

    const unpacked = unpackRecords(packed)
    expect(unpacked).toEqual([])
  })
})
