/**
 * Scene commands — the data form of every edit to a scene's objects (Track P, PP-1).
 *
 * L0 kernel: plain records and arithmetic, no THREE / Vue / Dexie. A command carries
 * everything needed to reverse it (`npc.remove` keeps the whole entry and its list
 * index; `*.patch` keeps the prior value of each field it touches), so inverting is a
 * pure function and the history never has to ask the scene what used to be there.
 *
 * Commands are data on purpose: the gizmo, the inspector and — later — Claude's tools
 * (PP-4/PP-5) all produce the same records, and a list of them can be shown, diffed,
 * validated or replayed before anything is applied.
 */
import type { EditorNpcEntry, EditorPlacedObject, EditorZoneEntry } from '../sceneEditorTypes'
import type { PlacedTransform } from '../placement/placedObjectModel'

/** NPC fields a patch may touch (everything but the id). */
export type NpcFields = Partial<Omit<EditorNpcEntry, 'entityId'>>
/** Zone fields a patch may touch (everything but the id). */
export type ZoneFields = Partial<Omit<EditorZoneEntry, 'id'>>

export type SceneCommand =
  | { kind: 'npc.add'; npc: EditorNpcEntry; index: number }
  | { kind: 'npc.remove'; npc: EditorNpcEntry; index: number }
  | { kind: 'npc.patch'; entityId: string; from: NpcFields; to: NpcFields }
  | { kind: 'zone.add'; zone: EditorZoneEntry; index: number }
  | { kind: 'zone.remove'; zone: EditorZoneEntry; index: number }
  | { kind: 'zone.patch'; id: string; from: ZoneFields; to: ZoneFields }
  | { kind: 'placed.add'; object: EditorPlacedObject }
  | { kind: 'placed.remove'; object: EditorPlacedObject }
  | { kind: 'placed.transform'; objectId: string; from: PlacedTransform; to: PlacedTransform }

/** The command that undoes `c`. Pure; `invertCommand(invertCommand(c))` equals `c`. */
export function invertCommand(c: SceneCommand): SceneCommand {
  switch (c.kind) {
    case 'npc.add': return { kind: 'npc.remove', npc: c.npc, index: c.index }
    case 'npc.remove': return { kind: 'npc.add', npc: c.npc, index: c.index }
    case 'npc.patch': return { kind: 'npc.patch', entityId: c.entityId, from: c.to, to: c.from }
    case 'zone.add': return { kind: 'zone.remove', zone: c.zone, index: c.index }
    case 'zone.remove': return { kind: 'zone.add', zone: c.zone, index: c.index }
    case 'zone.patch': return { kind: 'zone.patch', id: c.id, from: c.to, to: c.from }
    case 'placed.add': return { kind: 'placed.remove', object: c.object }
    case 'placed.remove': return { kind: 'placed.add', object: c.object }
    case 'placed.transform': return { kind: 'placed.transform', objectId: c.objectId, from: c.to, to: c.from }
  }
}

/** Undo for a whole entry: each command inverted, in reverse order. */
export function invertAll(commands: readonly SceneCommand[]): SceneCommand[] {
  return [...commands].reverse().map(invertCommand)
}

/**
 * Deep copy of a plain value (numbers, strings, arrays, plain objects). Reads through
 * property access, so it also copies a Vue reactive proxy, which `structuredClone`
 * refuses. A command must own its values: an entry mutated later must not rewrite it.
 */
export function clonePlain<T>(v: T): T {
  if (Array.isArray(v)) return v.map(clonePlain) as unknown as T
  if (v !== null && typeof v === 'object') {
    const out: Record<string, unknown> = {}
    for (const k of Object.keys(v as object)) out[k] = clonePlain((v as Record<string, unknown>)[k])
    return out as T
  }
  return v
}

/** Structural equality for plain values (the shapes `clonePlain` copies). */
export function plainEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((x, i) => plainEqual(x, b[i]))
  }
  if (a !== null && b !== null && typeof a === 'object' && typeof b === 'object' && !Array.isArray(a) && !Array.isArray(b)) {
    const ka = Object.keys(a).filter(k => (a as Record<string, unknown>)[k] !== undefined)
    const kb = Object.keys(b).filter(k => (b as Record<string, unknown>)[k] !== undefined)
    return ka.length === kb.length &&
      ka.every(k => plainEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]))
  }
  return false
}

/**
 * The two halves of a patch: the current value of every key `patch` names (`from`),
 * and the patch itself (`to`), both deep-copied. Keys whose value would not change are
 * dropped, so a patch that changes nothing comes back empty (see `isEmptyPatch`).
 */
export function splitPatch<T extends object>(current: T, patch: Partial<T>): { from: Partial<T>; to: Partial<T> } {
  const from: Partial<T> = {}
  const to: Partial<T> = {}
  for (const key of Object.keys(patch) as (keyof T)[]) {
    if (plainEqual(current[key], patch[key])) continue
    from[key] = clonePlain(current[key])
    to[key] = clonePlain(patch[key]) as T[keyof T]
  }
  return { from, to }
}

export function isEmptyPatch(p: object): boolean {
  return Object.keys(p).length === 0
}

/** True when two placed transforms are equal within `eps` on every component. */
export function transformsEqual(a: PlacedTransform, b: PlacedTransform, eps = 1e-6): boolean {
  const near = (x: number, y: number) => Math.abs(x - y) <= eps
  return (['position', 'rotation', 'scale'] as const).every(part =>
    near(a[part].x, b[part].x) && near(a[part].y, b[part].y) && near(a[part].z, b[part].z))
}

/** True when applying `c` would change nothing (an empty patch, an unmoved transform). */
export function isNoopCommand(c: SceneCommand): boolean {
  switch (c.kind) {
    case 'npc.patch':
    case 'zone.patch':
      return isEmptyPatch(c.to)
    case 'placed.transform':
      return transformsEqual(c.from, c.to)
    default:
      return false
  }
}

const NOUN: Record<string, string> = { npc: 'NPC', zone: 'zone', placed: 'object' }

/** Short human label for an entry, e.g. "Add NPC", "Move object", "Edit zone". */
export function describeCommands(commands: readonly SceneCommand[]): string {
  if (commands.length === 0) return 'Nothing'
  const first = commands[0]
  const [target, verb] = first.kind.split('.') as [string, string]
  const noun = NOUN[target] ?? target
  const word =
    verb === 'add' ? 'Add' :
    verb === 'remove' ? 'Remove' :
    verb === 'transform' ? 'Move' :
    'Edit'
  const more = commands.length > 1 ? ` (+${commands.length - 1})` : ''
  return `${word} ${noun}${more}`
}

/** Placed-object ids a list of commands refers to (for releasing retained resources). */
export function placedIdsOf(commands: readonly SceneCommand[]): string[] {
  const ids: string[] = []
  for (const c of commands) {
    if (c.kind === 'placed.add' || c.kind === 'placed.remove') ids.push(c.object.id)
    else if (c.kind === 'placed.transform') ids.push(c.objectId)
  }
  return ids
}
