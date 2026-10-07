/**
 * Gizmo maths for an NPC's display model (E12).
 *
 * The transform gizmo drives the model, not the marker (the marker is an
 * identification pin). Three things have to be decided somewhere testable:
 * which axes the gizmo may show on the model, how a gizmo-written quaternion
 * becomes the authored `rotationY` in degrees, and how the model's scale
 * becomes the authored `scale`. Pure, no THREE: the caller passes plain numbers.
 */

export type GizmoMode = 'translate' | 'rotate' | 'scale'

/**
 * What the gizmo is attached to. An NPC's marker is an identification pin: it may
 * be moved on the ground plane when the NPC has no model yet, but never rotated or
 * scaled (there is nothing to store). An NPC's model carries yaw and uniform scale.
 */
export type GizmoTarget = 'npc-model' | 'npc-marker' | 'other'

export interface GizmoAxes {
  x: boolean
  y: boolean
  z: boolean
}

/**
 * Axis handles to show. An NPC's model only has three authored degrees of freedom:
 * position on the ground plane (`y` is authored separately, never dragged), a yaw
 * (`rotationY`) and one uniform scale. Offering the other handles would let the
 * author produce a transform the entry cannot store, which then snaps back.
 *
 * Everything that is NOT an NPC (zones, placed objects, bones, IK targets) keeps all
 * three axes.
 */
export function gizmoAxes(mode: GizmoMode, target: GizmoTarget): GizmoAxes {
  if (target === 'other') return { x: true, y: true, z: true }
  if (target === 'npc-marker') {
    // Ground-plane move only; Rotate and Scale show no handles on a pin.
    return mode === 'translate' ? { x: true, y: false, z: true } : { x: false, y: false, z: false }
  }
  switch (mode) {
    case 'translate': return { x: true, y: false, z: true }
    case 'rotate': return { x: false, y: true, z: false }
    case 'scale': return { x: true, y: true, z: true } // uniform: the centre handle; see viewport
  }
}

/**
 * Yaw, in degrees in [0, 360), of a rotation about Y given as a quaternion.
 *
 * Deliberately not `Euler.y`: for a pure Y rotation beyond ±90° three's Euler
 * comes back as (π, 180° − yaw, π), so its `y` is the wrong angle. For a pure
 * Y rotation q = (0, sin(θ/2), 0, cos(θ/2)), so θ = 2·atan2(q.y, q.w).
 */
export function yawDegrees(q: { y: number; w: number }): number {
  const deg = (2 * Math.atan2(q.y, q.w) * 180) / Math.PI
  return ((deg % 360) + 360) % 360
}

/** The entry's `scale` for a model whose root scale is `modelScale` (root = base × entry). */
export function entryScaleFor(modelScale: number, baseScale: number): number {
  if (!(baseScale > 0)) return 1
  return modelScale / baseScale
}

/**
 * The uniform scale a gizmo drag asks for, from the scale it produced and the scale
 * at the start of the drag.
 *
 * TransformControls' axis handles scale ONE axis. Forcing uniform by reading `.x`
 * (as the viewport did) makes the Y and Z handles do nothing. Instead take the axis
 * that moved furthest, as a ratio of where it started, and apply that ratio to the
 * starting scale on every axis, so any handle (and the centre handle) scales the model.
 */
export function uniformScaleFrom(
  current: { x: number; y: number; z: number },
  start: { x: number; y: number; z: number },
): number {
  const axes = ['x', 'y', 'z'] as const
  let best: (typeof axes)[number] = 'x'
  let bestDev = -1
  for (const a of axes) {
    if (!(start[a] > 0)) continue
    const dev = Math.abs(current[a] / start[a] - 1)
    if (dev > bestDev) { bestDev = dev; best = a }
  }
  if (!(start[best] > 0)) return current.x
  return start.x * (current[best] / start[best])
}

/** Smallest authored scale: dragging the handle through zero must not mirror or erase an NPC. */
export const MIN_ENTRY_SCALE = 0.01

/** Round for the inspector / persisted draft: sub-0.005° and sub-0.0005 noise is not authored data. */
export function roundYaw(deg: number): number {
  // Normalise after rounding: 359.996 rounds to 360, which is outside [0, 360).
  return (((Math.round(deg * 100) / 100) % 360) + 360) % 360
}
export function roundScale(scale: number): number {
  return Math.max(MIN_ENTRY_SCALE, Math.round(scale * 10000) / 10000)
}

/**
 * A yaw to publish, or `undefined` when it equals the entry's authored value at the
 * precision we round to. A translate-only drag must not rewrite an authored
 * `rotationY: -45` as 315, or `undefined` as 0 (and must not round 33.333 to 33.33).
 * Compared modulo 360 so -45 and 315 are the same angle.
 */
export function changedYaw(newDeg: number, entryDeg: number | undefined): number | undefined {
  const rounded = roundYaw(newDeg)
  const authored = roundYaw(entryDeg ?? 0)
  const diff = Math.abs(rounded - authored)
  return Math.min(diff, 360 - diff) < 0.005 ? undefined : rounded
}

/** A scale to publish, or `undefined` when it equals the entry's (default 1) at 4 dp. */
export function changedScale(newScale: number, entryScale: number | undefined): number | undefined {
  const rounded = roundScale(newScale)
  const authored = roundScale(entryScale ?? 1)
  return Math.abs(rounded - authored) < 0.00005 ? undefined : rounded
}

/**
 * Entries of `next` that are new or whose object identity differs from the last one
 * applied, recording them in `seen`. The live-transform map is replaced wholesale on
 * every publish, copying all other entries by reference, so identity is exactly "this
 * id was published since last time". Applying every entry each time (as the host did)
 * lets a stale gizmo-published rotation/scale overwrite a value typed in the inspector.
 */
export function entriesToApply<T>(next: ReadonlyMap<string, T>, seen: Map<string, T>): [string, T][] {
  const out: [string, T][] = []
  for (const [id, v] of next) {
    if (seen.get(id) !== v) {
      seen.set(id, v)
      out.push([id, v])
    }
  }
  for (const id of [...seen.keys()]) if (!next.has(id)) seen.delete(id)
  return out
}
