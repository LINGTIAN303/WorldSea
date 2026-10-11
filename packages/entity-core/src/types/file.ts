export interface ProjectFile {
  id: string
  name: string
  path: string
  mimeType: string
  size: number
  entityId?: string
  tags: string[]
  createdAt: string
  updatedAt: string
}

export interface ProjectFileContent {
  id: string
  textContent?: string
  binaryData?: string
}
