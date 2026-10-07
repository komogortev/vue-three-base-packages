/**
 * Scene commands wired to the editor (Track P, PP-1): the host-side half of the
 * routing point.
 *
 * `useSceneCommands` keeps the history; this module supplies what it applies to —
 * the NPC and zone lists the host owns, and the viewport's placed objects and
 * markers — and turns the editor's gestures into commands:
 *
 * - a gizmo drag is recorded from a snapshot at its start and at its end (the drag
 *   itself already moved the object, so it is recorded, not re-applied);
 * - an inspector edit, add, remove or delete is executed as a command;
 * - a placed object that is removed is **parked** (kept whole, meshes alive) while an
 *   undo could still bring it back, and disposed once no step refers to it.
 *
 * The viewport is created after this (its options carry this module's callbacks), so
 * it is bound late with `bindViewport`.
 */
import { nextTick, type Ref } from 'vue'
import type { EditorNpcEntry, EditorPlacedObject, EditorSelection, EditorZoneEntry } from '../sceneEditorTypes'
import type { GestureTarget, PlacedHandle, SceneEditorViewportReturn } from '../useSceneEditorViewport'
import type { PlacedTransform } from '../placement/placedObjectModel'
import {
  clonePlain, placedIdsOf, splitPatch, type NpcFields, type SceneCommand, type ZoneFields,
} from './sceneCommand'
import { useSceneCommands, type SceneCommands } from './useSceneCommands'

/** The slice of the viewport the commands drive. */
export type CommandViewport = Pick<
  SceneEditorViewportReturn,
  | 'addNpcMarker' | 'removeNpcMarker' | 'setNpcPosition'
  | 'addZoneMarker' | 'removeZoneMarker' | 'setZonePosition'
  | 'getPlacedTransform' | 'setPlacedTransform' | 'snapshotPlacedTransforms'
  | 'detachPlacedObject' | 'reattachPlacedObject' | 'disposePlacedHandle'
  | 'discardPoseGesture'
>

export interface EditorCommandHooks {
  /** An NPC is about to leave the list (also on undo of its add). */
  beforeNpcRemove?: (entityId: string) => void
  /** Fields were written to an NPC entry (also on undo / redo). */
  afterNpcPatch?: (entityId: string, fields: NpcFields) => void
  /** Undo / redo ran from the keyboard: `label` names the step, null when there was none. */
  onHistoryStep?: (action: 'undo' | 'redo', label: string | null) => void
}

/** Fields a gizmo drag can change on an NPC entry. */
const NPC_GESTURE_FIELDS = ['x', 'z', 'rotationY', 'scale'] as const

export function useEditorCommands(opts: {
  npcs: Ref<EditorNpcEntry[]>
  zones: Ref<EditorZoneEntry[]>
  hooks?: EditorCommandHooks
}) {
  const { npcs, zones, hooks = {} } = opts
  let vp: CommandViewport | null = null
  const viewport = (): CommandViewport => {
    if (!vp) throw new Error('useEditorCommands: viewport not bound')
    return vp
  }

  /** Placed objects taken out of the scene that an undo / redo may bring back. */
  const parked = new Map<string, PlacedHandle>()

  function disposeParked(id: string): void {
    const h = parked.get(id)
    if (!h) return
    parked.delete(id)
    vp?.disposePlacedHandle(h)
  }

  const commands: SceneCommands = useSceneCommands({
    apply(c: SceneCommand) {
      const v = viewport()
      switch (c.kind) {
        case 'npc.add': {
          const npc = clonePlain(c.npc)
          const list = [...npcs.value]
          list.splice(Math.min(c.index, list.length), 0, npc)
          npcs.value = list
          v.addNpcMarker(npc)
          break
        }
        case 'npc.remove':
          hooks.beforeNpcRemove?.(c.npc.entityId)
          npcs.value = npcs.value.filter(n => n.entityId !== c.npc.entityId)
          v.removeNpcMarker(c.npc.entityId)
          break
        case 'npc.patch': {
          const npc = npcs.value.find(n => n.entityId === c.entityId)
          if (!npc) break
          Object.assign(npc, clonePlain(c.to))
          if ('x' in c.to || 'z' in c.to) v.setNpcPosition(c.entityId, npc.x, npc.z)
          hooks.afterNpcPatch?.(c.entityId, c.to)
          break
        }
        case 'zone.add': {
          const zone = clonePlain(c.zone)
          const list = [...zones.value]
          list.splice(Math.min(c.index, list.length), 0, zone)
          zones.value = list
          v.addZoneMarker(zone)
          break
        }
        case 'zone.remove':
          zones.value = zones.value.filter(z => z.id !== c.zone.id)
          v.removeZoneMarker(c.zone.id)
          break
        case 'zone.patch': {
          const zone = zones.value.find(z => z.id === c.id)
          if (!zone) break
          Object.assign(zone, clonePlain(c.to))
          if ('x' in c.to || 'z' in c.to) v.setZonePosition(c.id, zone.x, zone.z)
          break
        }
        case 'placed.remove': {
          const h = v.detachPlacedObject(c.object.id)
          if (h) parked.set(c.object.id, h)
          break
        }
        case 'placed.add': {
          const h = parked.get(c.object.id)
          if (h) {
            // Stays parked (so it is still disposed later) if its id is taken.
            if (v.reattachPlacedObject(h)) parked.delete(c.object.id)
          } else {
            // Only parked objects come back today; adding from an asset id needs a GLB
            // load and arrives with Claude's proposals (PP-4/PP-5).
            console.warn('[editor commands] placed.add without a parked object:', c.object.id)
          }
          break
        }
        case 'placed.transform':
          v.setPlacedTransform(c.objectId, c.to)
          break
      }
    },
    onDrop(entry, reason) {
      for (const id of placedIdsOf(entry.commands)) {
        if (!parked.has(id)) continue
        // Disposed only when no remaining step could bring it back.
        const stillNamed = reason !== 'cleared' &&
          commands.holds(e => placedIdsOf(e.commands).includes(id))
        if (!stillNamed) disposeParked(id)
      }
    },
  }, {
    // Any recorded scene edit is newer than a pending bone / IK drag.
    onRecord: () => vp?.discardPoseGesture(),
  })

  // ─── Gestures ──────────────────────────────────────────────────────────────

  type GestureStart =
    | { kind: 'placed'; objectId: string; t: PlacedTransform }
    | { kind: 'npc'; entityId: string; fields: NpcFields }
    | { kind: 'zone'; id: string; fields: ZoneFields }

  let gestureStart: GestureStart | null = null

  function npcGestureFields(entityId: string): NpcFields | null {
    const npc = npcs.value.find(n => n.entityId === entityId)
    if (!npc) return null
    const out: NpcFields = {}
    for (const k of NPC_GESTURE_FIELDS) (out as Record<string, unknown>)[k] = npc[k]
    return clonePlain(out)
  }

  function zoneGestureFields(id: string): ZoneFields | null {
    const zone = zones.value.find(z => z.id === id)
    return zone ? { x: zone.x, z: zone.z } : null
  }

  async function onGesture(phase: 'start' | 'end', target: GestureTarget): Promise<void> {
    if (phase === 'start') {
      gestureStart = null
      if (target.kind === 'placed') {
        const t = viewport().getPlacedTransform(target.objectId)
        if (t) gestureStart = { kind: 'placed', objectId: target.objectId, t }
      } else if (target.kind === 'npc') {
        const fields = npcGestureFields(target.entityId)
        if (fields) gestureStart = { kind: 'npc', entityId: target.entityId, fields }
      } else {
        const fields = zoneGestureFields(target.id)
        if (fields) gestureStart = { kind: 'zone', id: target.id, fields }
      }
      return
    }

    const start = gestureStart
    gestureStart = null
    if (!start) return
    // The drag's last live values reach the entries through the host's watchers, which
    // run before the next tick; read the end state after them.
    await nextTick()
    if (start.kind === 'placed') {
      const end = viewport().getPlacedTransform(start.objectId)
      if (end) {
        await commands.record([{ kind: 'placed.transform', objectId: start.objectId, from: start.t, to: end }], 'Move object')
      }
    } else if (start.kind === 'npc') {
      const end = npcGestureFields(start.entityId)
      if (end) {
        const { from, to } = splitPatch(start.fields, end)
        await commands.record([{ kind: 'npc.patch', entityId: start.entityId, from, to }], 'Move NPC')
      }
    } else {
      const end = zoneGestureFields(start.id)
      if (end) {
        const { from, to } = splitPatch(start.fields, end)
        await commands.record([{ kind: 'zone.patch', id: start.id, from, to }], 'Move zone')
      }
    }
  }

  // ─── Edits ─────────────────────────────────────────────────────────────────

  async function step(action: 'undo' | 'redo'): Promise<void> {
    const label = action === 'undo' ? commands.undoLabel.value : commands.redoLabel.value
    const ran = action === 'undo' ? await commands.undo() : await commands.redo()
    // The step just undone / redone is now the newest edit, ahead of a pending bone drag.
    if (ran) vp?.discardPoseGesture()
    hooks.onHistoryStep?.(action, ran ? label : null)
  }

  return {
    commands,
    /** Late-bind the viewport (it is created with this module's callbacks). */
    bindViewport(v: CommandViewport) { vp = v },

    /** Viewport options: gizmo drags, drops, Ctrl+Z / Ctrl+Y, Delete. */
    viewportOptions: {
      onGesture: (phase: 'start' | 'end', target: GestureTarget) => { void onGesture(phase, target) },
      onPlaced: (object: EditorPlacedObject) => {
        void commands.record([{ kind: 'placed.add', object: clonePlain(object) }])
      },
      onHistoryKey: (action: 'undo' | 'redo') => { void step(action) },
      onDeleteSelected: (sel: EditorSelection) => {
        if (sel?.kind === 'placed') void removePlaced(sel.objectId)
      },
    },

    undo: () => step('undo'),
    redo: () => step('redo'),

    addNpc(npc: EditorNpcEntry): Promise<void> {
      return commands.execute([{ kind: 'npc.add', npc: clonePlain(npc), index: npcs.value.length }])
    },
    removeNpc(entityId: string): Promise<void> {
      const index = npcs.value.findIndex(n => n.entityId === entityId)
      if (index < 0) return Promise.resolve()
      return commands.execute([{ kind: 'npc.remove', npc: clonePlain(npcs.value[index]), index }])
    },
    patchNpc(entityId: string, patch: NpcFields): Promise<void> {
      const npc = npcs.value.find(n => n.entityId === entityId)
      if (!npc) return Promise.resolve()
      const { from, to } = splitPatch(npc as NpcFields, patch)
      return commands.execute([{ kind: 'npc.patch', entityId, from, to }])
    },

    addZone(zone: EditorZoneEntry): Promise<void> {
      return commands.execute([{ kind: 'zone.add', zone: clonePlain(zone), index: zones.value.length }])
    },
    removeZone(id: string): Promise<void> {
      const index = zones.value.findIndex(z => z.id === id)
      if (index < 0) return Promise.resolve()
      return commands.execute([{ kind: 'zone.remove', zone: clonePlain(zones.value[index]), index }])
    },
    patchZone(id: string, patch: ZoneFields): Promise<void> {
      const zone = zones.value.find(z => z.id === id)
      if (!zone) return Promise.resolve()
      const { from, to } = splitPatch(zone as ZoneFields, patch)
      return commands.execute([{ kind: 'zone.patch', id, from, to }])
    },

    removePlaced,

    /** Forget all steps and dispose parked objects (scene switch / load). */
    clear(): void {
      commands.clear()
      for (const id of [...parked.keys()]) disposeParked(id)
    },
  }

  function removePlaced(objectId: string): Promise<void> {
    // The record carries the live transform, so the step says where it was removed from.
    const object = viewport().snapshotPlacedTransforms().find(o => o.id === objectId)
    if (!object) return Promise.resolve()
    return commands.execute([{ kind: 'placed.remove', object: clonePlain(object) }])
  }
}

export type EditorCommands = ReturnType<typeof useEditorCommands>
