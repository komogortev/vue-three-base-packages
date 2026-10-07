/**
 * Editor history — a bounded undo / redo stack of entries (Track P, PP-1; was H-1).
 *
 * L0 kernel: generic over the entry's command type, no THREE / Vue. It stores and
 * moves entries; it never applies them. The routing layer (`useSceneCommands`) does
 * the applying and owns the side effects.
 *
 * Entries leave the history three ways, and each is reported through `onDrop` so the
 * caller can release whatever an entry kept alive (a removed object's meshes are
 * parked, not disposed, while an undo could still bring them back):
 * - `evicted`   — the oldest undo entry, pushed past `limit`;
 * - `truncated` — the redo stack, discarded by a new edit;
 * - `cleared`   — everything, on `clear()` (scene switch / load).
 */
export interface HistoryEntry<C> {
  label: string
  commands: readonly C[]
}

export type DropReason = 'evicted' | 'truncated' | 'cleared'

export interface EditorHistoryOptions<C> {
  /** Maximum undo entries kept. Default 100. */
  limit?: number
  /** Called once per entry that leaves the history, after it has been removed. */
  onDrop?: (entry: HistoryEntry<C>, reason: DropReason) => void
}

export class EditorHistory<C> {
  private readonly undoStack: HistoryEntry<C>[] = []
  private readonly redoStack: HistoryEntry<C>[] = []
  private readonly limit: number
  private readonly onDrop?: (entry: HistoryEntry<C>, reason: DropReason) => void

  constructor(opts: EditorHistoryOptions<C> = {}) {
    this.limit = Math.max(1, opts.limit ?? 100)
    this.onDrop = opts.onDrop
  }

  get canUndo(): boolean { return this.undoStack.length > 0 }
  get canRedo(): boolean { return this.redoStack.length > 0 }
  get undoSize(): number { return this.undoStack.length }
  get redoSize(): number { return this.redoStack.length }

  /** Label of the entry `undo()` would return, or null. */
  peekUndo(): string | null { return this.undoStack.at(-1)?.label ?? null }
  /** Label of the entry `redo()` would return, or null. */
  peekRedo(): string | null { return this.redoStack.at(-1)?.label ?? null }

  /** Record an applied entry. Discards the redo stack; evicts the oldest past `limit`. */
  push(entry: HistoryEntry<C>): void {
    const discarded = this.redoStack.splice(0)
    this.undoStack.push(entry)
    const evicted = this.undoStack.length > this.limit
      ? this.undoStack.splice(0, this.undoStack.length - this.limit)
      : []
    for (const e of discarded) this.onDrop?.(e, 'truncated')
    for (const e of evicted) this.onDrop?.(e, 'evicted')
  }

  /** Move the newest entry to the redo stack and return it (the caller reverses it). */
  undo(): HistoryEntry<C> | null {
    const e = this.undoStack.pop()
    if (!e) return null
    this.redoStack.push(e)
    return e
  }

  /** Move the newest redo entry back and return it (the caller re-applies it). */
  redo(): HistoryEntry<C> | null {
    const e = this.redoStack.pop()
    if (!e) return null
    this.undoStack.push(e)
    return e
  }

  /** Drop every entry (scene switch or load: the objects they name are gone). */
  clear(): void {
    const all = [...this.undoStack.splice(0), ...this.redoStack.splice(0)]
    for (const e of all) this.onDrop?.(e, 'cleared')
  }

  /** True when any entry still held (either stack) satisfies `pred`. */
  some(pred: (entry: HistoryEntry<C>) => boolean): boolean {
    return this.undoStack.some(pred) || this.redoStack.some(pred)
  }
}
