/**
 * Editor marker registry — NPC / zone / spawn marker meshes and their lookups.
 *
 * Decomposition stage 2: unlike the stage-1 kernels this one owns THREE state,
 * so it is a factory rather than a pure module. It exists because the marker
 * maps are read from four unrelated parts of `useSceneEditorViewport` —
 * selection, raycasting, pose attachment and gesture revert — which is why the
 * marker code could not simply be lifted out: the *registry* has to be the
 * shared thing, not the construction functions.
 *
 * The lookups are private; consumers get read accessors (`npcRoot(id)`,
 * `npcSphereMeshes()`, …) rather than the Maps themselves. The invariant worth
 * protecting is that a root present in a lookup is also a child of its group —
 * handing out a mutable Map lets any caller break that from the outside.
 */
import * as THREE from 'three'

import type { EditorNpcEntry, EditorZoneEntry, SceneEditorConfig } from '../sceneEditorTypes'
import { NPC_MARKER_COLOR, NPC_STEM_COLOR, zoneColorHex } from './markerStyle'

export interface NpcLivePos {
  x: number
  y: number
  z: number
}

export interface ZoneLivePos {
  x: number
  z: number
}

export interface MarkerRegistry {
  /** Scene-level container for NPC markers. Added to the scene once, at init. */
  readonly npcGroup: THREE.Group
  /** Scene-level container for zone markers. Added to the scene once, at init. */
  readonly zoneGroup: THREE.Group

  /** Marker root group for an NPC — TransformControls attaches here. */
  npcRoot(entityId: string): THREE.Group | undefined
  /** Marker root group for a zone (ring + pip move together). */
  zoneRoot(id: string): THREE.Group | undefined
  /** Clickable head sphere for an NPC. */
  npcSphere(entityId: string): THREE.Mesh | undefined
  /** Clickable pip for a zone. */
  zonePip(id: string): THREE.Mesh | undefined

  /** id/root pairs, for highlight sweeps and live-position syncs. */
  npcRootEntries(): [string, THREE.Group][]
  zoneRootEntries(): [string, THREE.Group][]
  /** id/mesh pairs, for resolving a raycast hit back to an id. */
  npcSphereEntries(): [string, THREE.Mesh][]
  zonePipEntries(): [string, THREE.Mesh][]
  /** Click targets, for `raycaster.intersectObjects`. */
  npcSphereMeshes(): THREE.Mesh[]
  zonePipMeshes(): THREE.Mesh[]

  /** Rebuild all NPC markers from config; returns their live positions. */
  buildNpcs(cfg: SceneEditorConfig): Map<string, NpcLivePos>
  /** Rebuild all zone markers from config; returns their live positions. */
  buildZones(cfg: SceneEditorConfig): Map<string, ZoneLivePos>
  /**
   * Build the spawn-point octahedron, or null when the config has no spawn.
   * The caller owns adding it to the scene and tracking it for teardown — the
   * spawn marker is a scene object, not part of either marker group.
   */
  buildSpawnMesh(cfg: SceneEditorConfig): THREE.Mesh | null

  addNpc(npc: EditorNpcEntry): void
  removeNpc(entityId: string): void
  addZone(zone: EditorZoneEntry): void
  removeZone(id: string): void

  /** Scene-switch teardown: dispose per-marker resources and empty every lookup. */
  clear(): void
  /** Unmount teardown: release shared geometry and drop every lookup. */
  dispose(): void
}

export function createMarkerRegistry(): MarkerRegistry {
  const npcGroup = new THREE.Group()
  const zoneGroup = new THREE.Group()

  const npcRoots = new Map<string, THREE.Group>()
  const zoneRoots = new Map<string, THREE.Group>()
  const npcSpheres = new Map<string, THREE.Mesh>()
  const zonePips = new Map<string, THREE.Mesh>()

  // Shared across every NPC marker — see the disposal note on clear().
  const npcSphereGeo = new THREE.SphereGeometry(0.35, 12, 8)

  function addNpc(npc: EditorNpcEntry): void {
    const markerRoot = new THREE.Group()
    markerRoot.position.set(npc.x, npc.y ?? 0, npc.z)

    const sphere = new THREE.Mesh(
      npcSphereGeo,
      new THREE.MeshBasicMaterial({ color: NPC_MARKER_COLOR }),
    )
    sphere.position.set(0, 0.9, 0)
    markerRoot.add(sphere)
    npcSpheres.set(npc.entityId, sphere)

    const stem = new THREE.Mesh(
      new THREE.CylinderGeometry(0.04, 0.04, 0.9, 6),
      new THREE.MeshBasicMaterial({ color: NPC_STEM_COLOR }),
    )
    stem.position.set(0, 0.45, 0)
    markerRoot.add(stem)

    if (npc.proximityRadius && npc.proximityRadius > 0) {
      const r = npc.proximityRadius
      const ringGeo = new THREE.RingGeometry(r - 0.06, r + 0.06, 56)
      ringGeo.rotateX(-Math.PI / 2)
      const ring = new THREE.Mesh(
        ringGeo,
        new THREE.MeshBasicMaterial({
          color: NPC_MARKER_COLOR,
          transparent: true,
          opacity: 0.22,
          side: THREE.DoubleSide,
        }),
      )
      ring.position.set(0, 0.03, 0)
      markerRoot.add(ring)
    }

    npcGroup.add(markerRoot)
    npcRoots.set(npc.entityId, markerRoot)
  }

  function removeNpc(entityId: string): void {
    const root = npcRoots.get(entityId)
    if (root) npcGroup.remove(root)
    npcRoots.delete(entityId)
    npcSpheres.delete(entityId)
  }

  function addZone(zone: EditorZoneEntry): void {
    const colorHex = zoneColorHex(zone)

    const zoneRoot = new THREE.Group()
    zoneRoot.position.set(zone.x, 0, zone.z)

    const r = zone.radius
    const ringGeo = new THREE.RingGeometry(r - 0.07, r + 0.07, 56)
    ringGeo.rotateX(-Math.PI / 2)
    const ring = new THREE.Mesh(
      ringGeo,
      new THREE.MeshBasicMaterial({
        color: colorHex,
        transparent: true,
        opacity: 0.65,
        side: THREE.DoubleSide,
      }),
    )
    ring.position.set(0, 0.04, 0)
    zoneRoot.add(ring)

    const pip = new THREE.Mesh(
      new THREE.SphereGeometry(0.15, 8, 6),
      new THREE.MeshBasicMaterial({ color: colorHex }),
    )
    pip.position.set(0, 0.18, 0)
    zoneRoot.add(pip)
    zonePips.set(zone.id, pip)

    zoneGroup.add(zoneRoot)
    zoneRoots.set(zone.id, zoneRoot)
  }

  function removeZone(id: string): void {
    const root = zoneRoots.get(id)
    if (root) zoneGroup.remove(root)
    zoneRoots.delete(id)
    zonePips.delete(id)
  }

  function buildNpcs(cfg: SceneEditorConfig): Map<string, NpcLivePos> {
    npcGroup.clear()
    npcSpheres.clear()
    npcRoots.clear()

    const live = new Map<string, NpcLivePos>()
    for (const npc of cfg.npcs ?? []) {
      addNpc(npc)
      live.set(npc.entityId, { x: npc.x, y: npc.y ?? 0, z: npc.z })
    }
    return live
  }

  function buildZones(cfg: SceneEditorConfig): Map<string, ZoneLivePos> {
    zoneGroup.clear()
    zonePips.clear()
    zoneRoots.clear()

    const live = new Map<string, ZoneLivePos>()
    for (const zone of cfg.zones ?? []) {
      addZone(zone)
      live.set(zone.id, { x: zone.x, z: zone.z })
    }
    return live
  }

  function buildSpawnMesh(cfg: SceneEditorConfig): THREE.Mesh | null {
    if (!cfg.spawnPoint) return null
    const { x, z } = cfg.spawnPoint
    const mesh = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.3),
      new THREE.MeshBasicMaterial({ color: '#ff44ff' }),
    )
    mesh.position.set(x, 0.4, z)
    return mesh
  }

  /**
   * NOTE — carried over verbatim from the original `clearScene`, deliberately
   * not "fixed" during extraction: this disposes the geometry of every mesh it
   * traverses, and all NPC head spheres share `npcSphereGeo`. So a scene switch
   * disposes a geometry declared as unmount-scoped. three re-uploads from the
   * retained CPU-side attributes on next use, so the observable effect is a
   * redundant re-upload rather than a broken marker — but the intent and the
   * behaviour disagree. Flagged, not changed: a refactor is the wrong place to
   * alter disposal semantics.
   */
  function clear(): void {
    for (const group of [npcGroup, zoneGroup]) {
      group.traverse((obj) => {
        const m = obj as THREE.Mesh
        if (m.isMesh) {
          m.geometry?.dispose()
          const mat = m.material as THREE.Material | undefined
          mat?.dispose()
        }
      })
      group.clear()
    }
    npcSpheres.clear()
    zonePips.clear()
    npcRoots.clear()
    zoneRoots.clear()
  }

  function dispose(): void {
    npcSphereGeo.dispose()
    // Drop lookups too — the composable used to do this by hand right after
    // calling dispose(); folding it in keeps the teardown in one place. Note
    // this deliberately does NOT dispose per-marker resources: at unmount the
    // scene teardown owns that, and doing it here would change behaviour.
    npcSpheres.clear()
    zonePips.clear()
    npcRoots.clear()
    zoneRoots.clear()
  }

  return {
    npcGroup,
    zoneGroup,
    npcRoot: (id) => npcRoots.get(id),
    zoneRoot: (id) => zoneRoots.get(id),
    npcSphere: (id) => npcSpheres.get(id),
    zonePip: (id) => zonePips.get(id),
    npcRootEntries: () => [...npcRoots],
    zoneRootEntries: () => [...zoneRoots],
    npcSphereEntries: () => [...npcSpheres],
    zonePipEntries: () => [...zonePips],
    npcSphereMeshes: () => [...npcSpheres.values()],
    zonePipMeshes: () => [...zonePips.values()],
    buildNpcs,
    buildZones,
    buildSpawnMesh,
    addNpc,
    removeNpc,
    addZone,
    removeZone,
    clear,
    dispose,
  }
}
