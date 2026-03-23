/**
 * MusicLayer implements a two-track A/B crossfade for continuous background music.
 *
 * Pattern:
 * - Track A and Track B each have their own GainNode connected to the destination.
 * - play() fades out the currently active track while ramping the new track in.
 * - Both tracks loop indefinitely by default.
 * - stop() fades both tracks to silence and stops their sources.
 *
 * The crossfade is implemented with linearRampToValueAtTime so it works correctly
 * even when AudioContext is running. Calling play() mid-crossfade interrupts the
 * in-progress fade and starts a new one.
 */
export class MusicLayer {
  private sourceA: AudioBufferSourceNode | null = null
  private sourceB: AudioBufferSourceNode | null = null
  private readonly gainA: GainNode
  private readonly gainB: GainNode
  private active: 'a' | 'b' = 'a'

  constructor(
    private readonly context: AudioContext,
    destination: AudioNode,
  ) {
    this.gainA = context.createGain()
    this.gainB = context.createGain()
    this.gainA.gain.value = 0
    this.gainB.gain.value = 0
    this.gainA.connect(destination)
    this.gainB.connect(destination)
  }

  /**
   * Start playing `buffer`, crossfading from the current track.
   * @param buffer        Decoded AudioBuffer to play.
   * @param fadeDuration  Crossfade duration in seconds (default 2 s).
   */
  play(buffer: AudioBuffer, fadeDuration = 2): void {
    const now = this.context.currentTime

    if (this.active === 'a') {
      // Fade out A, bring in B
      this.gainA.gain.cancelScheduledValues(now)
      this.gainA.gain.setValueAtTime(this.gainA.gain.value, now)
      this.gainA.gain.linearRampToValueAtTime(0, now + fadeDuration)

      this.stopSource(this.sourceB, fadeDuration)
      this.sourceB = this.createSource(buffer, this.gainB)
      this.gainB.gain.cancelScheduledValues(now)
      this.gainB.gain.setValueAtTime(0, now)
      this.gainB.gain.linearRampToValueAtTime(1, now + fadeDuration)
      this.sourceB.start()

      this.active = 'b'
    } else {
      // Fade out B, bring in A
      this.gainB.gain.cancelScheduledValues(now)
      this.gainB.gain.setValueAtTime(this.gainB.gain.value, now)
      this.gainB.gain.linearRampToValueAtTime(0, now + fadeDuration)

      this.stopSource(this.sourceA, fadeDuration)
      this.sourceA = this.createSource(buffer, this.gainA)
      this.gainA.gain.cancelScheduledValues(now)
      this.gainA.gain.setValueAtTime(0, now)
      this.gainA.gain.linearRampToValueAtTime(1, now + fadeDuration)
      this.sourceA.start()

      this.active = 'a'
    }
  }

  /**
   * Fade all tracks to silence and stop playback.
   * @param fadeDuration  Fade-out duration in seconds (default 1 s).
   */
  stop(fadeDuration = 1): void {
    const now = this.context.currentTime
    for (const gain of [this.gainA, this.gainB]) {
      gain.gain.cancelScheduledValues(now)
      gain.gain.setValueAtTime(gain.gain.value, now)
      gain.gain.linearRampToValueAtTime(0, now + fadeDuration)
    }
    this.stopSource(this.sourceA, fadeDuration)
    this.stopSource(this.sourceB, fadeDuration)
    this.sourceA = null
    this.sourceB = null
  }

  dispose(): void {
    for (const src of [this.sourceA, this.sourceB]) {
      try { src?.stop() } catch { /* already stopped */ }
    }
    this.gainA.disconnect()
    this.gainB.disconnect()
    this.sourceA = null
    this.sourceB = null
  }

  // ─── Private helpers ──────────────────────────────────────────────────────────

  private createSource(buffer: AudioBuffer, destination: AudioNode): AudioBufferSourceNode {
    const src = this.context.createBufferSource()
    src.buffer = buffer
    src.loop = true
    src.connect(destination)
    return src
  }

  private stopSource(src: AudioBufferSourceNode | null, delaySeconds: number): void {
    if (!src) return
    const stopAt = this.context.currentTime + delaySeconds + 0.05
    try { src.stop(stopAt) } catch { /* already stopped */ }
  }
}
