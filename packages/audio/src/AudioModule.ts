import { BaseModule } from '@base/engine-core'
import type { EngineContext } from '@base/engine-core'
import { AudioListener, PositionalAudio, AudioLoader } from 'three'
import { AudioManager } from './AudioManager'
import { MusicLayer } from './MusicLayer'

/**
 * Minimal interface for what AudioModule requires from the engine context.
 * This avoids a hard import of @base/threejs-engine while still being type-safe.
 * THREE.PerspectiveCamera (extends Object3D) satisfies this interface.
 */
interface AudioHostContext extends EngineContext {
  camera: {
    add(object: object): void
    remove(object: object): void
  }
}

/**
 * Audio child module. Must be mounted as a child of ThreeModule (or any engine
 * that provides `context.camera` satisfying AudioHostContext).
 *
 * Responsibilities:
 * - Attaches a THREE.AudioListener to the engine camera for spatial audio positioning.
 * - Initialises AudioManager sharing the AudioListener's AudioContext.
 * - Provides MusicLayer for crossfading background music tracks.
 * - Suspends / resumes AudioContext with the Page Visibility API (battery + UX).
 * - Exposes helpers for loading audio buffers and creating positional audio nodes.
 *
 * @example
 * const audio = new AudioModule()
 * await engine.mountChild('audio', audio)
 *
 * // Load and play music
 * const buffer = await audio.loadBuffer('/assets/audio/theme.ogg')
 * audio.musicLayer.play(buffer)
 *
 * // Spatial SFX attached to a mesh
 * const sfx = audio.createPositionalAudio()
 * sfx.setBuffer(await audio.loadBuffer('/assets/audio/footstep.ogg'))
 * mesh.add(sfx)
 * sfx.play()
 */
export class AudioModule extends BaseModule {
  readonly id = 'audio'

  private _manager!: AudioManager
  private _music!: MusicLayer
  private _listener!: AudioListener
  private _loader!: AudioLoader
  private offVisibility!: () => void

  get audioManager(): AudioManager  { return this._manager  }
  get musicLayer():   MusicLayer    { return this._music    }
  get listener():     AudioListener { return this._listener }

  protected async onMount(_container: HTMLElement, context: EngineContext): Promise<void> {
    const ctx = context as AudioHostContext

    // Three.js AudioListener creates and owns an AudioContext internally.
    // Attaching it to the camera ensures HRTF calculations use the camera position.
    this._listener = new AudioListener()
    ctx.camera.add(this._listener)

    // Share the AudioContext with our Web Audio graph so all audio
    // (spatial and non-spatial) runs on one context with one timing source.
    this._manager = new AudioManager()
    this._manager.init(this._listener.context as AudioContext)

    this._music  = new MusicLayer(this._listener.context as AudioContext, this._manager.musicDestination)
    this._loader = new AudioLoader()

    const onVisibilityChange = (): void => {
      if (document.hidden) {
        void this._manager.suspend()
      } else {
        void this._manager.resume()
      }
    }

    document.addEventListener('visibilitychange', onVisibilityChange)
    this.offVisibility = () => document.removeEventListener('visibilitychange', onVisibilityChange)
  }

  protected async onUnmount(): Promise<void> {
    this.offVisibility()
    this._music.dispose()
    const ctx = this.context as AudioHostContext
    ctx.camera.remove(this._listener)
    await this._manager.close()
  }

  // ─── Public helpers ───────────────────────────────────────────────────────────

  /**
   * Explicitly resume the AudioContext.
   *
   * Browsers (especially Chrome in incognito) suspend the AudioContext until a
   * user gesture is confirmed. Call this once after the first user interaction
   * (e.g. immediately after mounting in response to a button click) so that
   * audio nodes function correctly and the "GainNode on closed context" warning
   * is suppressed.
   */
  resume(): Promise<void> {
    return this._manager.resume()
  }

  /**
   * Load an audio file and decode it into an AudioBuffer.
   * Uses THREE.AudioLoader which supports common formats (mp3, ogg, wav).
   */
  loadBuffer(url: string): Promise<AudioBuffer> {
    return new Promise((resolve, reject) => {
      this._loader.load(url, resolve, undefined, (err) => reject(err))
    })
  }

  /**
   * Create a THREE.PositionalAudio node attached to this module's AudioListener.
   * Attach the returned node to any Object3D in the scene for spatial audio.
   *
   * @param refDistance  Distance at which volume is at full level (default 1 m).
   */
  createPositionalAudio(refDistance = 1): PositionalAudio {
    const audio = new PositionalAudio(this._listener)
    audio.setRefDistance(refDistance)
    return audio
  }

  /**
   * Play a short non-spatial sound effect directly on the sfx gain bus.
   * Useful for UI sounds or quick one-shot effects that don't need positioning.
   */
  playSfxBuffer(buffer: AudioBuffer, volume = 1): void {
    const ctx = this._manager.audioContext
    const src  = ctx.createBufferSource()
    const gain = ctx.createGain()
    src.buffer = buffer
    gain.gain.value = volume
    src.connect(gain)
    gain.connect(this._manager.sfxDestination)
    src.start()
    // src is automatically garbage-collected after playback ends
  }
}
