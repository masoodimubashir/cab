/**
 * Shared look of the Carpool admin pages. Uses the same tokens, tab control and
 * page header as Drivers and Customers so nothing here looks like a new product.
 */
export const CARPOOL_ADMIN_STYLES = `
  :host { display: block; }
  .page { display: flex; flex-direction: column; gap: var(--tm-space-5); }
  .page__head { display: flex; align-items: flex-end; justify-content: space-between; gap: 16px; flex-wrap: wrap; }
  .page__title { margin: 0; font-size: 22px; font-weight: 800; color: var(--tm-text); }
  .page__sub { margin: 4px 0 0; font-size: 13px; color: var(--tm-text-muted); max-width: 70ch; }

  .tabs { display: flex; gap: 4px; padding: 4px; background: var(--tm-canvas-2); border-radius: var(--tm-radius-md); align-self: flex-start; max-width: 100%; overflow-x: auto; scrollbar-width: none; }
  .tabs::-webkit-scrollbar { display: none; }
  .tabs button { padding: 9px 16px; border: 0; background: transparent; color: var(--tm-text-muted); font: inherit; font-size: 13px; font-weight: 700; cursor: pointer; border-radius: calc(var(--tm-radius-md) - 4px); white-space: nowrap; }
  .tabs button:hover:not(.is-on) { color: var(--tm-text); }
  .tabs button.is-on { background: var(--tm-surface); color: var(--tm-text); box-shadow: 0 1px 3px rgba(15, 20, 25, 0.08); }
  .tabs button:focus-visible { outline: 2px solid var(--tm-green-deep); outline-offset: 1px; }

  tm-input[slot="search"] { display: block; width: 300px; max-width: 100%; }
  .bar { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }

  .summary { display: flex; align-self: flex-start; max-width: 100%; background: var(--tm-surface); border: 1px solid var(--tm-line-2); border-radius: var(--tm-radius-md); }
  .summary div { display: flex; align-items: baseline; gap: 8px; padding: 10px 20px; }
  .summary div + div { border-left: 1px solid var(--tm-line-2); }
  .summary b { font-size: 18px; font-weight: 800; color: var(--tm-text); font-variant-numeric: tabular-nums; }
  .summary span { font-size: 13px; color: var(--tm-text-muted); }
  .summary .is-warn b { color: var(--tm-warning-fg, #8a5a00); }

  .kv { display: grid; grid-template-columns: 130px minmax(0, 1fr); gap: 10px 16px; margin: 0; font-size: 13px; }
  .kv dt { color: var(--tm-text-muted); }
  .kv dd { margin: 0; color: var(--tm-text); overflow-wrap: anywhere; }

  .sect { margin: 24px 0 8px; font-size: 14px; font-weight: 700; color: var(--tm-text); display: flex; align-items: center; gap: 6px; }
  .sect small { font-weight: 500; color: var(--tm-text-muted); font-size: 12px; }
  .muted { margin: 0; color: var(--tm-text-muted); font-size: 13px; }
  .plain { margin: 0; padding-left: 18px; font-size: 13px; color: var(--tm-text); display: grid; gap: 4px; }

  .mini { width: 100%; border-collapse: collapse; font-size: 13px; }
  .mini th { text-align: left; padding: 6px 8px 6px 0; font-weight: 600; color: var(--tm-text-muted); border-bottom: 1px solid var(--tm-line-2); }
  .mini td { padding: 8px 8px 8px 0; color: var(--tm-text); border-bottom: 1px solid var(--tm-line-2); vertical-align: top; }
  .mini tr:last-child td { border-bottom: 0; }
  .mini .sub { display: block; color: var(--tm-text-muted); font-size: 12px; margin-top: 2px; }
  .mini .act { text-align: right; white-space: nowrap; }

  .field { display: flex; flex-direction: column; gap: 6px; font-size: 13px; font-weight: 600; color: var(--tm-text); }
  .field textarea, .field input, .field select { font: inherit; font-weight: 400; padding: 9px 12px; border: 1px solid var(--tm-line-2); border-radius: var(--tm-radius-sm, 8px); color: var(--tm-text); background: var(--tm-surface); }
  .field textarea { resize: vertical; }
  .field textarea:focus-visible, .field input:focus-visible, .field select:focus-visible { outline: 2px solid var(--tm-green-deep); outline-offset: 0; border-color: transparent; }
  .field .hint { font-weight: 400; color: var(--tm-text-muted); font-size: 12px; }
  .field .err { font-weight: 500; color: var(--tm-danger); font-size: 12px; }
  p + .field, .choice + .field, .muted + .field { margin-top: 14px; }

  .dates { display: inline-flex; align-items: center; gap: 6px; font-size: 13px; color: var(--tm-text-muted); }
  .dates input { font: inherit; font-size: 13px; padding: 7px 10px; border: 1px solid var(--tm-line-2); border-radius: var(--tm-radius-sm, 8px); background: var(--tm-surface); color: var(--tm-text); }
  .dates input:focus-visible { outline: 2px solid var(--tm-green-deep); outline-offset: 0; }
  .linkish { border: 0; background: none; padding: 0; font: inherit; font-size: 13px; font-weight: 600; color: var(--tm-green-deep); cursor: pointer; text-decoration: underline; text-underline-offset: 2px; }
  .linkish:focus-visible { outline: 2px solid var(--tm-green-deep); outline-offset: 2px; border-radius: 2px; }
  a.linkish { display: inline; }
  .tag { display: inline-block; padding: 1px 8px; border-radius: 999px; font-size: 11px; font-weight: 700; background: var(--tm-canvas-2); color: var(--tm-text-muted); margin-left: 6px; vertical-align: 1px; }
  .tag--warn { background: var(--tm-warning-bg); color: var(--tm-warning-fg); }
  .tag--bad { background: var(--tm-danger-bg); color: var(--tm-danger-fg); }
  .tag--ok { background: var(--tm-success-bg); color: var(--tm-success-fg); }

  .notice { display: flex; gap: 10px; align-items: flex-start; padding: 12px 14px; border-radius: var(--tm-radius-md); background: var(--tm-warning-bg); color: var(--tm-warning-fg); font-size: 13px; line-height: 1.45; }
  .notice--info { background: var(--tm-info-bg); color: var(--tm-info-fg); }

  .timeline { list-style: none; margin: 0; padding: 0 0 0 14px; border-left: 2px solid var(--tm-line-2); display: grid; gap: 10px; font-size: 13px; }
  .timeline li { position: relative; }
  .timeline li::before { content: ''; position: absolute; left: -20px; top: 5px; width: 10px; height: 10px; border-radius: 50%; background: var(--tm-surface); border: 2px solid var(--tm-ink-3, #98a2b3); }
  .timeline time { display: block; color: var(--tm-text-muted); font-size: 12px; }

  @media (max-width: 640px) {
    .summary { align-self: stretch; }
    .summary div { flex: 1; flex-direction: column; align-items: flex-start; gap: 0; padding: 10px 14px; }
    .kv { grid-template-columns: 96px minmax(0, 1fr); }
  }
`;

/** India time, as every carpool rule uses it. */
export function inTime(iso: string | null | undefined, withYear = false): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', ...(withYear ? { year: 'numeric' } : {}),
    hour: 'numeric', minute: '2-digit', hour12: true,
  });
}

export function inDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', year: 'numeric' });
}

/** Today's date in India as YYYY-MM-DD. */
export function indiaToday(offsetDays = 0): string {
  const d = new Date(Date.now() + offsetDays * 86400000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

export const REPORT_REASONS: Record<string, string> = {
  spam: 'Spam or selling', harassment: 'Harassment', unsafe: 'Unsafe behaviour', photo: 'Wrong or rude photo', other: 'Something else',
};

export function reasonLabel(key: string): string {
  return REPORT_REASONS[key] ?? (key ? key.charAt(0).toUpperCase() + key.slice(1) : '—');
}

/** A rider's outcome on a carpool, in plain words. */
export function requestStatusLabel(r: { status: string; closed_reason: string | null }): string {
  if (r.status === 'no_show' && r.closed_reason === 'not_confirmed') return 'Not confirmed';
  const s: Record<string, string> = {
    pending: 'Waiting', accepted: 'Accepted', declined: r.closed_reason === 'admin' ? 'Removed by Dream Cabs' : 'Declined',
    withdrawn: 'Withdrawn', closed: r.closed_reason === 'filled' ? 'Filled up' : 'Ended',
    cancelled_by_rider: 'Left', removed: r.closed_reason === 'admin' ? 'Removed by Dream Cabs' : 'Removed by driver',
    no_show: 'No-show', completed: 'Completed',
  };
  return s[r.status] ?? r.status;
}

const CANCEL: Record<string, string> = { driver: 'Driver', plan_ended: 'Plan ended', missed_departure: 'Missed departure', admin: 'Dream Cabs', documents: 'Document expired' };

export function listingStatusLabel(status: string, cancelReason: string | null): string {
  switch (status) {
    case 'published': return 'Published';
    case 'in_progress': return 'On the road';
    case 'completed': return 'Completed';
    case 'auto_completed': return 'Finished automatically';
    case 'ended_by_admin': return 'Ended by Dream Cabs';
    case 'cancelled': return 'Cancelled · ' + (CANCEL[cancelReason ?? ''] ?? 'Driver');
    default: return status;
  }
}

export function listingStatusTone(status: string): 'info' | 'warning' | 'success' | 'danger' | 'neutral' {
  return ({ published: 'info', in_progress: 'warning', completed: 'success', auto_completed: 'success', ended_by_admin: 'success', cancelled: 'danger' } as Record<string, 'info' | 'warning' | 'success' | 'danger'>)[status] ?? 'neutral';
}
