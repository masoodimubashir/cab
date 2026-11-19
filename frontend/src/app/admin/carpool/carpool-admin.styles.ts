/**
 * Shared look of the Carpool admin pages. Uses the same tokens, tab control and
 * page header as Drivers and Customers so nothing here looks like a new product.
 */
export const CARPOOL_ADMIN_STYLES = `
  :host { display: block; }
  .page { display: flex; flex-direction: column; gap: var(--tm-space-5); }
  .page__title { margin: 0; font-size: 22px; font-weight: 800; color: var(--tm-text); }
  .page__sub { margin: 4px 0 0; font-size: 13px; color: var(--tm-text-muted); max-width: 60ch; }

  .tabs { display: flex; gap: 4px; padding: 4px; background: var(--tm-canvas-2); border-radius: var(--tm-radius-md); align-self: flex-start; max-width: 100%; overflow-x: auto; scrollbar-width: none; }
  .tabs::-webkit-scrollbar { display: none; }
  .tabs button { padding: 9px 16px; border: 0; background: transparent; color: var(--tm-text-muted); font: inherit; font-size: 13px; font-weight: 700; cursor: pointer; border-radius: calc(var(--tm-radius-md) - 4px); white-space: nowrap; }
  .tabs button:hover:not(.is-on) { color: var(--tm-text); }
  .tabs button.is-on { background: var(--tm-surface); color: var(--tm-text); box-shadow: 0 1px 3px rgba(15, 20, 25, 0.08); }
  .tabs button:focus-visible { outline: 2px solid var(--tm-green-deep); outline-offset: 1px; }

  .summary { display: flex; align-self: flex-start; max-width: 100%; background: var(--tm-surface); border: 1px solid var(--tm-line-2); border-radius: var(--tm-radius-md); }
  .summary div { display: flex; align-items: baseline; gap: 8px; padding: 10px 20px; }
  .summary div + div { border-left: 1px solid var(--tm-line-2); }
  .summary b { font-size: 18px; font-weight: 800; color: var(--tm-text); font-variant-numeric: tabular-nums; }
  .summary span { font-size: 13px; color: var(--tm-text-muted); }

  .kv { display: grid; grid-template-columns: 120px minmax(0, 1fr); gap: 10px 16px; margin: 0; font-size: 13px; }
  .kv dt { color: var(--tm-text-muted); }
  .kv dd { margin: 0; color: var(--tm-text); overflow-wrap: anywhere; }

  .sect { margin: 24px 0 8px; font-size: 14px; font-weight: 700; color: var(--tm-text); display: flex; align-items: center; gap: 6px; }
  .muted { margin: 0; color: var(--tm-text-muted); font-size: 13px; }
  .plain { margin: 0; padding-left: 18px; font-size: 13px; color: var(--tm-text); display: grid; gap: 4px; }

  .mini { width: 100%; border-collapse: collapse; font-size: 13px; }
  .mini th { text-align: left; padding: 6px 8px 6px 0; font-weight: 600; color: var(--tm-text-muted); border-bottom: 1px solid var(--tm-line-2); }
  .mini td { padding: 8px 8px 8px 0; color: var(--tm-text); border-bottom: 1px solid var(--tm-line-2); vertical-align: top; }
  .mini tr:last-child td { border-bottom: 0; }

  .field { display: flex; flex-direction: column; gap: 6px; font-size: 13px; font-weight: 600; color: var(--tm-text); }
  .field textarea { font: inherit; font-weight: 400; padding: 9px 12px; border: 1px solid var(--tm-line-2); border-radius: var(--tm-radius-sm, 8px); color: var(--tm-text); background: var(--tm-surface); resize: vertical; }
  .field textarea:focus-visible { outline: 2px solid var(--tm-green-deep); outline-offset: 0; border-color: transparent; }

  @media (max-width: 640px) {
    .summary { align-self: stretch; }
    .summary div { flex: 1; flex-direction: column; align-items: flex-start; gap: 0; padding: 10px 14px; }
    .kv { grid-template-columns: 96px minmax(0, 1fr); }
  }
`;
