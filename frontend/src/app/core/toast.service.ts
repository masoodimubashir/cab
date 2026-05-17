import { Injectable, signal } from '@angular/core';

export type ToastKind = 'success' | 'error' | 'info' | 'warning';

export interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
  title?: string;
  /** ms before auto-dismiss; 0 to keep until manually closed. */
  duration: number;
}

interface ShowOpts {
  title?: string;
  duration?: number;
}

@Injectable({ providedIn: 'root' })
export class ToastService {
  private nextId = 1;
  private readonly _toasts = signal<Toast[]>([]);
  readonly toasts = this._toasts.asReadonly();

  private readonly timers = new Map<number, ReturnType<typeof setTimeout>>();

  show(kind: ToastKind, message: string, opts: ShowOpts = {}): number {
    const id = this.nextId++;
    const duration = opts.duration ?? (kind === 'error' ? 6000 : 4000);
    const toast: Toast = { id, kind, message, title: opts.title, duration };
    this._toasts.update((list) => [...list, toast]);

    if (duration > 0) {
      const handle = setTimeout(() => this.dismiss(id), duration);
      this.timers.set(id, handle);
    }
    return id;
  }

  success(message: string, opts?: ShowOpts) { return this.show('success', message, opts); }
  error(message: string, opts?: ShowOpts)   { return this.show('error',   message, opts); }
  info(message: string, opts?: ShowOpts)    { return this.show('info',    message, opts); }
  warning(message: string, opts?: ShowOpts) { return this.show('warning', message, opts); }

  dismiss(id: number): void {
    const handle = this.timers.get(id);
    if (handle) { clearTimeout(handle); this.timers.delete(id); }
    this._toasts.update((list) => list.filter((t) => t.id !== id));
  }

  clear(): void {
    this.timers.forEach((h) => clearTimeout(h));
    this.timers.clear();
    this._toasts.set([]);
  }
}
