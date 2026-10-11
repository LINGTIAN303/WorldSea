class InverseRegistry {
  private map = new Map<string, string>()

  register(type: string, inverseType: string): void {
    this.map.set(type, inverseType)
  }

  getInverse(type: string): string | undefined {
    return this.map.get(type)
  }

  isSymmetric(type: string): boolean {
    const inv = this.map.get(type)
    return inv === type
  }

  hasInverse(type: string): boolean {
    return this.map.has(type)
  }

  unregister(type: string): void {
    this.map.delete(type)
  }

  entries(): IterableIterator<[string, string]> {
    return this.map.entries()
  }
}

export const inverseRegistry = new InverseRegistry()
