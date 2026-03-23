/**
 * AudioManager owns the Web Audio API gain node hierarchy.
 *
 * Topology:
 *   AudioContext.destination
 *     └── masterGain
 *           ├── musicGain   (background music)
 *           ├── sfxGain     (sound effects)
 *           └── voiceGain   (dialogue / narration)
 *
 * Volumes are linear [0, 1]. `init()` accepts an existing AudioContext so that
 * AudioModule can share the context from THREE.AudioListener, keeping Three.js
 * spatial audio and the Web Audio graph on the same context.
 */
export class AudioManager {
  private _context!: AudioContext
  private masterGain!: GainNode
  private _musicGain!: GainNode
  private _sfxGain!: GainNode
  private _voiceGain!: GainNode

  init(existingContext?: AudioContext): void {
    this._context = existingContext ?? new AudioContext()

    this.masterGain  = this.createGain(1)
    this._musicGain  = this.createGain(1)
    this._sfxGain    = this.createGain(1)
    this._voiceGain  = this.createGain(1)

    this._musicGain.connect(this.masterGain)
    this._sfxGain.connect(this.masterGain)
    this._voiceGain.connect(this.masterGain)
    this.masterGain.connect(this._context.destination)
  }

  // ─── Accessors ───────────────────────────────────────────────────────────────

  get audioContext(): AudioContext { return this._context }

  /** Connect SFX source nodes here. */
  get sfxDestination(): AudioNode { return this._sfxGain }

  /** Connect music source nodes here (via MusicLayer). */
  get musicDestination(): AudioNode { return this._musicGain }

  /** Connect voice/dialogue source nodes here. */
  get voiceDestination(): AudioNode { return this._voiceGain }

  // ─── Volume control ──────────────────────────────────────────────────────────

  setMasterVolume(value: number): void { this.masterGain.gain.value  = Math.max(0, Math.min(1, value)) }
  setMusicVolume (value: number): void { this._musicGain.gain.value  = Math.max(0, Math.min(1, value)) }
  setSfxVolume   (value: number): void { this._sfxGain.gain.value    = Math.max(0, Math.min(1, value)) }
  setVoiceVolume (value: number): void { this._voiceGain.gain.value  = Math.max(0, Math.min(1, value)) }

  getMasterVolume(): number { return this.masterGain.gain.value }
  getMusicVolume (): number { return this._musicGain.gain.value }
  getSfxVolume   (): number { return this._sfxGain.gain.value }
  getVoiceVolume (): number { return this._voiceGain.gain.value }

  // ─── Context lifecycle ───────────────────────────────────────────────────────

  suspend(): Promise<void> { return this._context.suspend() }
  resume(): Promise<void>  { return this._context.resume() }
  close(): Promise<void>   { return this._context.close() }

  private createGain(value: number): GainNode {
    const node = this._context.createGain()
    node.gain.value = value
    return node
  }
}
