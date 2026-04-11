/**
 * Scene editor types — purely structural, no Three.js or game imports.
 *
 * Any game fork maps its SceneDescriptor + SceneGameplayPolicy to these types
 * inside a thin page component. The editor package stays dependency-free of
 * game-specific code.
 */

// ─── Scene object descriptors ─────────────────────────────────────────────────

export interface EditorNpcEntry {
  /** Matches the entityId used in the Reaction Engine (e.g. 'npc-dad-scene-01'). */
  entityId: string
  /** Human-readable label shown in the hierarchy. Defaults to entityId. */
  label?: string
  x: number
  z: number
  /** Explicit world Y. If omitted, editor places marker at y=0. */
  y?: number
  /** Proximity trigger radius in metres. Renders as a faded ring in the viewport. */
  proximityRadius?: number
}

export interface EditorZoneEntry {
  /** Stable identifier used for selection state. */
  id: string
  type: 'exit' | 'proximity'
  /** Human-readable label shown in the hierarchy. */
  label?: string
  x: number
  z: number
  radius: number
  /** For exit zones — the scene this zone transitions to. */
  targetSceneId?: string
  /** Override ring colour (hex). Default: exit=0xffdd44, proximity=0x44ff88. */
  color?: number
}

// ─── Editor configuration ─────────────────────────────────────────────────────

export interface SceneEditorConfig {
  /** GLB to load as the raycast floor (navigation mesh). */
  floorGlbUrl: string
  /** Additional GLBs loaded for visual context only (not raycasted). */
  contextGlbUrls?: string[]
  /**
   * Prefix for per-NPC localStorage waypoint keys.
   * Key format: `${storageKeyPrefix}:${entityId}`.
   * If omitted, entityId is used directly as the storage key.
   */
  storageKeyPrefix?: string
  /** NPC entities visible in hierarchy + viewport. */
  npcs?: EditorNpcEntry[]
  /** Trigger zones visible in hierarchy + viewport. */
  zones?: EditorZoneEntry[]
  /** Player spawn point XZ — shown as a magenta diamond in viewport. */
  spawnPoint?: { x: number; z: number }
  /**
   * Prefix for exported TypeScript variable names.
   * e.g. 'SCENE_01' → selected NPC path exports as 'SCENE_01_NPC_DAD_SCENE_01_PATH'.
   */
  exportNamePrefix?: string
}

// ─── Selection state ──────────────────────────────────────────────────────────

export type EditorSelection =
  | { kind: 'npc'; entityId: string }
  | { kind: 'zone'; id: string }
  | { kind: 'scene' }
  | null
