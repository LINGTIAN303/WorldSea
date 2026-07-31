import type { LibraryDescriptor, CapabilityDeclaration, Platform } from './capability-types'
import type { ToolDefinition } from '../bridge-types'

export class InternalChainRegistry {
  private libraries = new Map<string, LibraryDescriptor>()
  private capabilities = new Map<string, CapabilityDeclaration>()

  register(descriptor: LibraryDescriptor): void {
    this.libraries.set(descriptor.id, descriptor)
    for (const cap of descriptor.capabilities) {
      this.capabilities.set(cap.id, cap)
    }
  }

  resolve(ids: string[], platform: Platform): ToolDefinition[] {
    const result: ToolDefinition[] = []
    for (const id of ids) {
      const cap = this.capabilities.get(id)
      if (!cap) continue

      if (!cap.availability.platforms.includes(platform)) {
        if (cap.availability.fallback) {
          const fallback = this.capabilities.get(cap.availability.fallback)
          if (fallback && fallback.availability.platforms.includes(platform)) {
            result.push(this.capabilityToTool(fallback))
            continue
          }
        }
        continue
      }

      if (cap.availability.requiresUI && platform === 'cli') continue
      if (cap.availability.requiresPinia && platform === 'cli') continue
      if (cap.availability.requiresWasm && platform === 'cli') continue

      result.push(this.capabilityToTool(cap))
    }
    return result
  }

  getCapabilitiesByLibrary(libraryId: string): CapabilityDeclaration[] {
    const lib = this.libraries.get(libraryId)
    return lib ? [...lib.capabilities] : []
  }

  getCapabilitiesByCategory(category: string): CapabilityDeclaration[] {
    return [...this.capabilities.values()].filter(c => c.category === category)
  }

  getRegisteredLibraryIds(): string[] {
    return [...this.libraries.keys()]
  }

  private capabilityToTool(cap: CapabilityDeclaration): ToolDefinition {
    return {
      name: cap.id.replace(/\./g, '_'),
      description: cap.description,
      parameters: cap.parameters,
      execute: cap.execute,
    }
  }
}
