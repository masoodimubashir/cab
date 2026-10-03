export function driverProfileErrorMessage(error: { status?: number; error?: { message?: string } } | null | undefined): string {
  const status = error?.status;
  if (!status) return 'Could not connect to the server to load your driver profile. Check your connection and retry.';
  if (status === 401) return 'Your session has expired. Please sign in again.';
  const detail = typeof error?.error?.message === 'string' ? error.error.message : '';
  return `Could not load driver profile (HTTP ${status}). ${detail || 'Please retry or share this error code with support.'}`;
}
