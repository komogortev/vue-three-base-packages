import * as THREE from 'three'

/**
 * Owns the AnimationMixer lifecycle for previewing a recorded clip on the
 * pose-editor mesh. Deliberately knows nothing about the editor: it operates
 * only on the `Object3D` root and `AnimationClip` it is handed, so the
 * viewport composable stays a thin delegator.
 *
 * Recorder preview uses `LoopOnce` + `clampWhenFinished` — with `LoopRepeat`,
 * `t == duration` wraps back to `t = 0` and the final pose is never shown
 * (S5-a spike finding). Audition (S5-d) passes `loop = true` to watch a stored
 * clip cycle indefinitely instead.
 */
export class PosePreviewMixer {
  private mixer: THREE.AnimationMixer | null = null
  private action: THREE.AnimationAction | null = null
  private root: THREE.Object3D | null = null
  private _playing = false
  private readonly onMixerFinished = (): void => {
    this._playing = false
    this.onFinished?.()
  }

  /** Invoked when a LoopOnce playback reaches its end (pose stays clamped). */
  onFinished: (() => void) | null = null

  get playing(): boolean {
    return this._playing
  }

  /** Bind to the mesh root whose descendant bones the clip tracks target. */
  attach(root: THREE.Object3D): void {
    if (this.root === root) return
    this.dispose()
    this.root = root
  }

  /**
   * Start (or restart) playback of `clip` on the attached root. No-op when
   * unattached. `loop = true` (audition) cycles with `LoopRepeat`; the default
   * `false` (recorder preview) plays once and clamps the final pose.
   */
  play(clip: THREE.AnimationClip, loop = false): void {
    if (!this.root) return
    this.stop()
    if (!this.mixer) {
      this.mixer = new THREE.AnimationMixer(this.root)
      this.mixer.addEventListener('finished', this.onMixerFinished)
    }
    this.action = this.mixer.clipAction(clip)
    if (loop) {
      this.action.setLoop(THREE.LoopRepeat, Infinity)
      this.action.clampWhenFinished = false
    } else {
      this.action.setLoop(THREE.LoopOnce, 1)
      this.action.clampWhenFinished = true
    }
    this.action.play()
    this._playing = true
  }

  /** Stop playback, leaving bones at their current (possibly clamped) pose. */
  stop(): void {
    if (this.mixer) {
      this.mixer.stopAllAction()
      if (this.action) this.mixer.uncacheClip(this.action.getClip())
    }
    this.action = null
    this._playing = false
  }

  /** Advance playback; call once per frame from the host render loop. */
  update(delta: number): void {
    if (this._playing) this.mixer?.update(delta)
  }

  /** Full teardown — required before the attached mesh is disposed. */
  dispose(): void {
    this.stop()
    if (this.mixer) {
      this.mixer.removeEventListener('finished', this.onMixerFinished)
      if (this.root) this.mixer.uncacheRoot(this.root)
      this.mixer = null
    }
    this.root = null
  }
}
