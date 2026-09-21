import { Injectable, NgZone } from '@angular/core';

/**
 * High-reliability audio and haptics ringtone service for driver app.
 *
 * Automatically unlocks Web Audio on first touch/click anywhere in the app,
 * handles background/foreground resume, and generates loud repeating taxi dispatch
 * ring patterns with synchronized multi-pulse vibration.
 */
@Injectable({ providedIn: 'root' })
export class AudioRingtoneService {
  private audioCtx: AudioContext | null = null;
  private isRinging = false;
  private ringInterval: any = null;
  private currentContextId: string | null = null;

  constructor(private ngZone: NgZone) {
    this.setupUnlockListeners();
  }

  private setupUnlockListeners(): void {
    if (typeof window === 'undefined') return;

    const unlock = () => {
      this.ensureAudioContext();
      if (this.audioCtx && this.audioCtx.state === 'suspended') {
        this.audioCtx.resume().catch(() => {});
      }
      window.removeEventListener('pointerdown', unlock, true);
      window.removeEventListener('touchstart', unlock, true);
      window.removeEventListener('click', unlock, true);
      window.removeEventListener('keydown', unlock, true);
    };

    window.addEventListener('pointerdown', unlock, true);
    window.addEventListener('touchstart', unlock, true);
    window.addEventListener('click', unlock, true);
    window.addEventListener('keydown', unlock, true);
  }

  private ensureAudioContext(): AudioContext | null {
    if (this.audioCtx) return this.audioCtx;
    try {
      const AudioContextClass = (window as any).AudioContext || (window as any).webkitAudioContext;
      if (AudioContextClass) {
        this.audioCtx = new AudioContextClass();
      }
    } catch {
      this.audioCtx = null;
    }
    return this.audioCtx;
  }

  /**
   * Start a continuous repeating ringtone pattern with vibration until stopRinging() is called.
   */
  startRinging(contextId?: string): void {
    if (this.isRinging && contextId && this.currentContextId === contextId) {
      return; // Already ringing for this request
    }
    this.currentContextId = contextId || 'default';
    this.isRinging = true;

    // Trigger first chime + vibration immediately
    this.playRingCycle();

    // Repeat every 1.8 seconds
    if (this.ringInterval) {
      clearInterval(this.ringInterval);
    }
    this.ringInterval = setInterval(() => {
      if (!this.isRinging) {
        this.stopRinging();
        return;
      }
      this.playRingCycle();
    }, 1800);
  }

  /**
   * Stop any active ringtone and vibration.
   */
  stopRinging(contextId?: string): void {
    if (contextId && this.currentContextId && this.currentContextId !== contextId) {
      return; // Different context
    }
    this.isRinging = false;
    this.currentContextId = null;
    if (this.ringInterval) {
      clearInterval(this.ringInterval);
      this.ringInterval = null;
    }
    this.stopVibration();
  }

  private playRingCycle(): void {
    try {
      this.vibrate([350, 150, 350, 150, 450]);

      const ctx = this.ensureAudioContext();
      if (!ctx) return;

      if (ctx.state === 'suspended') {
        ctx.resume().catch(() => {});
      }

      const now = ctx.currentTime;

      // Note 1: D5 (587.33 Hz)
      this.playTone(ctx, 587.33, now, 0.16, 0.45);
      // Note 2: A5 (880.00 Hz)
      this.playTone(ctx, 880.00, now + 0.18, 0.16, 0.50);
      // Note 3: D6 (1174.66 Hz)
      this.playTone(ctx, 1174.66, now + 0.36, 0.30, 0.55);
    } catch {
      // Ignore audio restriction
    }
  }

  private playTone(ctx: AudioContext, freq: number, startTime: number, duration: number, gainValue: number): void {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, startTime);

    gain.gain.setValueAtTime(0.001, startTime);
    gain.gain.linearRampToValueAtTime(gainValue, startTime + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(startTime);
    osc.stop(startTime + duration);
  }

  playSuccessChime(): void {
    try {
      this.vibrate([100, 50, 150]);
      const ctx = this.ensureAudioContext();
      if (!ctx) return;
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});

      const now = ctx.currentTime;
      this.playTone(ctx, 523.25, now, 0.12, 0.3); // C5
      this.playTone(ctx, 659.25, now + 0.12, 0.12, 0.35); // E5
      this.playTone(ctx, 783.99, now + 0.24, 0.25, 0.4); // G5
    } catch {}
  }

  playRejectChime(): void {
    try {
      this.vibrate([200]);
      const ctx = this.ensureAudioContext();
      if (!ctx) return;
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});

      const now = ctx.currentTime;
      this.playTone(ctx, 440, now, 0.15, 0.25);
      this.playTone(ctx, 349.23, now + 0.15, 0.25, 0.25);
    } catch {}
  }

  private vibrate(pattern: number[]): void {
    if (typeof window !== 'undefined' && 'navigator' in window && navigator.vibrate) {
      try {
        navigator.vibrate(pattern);
      } catch {}
    }
  }

  private stopVibration(): void {
    if (typeof window !== 'undefined' && 'navigator' in window && navigator.vibrate) {
      try {
        navigator.vibrate(0);
      } catch {}
    }
  }
}
