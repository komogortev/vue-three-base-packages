/**
 * The scene's one routing point for edits (Track P, PP-1).
 *
 * Every change to the scene's objects — a gizmo drag, an inspector field, add / remove,
 * a drop from the asset library, and later Claude's proposals — becomes a list of
 * {@link SceneCommand}s that passes through here, so each one is undoable and they all
 * share one history. The module never touches the scene itself: the host supplies a
 * {@link SceneCommandTarget} that applies one command, which keeps this testable with a
 * fake target and keeps it out of the L1 clusters (it knows none of them).
 *
 * Two ways in:
 * - `execute(commands)` applies them through the target, then records them;
 * - `record(commands)` records edits that already happened live (a gizmo drag moved the
 *   object frame by frame; replaying the end state would be a no-op at best).
 *
 * Operations are serialized: an undo pressed while an apply is still running waits for
 * it. Today every apply is synchronous; a placement that has to load a GLB will not be.
 */
import { computed, ref, type ComputedRef } from 'vue'
import { EditorHistory, type DropReason, type HistoryEntry } from './editorHistory'
import { describeCommands, invertAll, isNoopCommand, type SceneCommand } from './sceneCommand'

export interface SceneCommandTarget {
  /** Apply one command to the scene. May be async; calls never overlap. */
  apply(cmd: SceneCommand): void | Promise<void>
  /** An entry left the history for good: release what it kept alive. */
  onDrop?(entry: HistoryEntry<SceneCommand>, reason: DropReason): void
}

export interface SceneCommands {
  /** Apply `commands` (no-ops removed) and record them as one undo step. */
  execute(commands: SceneCommand[], label?: string): Promise<void>
  /** Record `commands` that were already applied live, as one undo step (queued like the rest). */
  record(commands: SceneCommand[], label?: string): Promise<void>
  /** Reverse the newest step. Resolves false when there was nothing to undo. */
  undo(): Promise<boolean>
  /** Re-apply the newest undone step. Resolves false when there was nothing to redo. */
  redo(): Promise<boolean>
  /** Forget every step (scene switch / load). */
  clear(): void
  /** True when any step still held (undo or redo side) satisfies `pred`. */
  holds(pred: (entry: HistoryEntry<SceneCommand>) => boolean): boolean
  canUndo: ComputedRef<boolean>
  canRedo: ComputedRef<boolean>
  /** Label of the step Undo would reverse ("Move object"), or null. */
  undoLabel: ComputedRef<string | null>
  redoLabel: ComputedRef<string | null>
}

export function useSceneCommands(
  target: SceneCommandTarget,
  opts: {
    limit?: number
    /** Called after every new step is recorded (not on undo / redo). */
    onRecord?: (entry: HistoryEntry<SceneCommand>) => void
  } = {},
): SceneCommands {
  const history = new EditorHistory<SceneCommand>({
    limit: opts.limit,
    onDrop: (entry, reason) => target.onDrop?.(entry, reason),
  })
  // The history is a plain class; this counter is what Vue tracks.
  const version = ref(0)
  const bump = () => { version.value++ }

  let queue: Promise<unknown> = Promise.resolve()
  function serialize<T>(op: () => Promise<T>): Promise<T> {
    const run = queue.then(op, op)
    queue = run.catch(() => undefined)
    return run
  }

  async function applyAll(commands: readonly SceneCommand[]): Promise<void> {
    for (const c of commands) await target.apply(c)
  }

  function push(commands: SceneCommand[], label?: string): void {
    const entry: HistoryEntry<SceneCommand> = { label: label ?? describeCommands(commands), commands }
    history.push(entry)
    bump()
    opts.onRecord?.(entry)
  }

  return {
    execute(commands, label) {
      const live = commands.filter(c => !isNoopCommand(c))
      if (live.length === 0) return Promise.resolve()
      return serialize(async () => {
        await applyAll(live)
        push(live, label)
      })
    },
    record(commands, label) {
      const live = commands.filter(c => !isNoopCommand(c))
      if (live.length === 0) return Promise.resolve()
      return serialize(async () => { push(live, label) })
    },
    undo() {
      return serialize(async () => {
        const entry = history.undo()
        if (!entry) return false
        bump()
        await applyAll(invertAll(entry.commands))
        return true
      })
    },
    redo() {
      return serialize(async () => {
        const entry = history.redo()
        if (!entry) return false
        bump()
        await applyAll(entry.commands)
        return true
      })
    },
    clear() {
      history.clear()
      bump()
    },
    holds: pred => history.some(pred),
    canUndo: computed(() => (void version.value, history.canUndo)),
    canRedo: computed(() => (void version.value, history.canRedo)),
    undoLabel: computed(() => (void version.value, history.peekUndo())),
    redoLabel: computed(() => (void version.value, history.peekRedo())),
  }
}
