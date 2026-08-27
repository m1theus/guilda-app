import { ALL_PERMISSIONS, Permission, type PermissionName } from '@guilda/types';
import { forbidden } from '../http/errors.js';
import type { MemberRecord, Repository } from '../repository.js';

export function hasPermission(bitfield: number, required: PermissionName | number): boolean {
  const mask = typeof required === 'number' ? required : Permission[required];
  return (bitfield & mask) === mask;
}
export function hasOnlyKnownPermissions(bitfield: number): boolean {
  return Number.isSafeInteger(bitfield) && bitfield >= 0 && (bitfield & ~ALL_PERMISSIONS) === 0;
}

export function requirePermission(
  member: MemberRecord | null,
  required: PermissionName | number,
): MemberRecord {
  if (!member || !hasPermission(member.permissions, required)) throw forbidden();
  return member;
}
export async function requireServerPermission(
  repo: Repository,
  serverId: string,
  userId: string,
  required: PermissionName | number,
): Promise<MemberRecord> {
  return requirePermission(await repo.getMembership(serverId, userId), required);
}
