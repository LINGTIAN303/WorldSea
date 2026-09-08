<template>
  <div class="user-profile-popover">
    <div class="popover-header">
      <div class="profile-avatar">
        <AvatarBadge
          brand
          :avatar="userProfileStore.profile.avatar"
          :name="userProfileStore.profile.nickname"
          color="linear-gradient(135deg, #10b981, #34d399)"
          :size="48"
        />
        <span class="status-dot" :style="{ background: userProfileStore.statusColor }"></span>
        <div class="avatar-actions">
          <button class="avatar-action-btn" @click="avatarInputRef?.click()" title="上传头像"><WsIcon name="image" size="xs" /></button>
          <button v-if="isImageAvatar(userProfileStore.profile.avatar)" class="avatar-action-btn" @click="onClearAvatar" title="清除头像"><WsIcon name="x" size="xs" /></button>
        </div>
        <input ref="avatarInputRef" type="file" accept="image/*" class="avatar-file-input" @change="onAvatarFileChange" />
      </div>
      <div class="profile-info">
        <div v-if="!editingNickname" class="nickname-row" @dblclick="startEditNickname">
          <span class="nickname">{{ userProfileStore.profile.nickname }}</span>
          <button class="edit-btn" @click="startEditNickname" title="编辑昵称"><WsIcon name="pencil" size="xs" /></button>
        </div>
        <div v-else class="nickname-edit">
          <input
            ref="nicknameInputRef"
            v-model="editNickname"
            class="nickname-input"
            maxlength="20"
            @keyup.enter="submitNickname"
            @keyup.esc="cancelNickname"
            @blur="submitNickname"
          />
        </div>
        <span class="status-label" :style="{ color: userProfileStore.statusColor }">{{ userProfileStore.statusLabel }}</span>
      </div>
    </div>

    <div class="section-label">状态</div>
    <div class="status-list">
      <button
        v-for="(cfg, key) in statusConfig"
        :key="key"
        class="status-item"
        :class="{ active: userProfileStore.profile.status === key }"
        @click="onSetStatus(key as UserStatus)"
      >
        <span class="status-dot-preview" :style="{ background: cfg.color }"></span>
        <span class="status-item-label">{{ cfg.label }}</span>
        <span v-if="userProfileStore.profile.status === key" class="status-check">✓</span>
      </button>
    </div>

    <div class="section-label">自定义状态</div>
    <div class="custom-status-row">
      <input
        v-model="customStatusText"
        class="custom-status-input"
        placeholder="例如：写代码中..."
        maxlength="30"
        @keyup.enter="onSetCustomStatus"
      />
      <button class="custom-status-set-btn" @click="onSetCustomStatus" :disabled="!customStatusText.trim()">设置</button>
      <button v-if="userProfileStore.profile.customStatus" class="custom-status-clear-btn" @click="onClearCustomStatus">清除</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, nextTick } from 'vue'
import { useUserProfileStore, STATUS_CONFIG, type UserStatus } from '../stores/user-profile-store'
import { WsIcon } from '@worldsea/ui-kit'
import AvatarBadge from '@/ui/AvatarBadge.vue'
import { isImageAvatar, isAvatarRef, getAvatarRefId } from '@/ui/avatar'
import { uploadAvatarFromFile, deleteAvatar } from '@/composables/avatarStore'

const emit = defineEmits<{ close: [] }>()

const userProfileStore = useUserProfileStore()
const avatarInputRef = ref<HTMLInputElement>()
const statusConfig = STATUS_CONFIG

async function onAvatarFileChange(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  try {
    const newAvatar = await uploadAvatarFromFile(file, userProfileStore.profile.avatar)
    userProfileStore.updateProfile({ avatar: newAvatar })
  } catch (err) {
    console.warn('[UserProfilePopover] 头像上传失败:', err)
  }
  input.value = ''
}

function onClearAvatar() {
  const old = userProfileStore.profile.avatar
  if (isAvatarRef(old)) {
    const id = getAvatarRefId(old)
    if (id) deleteAvatar(id)
  }
  userProfileStore.updateProfile({ avatar: '' })
}

const editingNickname = ref(false)
const editNickname = ref('')
const nicknameInputRef = ref<HTMLInputElement>()
const customStatusText = ref(userProfileStore.profile.customStatus)

function startEditNickname() {
  editingNickname.value = true
  editNickname.value = userProfileStore.profile.nickname
  nextTick(() => {
    nicknameInputRef.value?.focus()
    nicknameInputRef.value?.select()
  })
}

function submitNickname() {
  if (!editingNickname.value) return
  const val = editNickname.value.trim()
  if (val) {
    userProfileStore.updateProfile({ nickname: val })
  }
  editingNickname.value = false
}

function cancelNickname() {
  editingNickname.value = false
}

function onSetStatus(status: UserStatus) {
  userProfileStore.setStatus(status)
}

function onSetCustomStatus() {
  const text = customStatusText.value.trim()
  if (text) {
    userProfileStore.setCustomStatus(text)
  }
}

function onClearCustomStatus() {
  userProfileStore.clearCustomStatus()
  customStatusText.value = ''
}
</script>

<style scoped>
.user-profile-popover {
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.popover-header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--color-border);
}

.profile-avatar {
  position: relative;
  flex-shrink: 0;
}

.avatar-actions {
  position: absolute;
  bottom: -4px;
  right: -4px;
  display: flex;
  gap: 2px;
}

.avatar-action-btn {
  width: 20px;
  height: 20px;
  border: 1px solid var(--color-border);
  border-radius: 50%;
  background: var(--color-surface-elevated);
  color: var(--color-text-secondary);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}
.avatar-action-btn:hover {
  background: var(--color-primary);
  color: var(--on-accent);
}

.avatar-file-input { display: none; }

.status-dot {
  position: absolute;
  bottom: 1px;
  right: 1px;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  border: 2px solid var(--color-surface-elevated);
}

.profile-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1;
  min-width: 0;
}

.nickname-row {
  display: flex;
  align-items: center;
  gap: 6px;
}

.nickname {
  font-size: 15px;
  font-weight: 600;
  color: var(--color-text);
}

.edit-btn {
  width: 20px;
  height: 20px;
  border: none;
  background: transparent;
  border-radius: var(--radius-xs);
  cursor: pointer;
  color: var(--color-text-tertiary);
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0;
  transition: opacity 0.15s;
}
.nickname-row:hover .edit-btn {
  opacity: 1;
}

.nickname-edit {
  display: flex;
}

.nickname-input {
  width: 100%;
  padding: 2px 6px;
  border: 1px solid var(--color-primary);
  border-radius: var(--radius-xs);
  font-size: 15px;
  font-weight: 600;
  background: var(--color-surface);
  color: var(--color-text);
  outline: none;
}

.status-label {
  font-size: var(--fs-sm);
  font-weight: 500;
}

.section-label {
  font-size: var(--fs-xs);
  font-weight: 600;
  color: var(--color-text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.status-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.status-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 6px 8px;
  border: none;
  background: transparent;
  border-radius: var(--radius-sm);
  cursor: pointer;
  font-size: var(--fs-md);
  color: var(--color-text);
  transition: background 0.12s;
  text-align: left;
}
.status-item:hover {
  background: var(--color-surface);
}
.status-item.active {
  background: var(--color-primary-muted);
}

.status-dot-preview {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

.status-item-label {
  flex: 1;
}

.status-check {
  color: var(--color-primary);
  font-weight: 700;
  font-size: var(--fs-sm);
}

.custom-status-row {
  display: flex;
  gap: 6px;
  align-items: center;
}

.custom-status-input {
  flex: 1;
  padding: 4px 8px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  font-size: var(--fs-sm);
  background: var(--color-surface);
  color: var(--color-text);
  outline: none;
}
.custom-status-input:focus {
  border-color: var(--color-primary);
}

.custom-status-set-btn {
  padding: 4px 10px;
  border: none;
  background: var(--color-primary);
  color: var(--on-accent);
  border-radius: var(--radius-sm);
  font-size: var(--fs-xs);
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
}

.custom-status-set-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.custom-status-clear-btn {
  padding: 4px 8px;
  border: 1px solid var(--color-border);
  background: transparent;
  color: var(--color-text-tertiary);
  border-radius: var(--radius-sm);
  font-size: var(--fs-xs);
  cursor: pointer;
  white-space: nowrap;
}
.custom-status-clear-btn:hover {
  color: var(--color-text);
  border-color: var(--color-text-tertiary);
}
</style>
