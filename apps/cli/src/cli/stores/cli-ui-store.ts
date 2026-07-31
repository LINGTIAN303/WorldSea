import type { IUIStore } from '@worldsmith/agent-runtime'
import * as readline from 'readline'

export class CliUIStore implements IUIStore {
  async confirm(title: string, message: string): Promise<boolean> {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
    return new Promise((resolve) => {
      rl.question(`${title}: ${message} [y/N] `, (answer) => {
        rl.close()
        resolve(answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes')
      })
    })
  }
}
