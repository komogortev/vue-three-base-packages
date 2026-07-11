import { ref, type Ref } from 'vue'
import { AnimationRecorder, type PoseBoneSample } from './animationRecorder'

/** Default visible timeline range (seconds) before any keyframe extends it. */
export const DEFAULT_TIMELINE_DURATION = 5

export interface UseAnimRecorderReturn {
  /** Non-reactive recorder instance — never wrap in reactive() (readonly views). */
  recorder: AnimationRecorder
  /** Sorted keyframe times, mirrored after every mutation. */
  keyframeTimes: Ref<number[]>
  /** Current scrub position (seconds). */
  scrubTime: Ref<number>
  /** Visible timeline range — UI only; clip duration stays recorder-derived. */
  timelineDuration: Ref<number>
  addKeyframe: (time: number, bones: PoseBoneSample[]) => void
  removeKeyframe: (time: number) => void
  setTimelineDuration: (seconds: number) => void
  clear: () => void
}

/**
 * Reactive state layer over the pure-TS `AnimationRecorder` (usePoseEditor
 * pattern): the recorder owns the keyframes; this composable mirrors them
 * into refs after each mutation so Vue templates can render the timeline.
 */
export function useAnimRecorder(): UseAnimRecorderReturn {
  const recorder = new AnimationRecorder()
  const keyframeTimes = ref<number[]>([])
  const scrubTime = ref(0)
  const timelineDuration = ref(DEFAULT_TIMELINE_DURATION)

  function refresh(): void {
    keyframeTimes.value = recorder.keyframes.map(k => k.time)
    if (recorder.duration > timelineDuration.value) {
      timelineDuration.value = recorder.duration
    }
  }

  function addKeyframe(time: number, bones: PoseBoneSample[]): void {
    recorder.addKeyframe(time, bones)
    refresh()
  }

  function removeKeyframe(time: number): void {
    recorder.removeKeyframe(time)
    refresh()
  }

  function setTimelineDuration(seconds: number): void {
    if (!Number.isFinite(seconds)) return
    // Never shrink below the last keyframe — markers must stay on the strip.
    timelineDuration.value = Math.max(seconds, recorder.duration, 0.1)
    if (scrubTime.value > timelineDuration.value) scrubTime.value = timelineDuration.value
  }

  function clear(): void {
    recorder.clear()
    keyframeTimes.value = []
    scrubTime.value = 0
    timelineDuration.value = DEFAULT_TIMELINE_DURATION
  }

  return {
    recorder,
    keyframeTimes,
    scrubTime,
    timelineDuration,
    addKeyframe,
    removeKeyframe,
    setTimelineDuration,
    clear,
  }
}
