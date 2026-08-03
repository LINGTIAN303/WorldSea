import type { GroupMember, GroupInfo, GroupChatMode, GroupRole } from '../types'
import { PermissionChecker } from './PermissionChecker'

export class GroupManager {
  private info: GroupInfo
  private members: GroupMember[]

  constructor(info: GroupInfo, members: GroupMember[]) {
    this.info = info
    this.members = members
  }

  getInfo(): GroupInfo {
    return { ...this.info }
  }

  getMembers(): GroupMember[] {
    return [...this.members]
  }

  getMember(agentId: string): GroupMember | undefined {
    return this.members.find(m => m.id === agentId)
  }

  updateInfo(patch: Partial<Pick<GroupInfo, 'name' | 'avatar' | 'announcement'>>, operatorId: string): boolean {
    const operator = this.getMember(operatorId)
    if (!operator || !PermissionChecker.can(operator, 'edit_group_info')) return false

    if (patch.name !== undefined) this.info.name = patch.name
    if (patch.avatar !== undefined) this.info.avatar = patch.avatar
    if (patch.announcement !== undefined) this.info.announcement = patch.announcement
    this.info.updatedAt = Date.now()
    return true
  }

  setMode(mode: GroupChatMode, operatorId: string): boolean {
    const operator = this.getMember(operatorId)
    if (!operator || !PermissionChecker.isOwnerOrAdmin(operator)) return false

    this.info.mode = mode
    this.info.updatedAt = Date.now()
    return true
  }

  addMember(member: GroupMember, operatorId: string): boolean {
    const operator = this.getMember(operatorId)
    if (!operator || !PermissionChecker.can(operator, 'invite_member')) return false
    if (this.members.some(m => m.id === member.id)) return false

    this.members.push(member)
    this.info.updatedAt = Date.now()
    return true
  }

  removeMember(memberId: string, operatorId: string): boolean {
    const operator = this.getMember(operatorId)
    if (!operator || !PermissionChecker.can(operator, 'kick_member')) return false

    const target = this.getMember(memberId)
    if (!target) return false
    if (target.groupRole === 'owner') return false
    if (target.groupRole === 'admin' && operator.groupRole !== 'owner') return false

    this.members = this.members.filter(m => m.id !== memberId)
    this.info.updatedAt = Date.now()
    return true
  }

  setRole(memberId: string, groupRole: GroupRole, operatorId: string): boolean {
    const operator = this.getMember(operatorId)
    if (!operator || !PermissionChecker.can(operator, 'set_admin')) return false

    const target = this.getMember(memberId)
    if (!target || target.groupRole === 'owner') return false

    target.groupRole = groupRole
    this.info.updatedAt = Date.now()
    return true
  }

  transferOwnership(newOwnerId: string, operatorId: string): boolean {
    const operator = this.getMember(operatorId)
    if (!operator || !PermissionChecker.isOwner(operator)) return false

    const newOwner = this.getMember(newOwnerId)
    if (!newOwner) return false

    operator.groupRole = 'member'
    newOwner.groupRole = 'owner'
    this.info.updatedAt = Date.now()
    return true
  }

  muteMember(memberId: string, durationMs: number | null, operatorId: string): boolean {
    const operator = this.getMember(operatorId)
    if (!operator || !PermissionChecker.can(operator, 'mute_member')) return false

    const target = this.getMember(memberId)
    if (!target || target.groupRole === 'owner') return false
    if (target.groupRole === 'admin' && operator.groupRole !== 'owner') return false

    target.muted = true
    target.mutedUntil = durationMs ? Date.now() + durationMs : undefined
    this.info.updatedAt = Date.now()
    return true
  }

  unmuteMember(memberId: string, operatorId: string): boolean {
    const operator = this.getMember(operatorId)
    if (!operator || !PermissionChecker.can(operator, 'mute_member')) return false

    const target = this.getMember(memberId)
    if (!target) return false

    target.muted = false
    target.mutedUntil = undefined
    this.info.updatedAt = Date.now()
    return true
  }

  muteAll(operatorId: string): boolean {
    const operator = this.getMember(operatorId)
    if (!operator || !PermissionChecker.isOwnerOrAdmin(operator)) return false

    for (const m of this.members) {
      if (m.groupRole === 'member') {
        m.muted = true
      }
    }
    this.info.updatedAt = Date.now()
    return true
  }

  unmuteAll(operatorId: string): boolean {
    const operator = this.getMember(operatorId)
    if (!operator || !PermissionChecker.isOwnerOrAdmin(operator)) return false

    for (const m of this.members) {
      m.muted = false
      m.mutedUntil = undefined
    }
    this.info.updatedAt = Date.now()
    return true
  }

  checkExpiredMutes(): void {
    const now = Date.now()
    for (const m of this.members) {
      if (m.muted && m.mutedUntil && now >= m.mutedUntil) {
        m.muted = false
        m.mutedUntil = undefined
      }
    }
  }
}
