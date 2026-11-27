class SoundFxEngine {
  private ctx: AudioContext | null = null;
  private muted = false;

  setMuted(muted: boolean): void {
    this.muted = muted;
  }

  isMuted(): boolean {
    return this.muted;
  }

  private ensureContext(): AudioContext | null {
    if (this.muted) return null;
    if (typeof window === 'undefined') return null;
    if (!this.ctx) {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return null;
      this.ctx = new AudioCtx();
    }
    if (this.ctx.state === 'suspended') {
      void this.ctx.resume().catch(() => undefined);
    }
    return this.ctx;
  }

  private playTone(
    freq: number,
    durationSec: number,
    type: OscillatorType = 'triangle',
    gainPeak = 0.08,
    delaySec = 0,
  ): void {
    const ctx = this.ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime + delaySec;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, now);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(gainPeak, now + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + durationSec);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + durationSec + 0.02);
  }

  paddleHit(): void {
    this.playTone(520, 0.065, 'triangle', 0.09);
  }

  wallBounce(): void {
    this.playTone(310, 0.05, 'sine', 0.06);
  }

  pointScored(bySelf: boolean): void {
    if (bySelf) {
      this.playTone(587.33, 0.09, 'triangle', 0.09, 0);
      this.playTone(880, 0.14, 'triangle', 0.09, 0.07);
    } else {
      this.playTone(349.23, 0.11, 'sine', 0.07, 0);
      this.playTone(261.63, 0.16, 'sine', 0.07, 0.08);
    }
  }

  countdownTick(finalGo = false): void {
    this.playTone(finalGo ? 784 : 440, finalGo ? 0.14 : 0.07, 'sine', 0.06);
  }

  matchFinished(won: boolean): void {
    if (won) {
      this.playTone(523.25, 0.11, 'triangle', 0.09, 0);
      this.playTone(659.25, 0.11, 'triangle', 0.09, 0.09);
      this.playTone(783.99, 0.2, 'triangle', 0.1, 0.18);
    } else {
      this.playTone(392, 0.13, 'sine', 0.07, 0);
      this.playTone(311.13, 0.22, 'sine', 0.07, 0.12);
    }
  }
}

export const soundFx = new SoundFxEngine();
