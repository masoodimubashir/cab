import { Injectable } from '@angular/core';

/**
 * High-reliability audio and haptics alert service for customer app.
 */
@Injectable({ providedIn: 'root' })
export class AudioAlertService {
  private audioCtx: AudioContext | null = null;

  constructor() {
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

  playDriverAccepted(): void {
    try {
      this.vibrate([150, 100, 200]);
      const ctx = this.ensureAudioContext();
      if (!ctx) return;
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});

      const now = ctx.currentTime;
      this.playTone(ctx, 523.25, now, 0.12, 0.35); // C5
      this.playTone(ctx, 659.25, now + 0.12, 0.12, 0.40); // E5
      this.playTone(ctx, 783.99, now + 0.24, 0.28, 0.50); // G5
    } catch {}
  }

  playDriverDeclined(): void {
    try {
      this.vibrate([250]);
      const ctx = this.ensureAudioContext();
      if (!ctx) return;
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});

      const now = ctx.currentTime;
      this.playTone(ctx, 440, now, 0.18, 0.35);
      this.playTone(ctx, 349.23, now + 0.18, 0.30, 0.35);
    } catch {}
  }

  private playTone(ctx: AudioContext, freq: number, startTime: number, duration: number, gainValue: number): void {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, startTime);

    gain.gain.setValueAtTime(0.001, startTime);
    gain.gain.linearRampToValueAtTime(gainValue, startTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(startTime);
    osc.stop(startTime + duration);
  }

  private vibrate(pattern: number[]): void {
    if (typeof window !== 'undefined' && 'navigator' in window && navigator.vibrate) {
      try {
        navigator.vibrate(pattern);
      } catch {}
    }
  }
}
