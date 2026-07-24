/**
 * Precedence for the SSH login name of a GCP IAP connection.
 *
 * The backend resolves the name automatically (gcloud `--dry-run`, then
 * metadata/org-policy, then the local username). These overrides exist for the
 * case where all of that still picks an account the VM does not provision —
 * the failure mode that broke IAP login between v2.0.3-beta4 and v2.0.13.
 *
 * Order: the host entry wins, because it was chosen for that specific VM; then
 * the global setting, which covers the common case of one signed-in account per
 * machine. `undefined` means "auto-detect" and is what the backend expects — an
 * empty string would read as an explicit (invalid) override.
 */
export function resolveIapUsername(
  hostUsername: string | undefined,
  globalUsername: string | undefined,
): string | undefined {
  return hostUsername?.trim() || globalUsername?.trim() || undefined;
}
