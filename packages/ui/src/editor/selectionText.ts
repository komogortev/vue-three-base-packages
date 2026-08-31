/**
 * Status-bar text for the current editor selection — pure string derivation.
 *
 * Split out of `useSceneEditorViewport` (decomposition stage 1): these read the
 * scene config and the placed-object list and produce a label, touching no
 * THREE state, so the wording and the pluralisation are unit-testable.
 */
import type { EditorPlacedObject, EditorSelection, SceneEditorConfig } from './sceneEditorTypes'

/** Everything `describeSelection` needs beyond the selection itself. */
export interface SelectionTextContext {
  config: SceneEditorConfig
  placedObjects: readonly EditorPlacedObject[]
  /** True while the waypoint path editor is armed — adds a click hint for NPCs. */
  pathEditActive: boolean
}

/** Idle status line: how much the loaded scene contains. */
export function sceneStatus(cfg: SceneEditorConfig): string {
  const n = cfg.npcs?.length ?? 0
  const z = cfg.zones?.length ?? 0
  return `Scene loaded — ${n} NPC${n !== 1 ? 's' : ''}, ${z} zone${z !== 1 ? 's' : ''}`
}

/**
 * Human-readable description of a selection. Falls back to the raw id whenever
 * the entity is missing from the config, so a stale selection still renders.
 */
export function describeSelection(s: EditorSelection, ctx: SelectionTextContext): string {
  if (!s || s.kind === 'scene') return sceneStatus(ctx.config)
  if (s.kind === 'player') return 'Player — WASD to move · Tab to cycle camera'

  if (s.kind === 'npc') {
    const npc = ctx.config.npcs?.find((n) => n.entityId === s.entityId)
    const label = npc?.label ?? s.entityId
    const pathHint = ctx.pathEditActive ? ' — click floor to add waypoint' : ''
    return `NPC: ${label}${pathHint}`
  }

  if (s.kind === 'zone') {
    const zone = ctx.config.zones?.find((z) => z.id === s.id)
    return `Zone: ${zone?.label ?? s.id} (${zone?.type ?? 'unknown'}, r=${zone?.radius ?? '?'}m)`
  }

  if (s.kind === 'placed') {
    const obj = ctx.placedObjects.find((p) => p.id === s.objectId)
    return `Object: ${obj?.label ?? s.objectId}`
  }

  return ''
}
