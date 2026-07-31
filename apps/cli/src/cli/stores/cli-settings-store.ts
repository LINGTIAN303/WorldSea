import type { ISettingsStore } from '@worldsmith/agent-runtime'
import type { ProviderConfig } from '@worldsmith/agent-runtime'

export class CliSettingsStore implements ISettingsStore {
  private config: ProviderConfig

  constructor(config: ProviderConfig) {
    this.config = config
  }

  getProviderConfig(): ProviderConfig {
    return this.config
  }

  getSearchConfig(): { engine?: string; apiKey?: string } {
    return {}
  }
}
