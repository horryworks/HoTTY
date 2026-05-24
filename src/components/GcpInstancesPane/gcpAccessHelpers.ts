import type { AccessState, GceInstance, ProjectAccess } from '../../types/appTypes';

/**
 * Resolve the effective IAP-tunnel access state for an instance. Resource-level
 * probe wins over project-level; absence at both levels means "not probed" →
 * `unknown`, which the UI treats as visible by default to avoid hiding
 * reachable VMs when the IAM probe itself failed.
 */
export function getEffectiveIapAccess(
  inst: GceInstance,
  projAccess: ProjectAccess | undefined,
): AccessState {
  return inst.access?.iapTunnel ?? projAccess?.iapTunnel ?? 'unknown';
}

/**
 * Same as `getEffectiveIapAccess` but for OS Login. Used for the warning
 * indicator — NOT used as a filter (instances may still accept SSH via
 * metadata SSH keys even when OS Login is denied).
 */
export function getEffectiveOsLoginAccess(
  inst: GceInstance,
  projAccess: ProjectAccess | undefined,
): AccessState {
  return inst.access?.osLogin ?? projAccess?.osLogin ?? 'unknown';
}

/**
 * A VM is filtered out iff its IAP-tunnel access is *explicitly* denied.
 * `granted` and `unknown` both pass — we never hide on `unknown` because the
 * probe itself may have failed for transient reasons.
 */
export function isInstanceAccessible(
  inst: GceInstance,
  projAccess: ProjectAccess | undefined,
): boolean {
  return getEffectiveIapAccess(inst, projAccess) !== 'denied';
}
