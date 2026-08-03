import type { GroupMember, GroupRole } from '../types'

export type Permission =
  | 'speak'
  | 'mention'
  | 'send_media'
  | 'invite_member'
  | 'mute_member'
  | 'kick_member'
  | 'set_admin'
  | 'edit_group_info'
  | 'dissolve_group'
  | 'transfer_owner'

const ROLE_PERMISSIONS: Record<GroupRole, Permission[]> = {
  owner: [
    'speak', 'mention', 'send_media', 'invite_member', 'mute_member',
    'kick_member', 'set_admin', 'edit_group_info', 'dissolve_group', 'transfer_owner',
  ],
  admin: [
    'speak', 'mention', 'send_media', 'invite_member', 'mute_member',
    'kick_member', 'edit_group_info',
  ],
  member: ['speak', 'mention', 'send_media'],
}

export class PermissionChecker {
  static can(member: GroupMember, permission: Permission): boolean {
    if (member.muted && (!member.mutedUntil || Date.now() < member.mutedUntil)) {
      if (permission === 'speak' || permission === 'send_media') return false
    }
    return ROLE_PERMISSIONS[member.groupRole]?.includes(permission) ?? false
  }

  static canAny(member: GroupMember, permissions: Permission[]): boolean {
    return permissions.some(p => this.can(member, p))
  }

  static canAll(member: GroupMember, permissions: Permission[]): boolean {
    return permissions.every(p => this.can(member, p))
  }

  static isOwnerOrAdmin(member: GroupMember): boolean {
    return member.groupRole === 'owner' || member.groupRole === 'admin'
  }

  static isOwner(member: GroupMember): boolean {
    return member.groupRole === 'owner'
  }

  static getPermissions(role: GroupRole): Permission[] {
    return [...(ROLE_PERMISSIONS[role] || [])]
  }
}
