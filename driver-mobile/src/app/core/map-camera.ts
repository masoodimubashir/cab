declare const google: any;

/** Per-map camera ownership: live data moves markers, gestures own the viewport. */
class MapCameraControl {
  manual = false;
  private lastUpdate: (() => void) | null = null;
  private abort = new AbortController();
  private button: HTMLButtonElement | null = null;
  private control: any = null;
  private dragListener: any = null;

  constructor(private map: any, showControl: boolean) {
    const div = map.getDiv?.();
    const pause = () => this.pause();
    const options = { capture: true, passive: true, signal: this.abort.signal };
    for (const type of ['pointerdown', 'touchstart', 'wheel']) div?.addEventListener(type, pause, options);
    div?.addEventListener('keydown', (event: KeyboardEvent) => {
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', '+', '-', '=', 'PageUp', 'PageDown', 'Home', 'End'].includes(event.key)) pause();
    }, options);
    this.dragListener = map.addListener?.('dragstart', pause);

    const position = typeof google !== 'undefined' ? google.maps?.ControlPosition?.RIGHT_TOP : undefined;
    this.control = position !== undefined ? map.controls?.[position] : null;
    if (showControl && this.control && div && typeof document !== 'undefined') {
      const button = document.createElement('button');
      button.type = 'button';
      button.hidden = true;
      button.title = 'Recenter map';
      button.setAttribute('aria-label', 'Recenter map');
      button.style.cssText = 'width:44px;height:44px;margin:76px 12px 12px;border:1px solid #dbe5e2;border-radius:50%;background:white;color:#0d1b2a;box-shadow:0 2px 8px #0002;cursor:pointer';
      button.innerHTML = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2"/><path d="M12 1v4m0 14v4M1 12h4m14 0h4"/></svg>';
      button.addEventListener('click', event => { event.stopPropagation(); this.resume(true); });
      this.button = button;
      this.control.push(button);
    }
  }

  run(update: () => void): void {
    this.lastUpdate = update;
    if (!this.manual) update();
  }

  pause(): void {
    this.manual = true;
    if (this.button) this.button.hidden = false;
  }

  resume(applyLast: boolean): void {
    this.manual = false;
    if (this.button) this.button.hidden = true;
    if (applyLast) this.lastUpdate?.();
  }

  destroy(): void {
    this.abort.abort();
    this.dragListener?.remove();
    if (this.button && this.control) {
      for (let i = this.control.getLength() - 1; i >= 0; i--) {
        if (this.control.getAt(i) === this.button) this.control.removeAt(i);
      }
    }
    this.button?.remove();
    this.lastUpdate = null;
  }
}

const cameras = new WeakMap<object, MapCameraControl>();

export function watchMapCamera(map: any, showControl = true): void {
  if (map && !cameras.has(map)) cameras.set(map, new MapCameraControl(map, showControl));
}

export function isMapCameraManual(map: any): boolean {
  return !!map && !!cameras.get(map)?.manual;
}

export function pauseMapCamera(map: any): void {
  if (!map) return;
  watchMapCamera(map);
  cameras.get(map)!.pause();
}

export function updateMapCamera(map: any, update: () => void): void {
  if (!map) return;
  watchMapCamera(map);
  cameras.get(map)!.run(update);
}

/** Existing page recenter controls can supply their own fresh positioning. */
export function resumeMapCamera(map: any): void {
  if (map) cameras.get(map)?.resume(false);
}

export function releaseMapCamera(map: any): void {
  if (!map) return;
  cameras.get(map)?.destroy();
  cameras.delete(map);
}
