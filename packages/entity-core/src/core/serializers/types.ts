export interface Serializer {
  readonly id: string
  readonly label: string
  readonly dependsOn: string[]
  collect(): Promise<Record<string, unknown>>
  import(data: Record<string, unknown>, strategy: ImportStrategy): Promise<ImportReportItem | void>
}

export type ImportStrategy = 'overwrite' | 'merge'

export interface ImportReportItem {
  serializerId: string
  total: number
  added: number
  skipped: number
  updated: number
  errors: string[]
}
