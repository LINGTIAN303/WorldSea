export interface EventBus {
  emit(event: string, ...args: any[]): void
  on(event: string, handler: (...args: any[]) => void): void
  off(event: string, handler: (...args: any[]) => void): void
}

export interface ValidationApi {
  validateEntity?(type: string, data: any): Promise<any>
  checkReferences?(entitiesJson: string, relationsJson: string): Promise<any>
  getBackendType(): 'tauri' | 'wasm' | 'none'
}

export interface ToastApi {
  success(message: string): void
  error(message: string): void
  warn(message: string): void
  info(message: string): void
}

export interface ConfirmApi {
  confirm(options: { type?: string; title: string; description?: string; confirmText?: string; cancelText?: string }): Promise<boolean>
}

export interface DialogApi {
  confirm(message: string, title?: string): Promise<boolean>
  prompt(message: string, title?: string, defaultValue?: string): Promise<string | null>
}

export type HighlightDimmingMode = 'simple' | 'spread'

export interface SettingsApi {
  autoCreateEntityEnabled: boolean
  autoCreateEntityRefEnabled: boolean
  /** 关系选择器建实体入口门控（2026-10-07 接入） */
  autoCreateSelectorEnabled: boolean
  undoHistoryLimit: number
  highlight_spreadHops: number
  highlight_dimmingEnabled: boolean
  highlight_dimmingMode?: HighlightDimmingMode
  highlight_dimOpacity?: number
  highlight_pulseEnabled?: boolean
}

const noopEventBus: EventBus = {
  emit() {},
  on() {},
  off() {},
}

const noopValidationApi: ValidationApi = {
  getBackendType: () => 'none',
}

const noopToastApi: ToastApi = {
  success() {},
  error() {},
  warn() {},
  info() {},
}

const noopConfirmApi: ConfirmApi = {
  confirm: async () => false,
}

const noopDialogApi: DialogApi = {
  confirm: async () => false,
  prompt: async () => null,
}

const noopSettingsApi: SettingsApi = {
  get autoCreateEntityEnabled() { return false },
  get autoCreateEntityRefEnabled() { return false },
  get autoCreateSelectorEnabled() { return false },
  get undoHistoryLimit() { return 20 },
  get highlight_spreadHops() { return 3 },
  get highlight_dimmingEnabled() { return false },
  get highlight_dimmingMode() { return 'spread' as const },
  get highlight_dimOpacity() { return 0.25 },
  get highlight_pulseEnabled() { return true },
}

let _eventBus: EventBus | null = null
let _validationApi: ValidationApi | null = null
let _toastApi: ToastApi | null = null
let _confirmApi: ConfirmApi | null = null
let _dialogApi: DialogApi | null = null
let _settingsApi: SettingsApi | null = null

export function registerEventBus(api: EventBus): void {
  _eventBus = api
}

export function getEventBus(): EventBus {
  return _eventBus ?? noopEventBus
}

export function registerValidationApi(api: ValidationApi): void {
  _validationApi = api
}

export function getValidationApi(): ValidationApi {
  return _validationApi ?? noopValidationApi
}

export function registerToastApi(api: ToastApi): void {
  _toastApi = api
}

export function getToastApi(): ToastApi {
  return _toastApi ?? noopToastApi
}

export function registerConfirmApi(api: ConfirmApi): void {
  _confirmApi = api
}

export function getConfirmApi(): ConfirmApi {
  return _confirmApi ?? noopConfirmApi
}

export function registerDialogApi(api: DialogApi): void {
  _dialogApi = api
}

export function getDialogApi(): DialogApi {
  return _dialogApi ?? noopDialogApi
}

export function registerSettingsApi(api: SettingsApi): void {
  _settingsApi = api
}

export function getSettingsApi(): SettingsApi {
  return _settingsApi ?? noopSettingsApi
}
