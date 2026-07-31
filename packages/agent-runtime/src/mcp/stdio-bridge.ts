export class StdioBridge {
  async spawnServer(serverId: string, command: string, args: string[]): Promise<void> {
    const { invoke } = await import('@tauri-apps/api/core')
    await invoke('cmd_mcp_spawn', { serverId, command, args })
  }

  async killServer(serverId: string): Promise<void> {
    const { invoke } = await import('@tauri-apps/api/core')
    await invoke('cmd_mcp_kill', { serverId })
  }

  async listServers(): Promise<string[]> {
    const { invoke } = await import('@tauri-apps/api/core')
    return invoke<string[]>('cmd_mcp_list')
  }

  isAvailable(): boolean {
    return typeof window !== 'undefined' && ('__TAURI_INTERNALS__' in window || '__TAURI__' in window)
  }
}
