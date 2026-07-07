export interface GifFrame {
  width: number
  height: number
  data: Uint8ClampedArray
  delay: number
  left?: number
  top?: number
  disposal?: number
}

export interface GifEncodeOptions {
  width: number
  height: number
  frames: GifFrame[]
  loop?: number
  background?: number
  transparentIndex?: number
}

class ByteWriter {
  private buf: number[] = []
  writeByte(b: number) { this.buf.push(b & 0xff) }
  writeBytes(arr: Uint8Array | number[]) { for (const b of arr) this.buf.push(b & 0xff) }
  writeShort(v: number) { this.buf.push(v & 0xff); this.buf.push((v >> 8) & 0xff) }
  writeString(s: string) { for (let i = 0; i < s.length; i++) this.buf.push(s.charCodeAt(i)) }
  toBuffer(): Uint8Array { return new Uint8Array(this.buf) }
}

class LzwEncoder {
  private buf: number[] = []
  private remaining = 0
  private curByte = 0
  private codeSize = 0
  private nextCode = 0
  private maxCode = 0
  private dict = new Map<number, number>()

  encode(pixels: Uint8ClampedArray, colorDepth: number): Uint8Array {
    const minCodeSize = Math.max(2, colorDepth)
    this.buf = []
    this.curByte = 0
    this.remaining = 0
    this.codeSize = minCodeSize + 1
    this.nextCode = (1 << minCodeSize) + 2
    this.maxCode = 1 << this.codeSize
    this.dict.clear()

    this.buf.push(minCodeSize)

    const clearCode = 1 << minCodeSize
    const eoiCode = clearCode + 1

    this.writeCode(clearCode)

    let prev = -1
    for (let i = 0; i < pixels.length; i++) {
      const idx = pixels[i]
      if (prev === -1) {
        prev = idx
        continue
      }
      const key = (prev << 16) | idx
      const found = this.dict.get(key)
      if (found !== undefined) {
        prev = found
      } else {
        this.writeCode(prev)
        if (this.nextCode < 4096) {
          this.dict.set(key, this.nextCode++)
          if (this.nextCode > this.maxCode && this.codeSize < 12) {
            this.codeSize++
            this.maxCode = 1 << this.codeSize
          }
        } else {
          this.writeCode(clearCode)
          this.codeSize = minCodeSize + 1
          this.nextCode = (1 << minCodeSize) + 2
          this.maxCode = 1 << this.codeSize
          this.dict.clear()
        }
        prev = idx
      }
    }

    if (prev !== -1) this.writeCode(prev)
    this.writeCode(eoiCode)
    this.flushBits()

    return new Uint8Array(this.buf)
  }

  private writeCode(code: number) {
    let cur = code
    let n = this.codeSize
    while (n > 0) {
      const take = Math.min(n, 8 - this.remaining)
      this.curByte |= (cur & ((1 << take) - 1)) << this.remaining
      this.remaining += take
      n -= take
      cur >>= take
      if (this.remaining === 8) {
        this.buf.push(this.curByte)
        this.curByte = 0
        this.remaining = 0
      }
    }
  }

  private flushBits() {
    if (this.remaining > 0) {
      this.buf.push(this.curByte)
      this.curByte = 0
      this.remaining = 0
    }
    this.buf.push(0)
  }
}

function quantize(r: number, g: number, b: number, a: number, levels: number): number {
  if (a < 128) return 0
  const step = 256 / levels
  const ri = Math.min(levels - 1, Math.floor(r / step))
  const gi = Math.min(levels - 1, Math.floor(g / step))
  const bi = Math.min(levels - 1, Math.floor(b / step))
  return 1 + ri * levels * levels + gi * levels + bi
}

function buildPalette(levels: number): [number, number, number][] {
  const size = 1 + levels * levels * levels
  const palette: [number, number, number][] = new Array(size)
  palette[0] = [0, 0, 0]
  const step = 256 / levels
  let idx = 1
  for (let r = 0; r < levels; r++) {
    for (let g = 0; g < levels; g++) {
      for (let b = 0; b < levels; b++) {
        palette[idx++] = [
          Math.min(255, Math.round(r * step + step / 2)),
          Math.min(255, Math.round(g * step + step / 2)),
          Math.min(255, Math.round(b * step + step / 2)),
        ]
      }
    }
  }
  while (idx < 256) {
    palette[idx++] = [0, 0, 0]
  }
  return palette
}

function subBlockSplit(data: Uint8Array): number[] {
  const out: number[] = []
  let offset = 0
  while (offset < data.length) {
    const chunkSize = Math.min(255, data.length - offset)
    out.push(chunkSize)
    for (let i = 0; i < chunkSize; i++) out.push(data[offset++])
  }
  out.push(0)
  return out
}

export function encodeGif(opts: GifEncodeOptions): Uint8Array {
  const { width, height, frames, loop = 0, transparentIndex } = opts
  if (!frames.length) throw new Error('No frames')

  const w = new ByteWriter()
  const levels = 6
  const palette = buildPalette(levels)
  const colorDepth = 7
  const paletteSize = 1 << colorDepth

  w.writeString('GIF89a')
  w.writeShort(width)
  w.writeShort(height)
  w.writeByte(0x80 | (colorDepth - 1))
  w.writeByte(0)
  w.writeByte(0)

  for (let i = 0; i < paletteSize; i++) {
    if (i < palette.length) {
      w.writeByte(palette[i][0])
      w.writeByte(palette[i][1])
      w.writeByte(palette[i][2])
    } else {
      w.writeByte(0)
      w.writeByte(0)
      w.writeByte(0)
    }
  }

  if (loop !== -1) {
    w.writeByte(0x21)
    w.writeByte(0xff)
    w.writeByte(11)
    w.writeString('NETSCAPE2.0')
    w.writeByte(3)
    w.writeByte(1)
    w.writeShort(loop)
    w.writeByte(0)
  }

  for (const frame of frames) {
    const delayCs = Math.round(frame.delay / 10)

    w.writeByte(0x21)
    w.writeByte(0xf9)
    w.writeByte(4)
    const hasTransparent = transparentIndex !== undefined
    const disposal = frame.disposal ?? 0
    const packed = (disposal << 2) | (hasTransparent ? 0x01 : 0x00)
    w.writeByte(packed)
    w.writeShort(delayCs)
    w.writeByte(hasTransparent ? transparentIndex! : 0)
    w.writeByte(0)

    w.writeByte(0x2c)
    w.writeShort(frame.left ?? 0)
    w.writeShort(frame.top ?? 0)
    w.writeShort(frame.width)
    w.writeShort(frame.height)
    w.writeByte(0)

    const indexed = new Uint8ClampedArray(frame.width * frame.height)
    for (let i = 0; i < indexed.length; i++) {
      const si = i * 4
      indexed[i] = quantize(
        frame.data[si],
        frame.data[si + 1],
        frame.data[si + 2],
        frame.data[si + 3],
        levels,
      )
    }

    const encoder = new LzwEncoder()
    const compressed = encoder.encode(indexed, colorDepth)
    const blocks = subBlockSplit(compressed)
    for (const b of blocks) w.writeByte(b)
  }

  w.writeByte(0x3b)
  return w.toBuffer()
}

export function gifFrameFromCanvas(
  canvas: HTMLCanvasElement,
  delay: number,
): GifFrame {
  const ctx = canvas.getContext('2d')!
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
  return {
    width: canvas.width,
    height: canvas.height,
    data: imageData.data,
    delay,
  }
}
