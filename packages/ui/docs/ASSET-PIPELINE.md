# Asset Pipeline — `@base/ui` Editor

> **Status:** Design — work unit W1 of Editor Phase 2. Created 2026-05-11.
> **Plan:** [`C:\Users\bip\.claude\plans\fluffy-foraging-dusk.md`](file:///C:/Users/bip/.claude/plans/fluffy-foraging-dusk.md)
> **Roadmap:** [`docs/roadmap/01-editor-roadmap.md §Phase 2`](../../../../docs/roadmap/01-editor-roadmap.md)
> **Phase 1 decisions:** [`expressive-petting-pinwheel.md`](file:///C:/Users/bip/.claude/plans/expressive-petting-pinwheel.md) (D-1..D-6 resolved 2026-05-10)

This document is the contract for the asset pipeline that ships with the `@base/ui` editor. It defines how authors get GLBs into the editor, how those assets are persisted, how they are addressed inside scene descriptors, and how the runtime turns an address back into a loadable URL.

The implementation lands across three PRs (W1 = this doc, W2 = registry + upload + thumbnails, W3 = picker). This doc is frozen on W1 landing — material changes after that require a follow-up plan and an update to this file.

---

## Background

The editor today resolves GLBs by hand-typed `/public/...` URLs baked into source-checked scene configs. That is incompatible with the end-state intent: a web-served editor where a non-developer author uploads assets through the UI, manipulates a scene, and downloads a ZIP package the player consumes. The asset pipeline is the bridge between "I have a `.glb` file on my desktop" and "this scene descriptor references that asset."

Four features deliver the pipeline:

- **F-A1** — Upload UI (drag-drop + picker fallback) inside the editor hierarchy.
- **F-A2** — Asset registry (Dexie schema + Pinia store + blob-URL resolver).
- **F-A3** — Asset picker modal (filterable, kind-aware).
- **F-A4** — Thumbnail generator (offscreen GLB render → 256×256 PNG, persisted alongside the blob).

This doc binds them together with one mental model.

---

## Three-layer model

The pipeline rests on three distinct address spaces that must not be conflated.

```
┌──────────────────────────────────────────────────────────────────────┐
│ Layer 1 — ASSET                                                      │
│   Binary blob + metadata, IndexedDB-resident, survives reloads       │
│   Schema:   { id, name, kind, size, contentType, blob,               │
│               clipNames?, thumbnail?, createdAt, tags?[] }           │
│   Location: assetDb.assets (Dexie)                                   │
└──────────────────────────────────────────────────────────────────────┘
                              │ resolved by
                              ▼
┌──────────────────────────────────────────────────────────────────────┐
│ Layer 2 — LOGICAL ID                                                 │
│   String `asset-<nanoid>`, descriptor-resident, portable across      │
│   storage backends (IndexedDB today, OPFS or HTTP later)             │
│   Survives the ZIP package round-trip via assets/<id>.<ext>          │
│   Example: 'asset-V1StGXR8_Z5jdHi6B-myT'                             │
└──────────────────────────────────────────────────────────────────────┘
                              │ resolved by
                              ▼
┌──────────────────────────────────────────────────────────────────────┐
│ Layer 3 — BLOB URL                                                   │
│   `blob:https://...` string, session-lived, what THREE.GLTFLoader    │
│   actually consumes. Created with URL.createObjectURL(blob).         │
│   Revoked on asset deletion or page unload.                          │
│   Cached in-memory by useAssetStore (Map<assetId, blobUrl>).         │
└──────────────────────────────────────────────────────────────────────┘
```

**Why three layers and not two:**

- Layer 1 ↔ Layer 3 directly would tie the descriptor to a session-specific URL — a hard-refresh would orphan every reference.
- Layer 1 ↔ Layer 2 directly would force the runtime to query Dexie on every GLB load — costly and synchronous-feeling.
- Layer 2 in the middle decouples the descriptor (long-lived, exported in TS and ZIP) from the storage backend (IndexedDB today, anything tomorrow).

**Field reinterpretation note (D-3):** the existing `GltfObject.url` field in `SHARED/packages/scene-builder/src/SceneDescriptor.ts` is preserved as-is in Phase 2 — its semantic reinterpretation from "served path under /public" to "logical asset ID" lands in Phase 3 with F-9 (NPC entry asset binding). No `SceneDescriptor.ts` change in this Phase.

---

## Dexie schema (v1)

The schema is **frozen on W2 landing**. Any change requires a `version(2).stores(...).upgrade(...)` block following the personal-planner pattern at [`apps/personal-planner/src/db/index.ts:34-184`](../../../../apps/personal-planner/src/db/index.ts).

### Database

- Database name: `@base-assets`
- Class: `class AssetDb extends Dexie` exported from `@base/ui/src/editor/assetDb.ts`
- Singleton: `export const assetDb = new AssetDb()`

### Table `assets`

```ts
interface AssetRow {
  id: string              // 'asset-<nanoid>' — primary key
  name: string            // original filename, e.g. 'father_60yo.glb'
  kind: AssetKind         // see enum below
  size: number            // bytes (blob.size)
  contentType: string     // 'model/gltf-binary' | 'model/gltf+json' | 'application/octet-stream' for .fbx
  blob: Blob              // the file itself
  clipNames?: string[]    // populated for GLBs that contain animations
  thumbnail?: Blob        // 256×256 PNG, generated at upload time
  createdAt: string       // ISO 8601
  tags?: string[]         // freeform — reserved for future F-A3 picker filters
}

type AssetKind =
  | 'character'           // skinned mesh intended as an NPC body
  | 'prop'                // small static GLB (rock, tree, crystal, pillar)
  | 'environment'         // large static GLB (terrain, room mesh, sky dome)
  | 'animation-pack'      // GLB whose value is its animation clips, not its mesh
```

### Indices

Dexie store string: `'id, name, kind, *tags, createdAt'`

- `id` — primary key
- `name` — searchable in picker
- `kind` — filter chip in picker (F-A3)
- `*tags` — multi-entry index for future tag filtering
- `createdAt` — sortable "recent first"

`size`, `contentType`, `blob`, `clipNames`, `thumbnail` are stored on the row but **not indexed** — they are read by primary key only.

### Frozen-once-shipped block

W2's `assetDb.ts` ends with the same comment block as [`PlannerDb`](../../../../apps/personal-planner/src/db/index.ts):

```
// ---------------------------------------------------------------------
// Migration template — DO NOT REMOVE
// ---------------------------------------------------------------------
// Once shipped, a version() block is FROZEN. To change schema (add/remove
// indices, rename fields, split tables), bump the version and provide a
// new .upgrade() callback. ...
```

---

## API surface

The public exports from `@base/ui` after Phase 2:

```ts
// Types
export type { AssetRow, AssetKind } from './editor/assetDb'

// Store
export { useAssetStore } from './editor/useAssetStore'

// Components
export { default as AssetPicker } from './editor/AssetPicker.vue'
```

Internal-only (used by `SceneEditorHierarchy.vue` and host code, not exported):

- `assetDb` singleton (callers go through the store)
- `useLiveQuery` composable (utility for future stores)
- `generateThumbnail` function
- `SceneEditorAssetsSection.vue` component

### `useAssetStore` — setup-store, Pinia

Mirrors [`apps/personal-planner/src/stores/categories.ts:36-169`](../../../../apps/personal-planner/src/stores/categories.ts) shape.

```ts
export const useAssetStore = defineStore('assets', () => {
  // State
  const assets: Readonly<Ref<AssetRow[]>>       // live-queried from assetDb.assets

  // Methods
  async function upload(file: File): Promise<string>           // returns assetId
  function getById(id: string): AssetRow | undefined
  function resolveBlobUrl(id: string): string | null           // cached, session-lived
  async function remove(id: string): Promise<void>             // revokes URL + deletes row

  return { assets, upload, getById, resolveBlobUrl, remove }
})
```

#### `upload(file)` flow

1. Validate `file.name` extension against `kind` heuristics (see Q3 below) — infer `kind` or default to `'prop'`.
2. Read `file` into an `ArrayBuffer` once. Reuse for steps 3 + 4.
3. For GLBs: parse via `GLTFLoader.parseAsync(arrayBuffer)` to extract `gltf.animations.map(a => a.name)` → `clipNames`.
4. Generate thumbnail via `generateThumbnail(blob)` (sync — blocks upload by design, Q4).
5. Build `AssetRow` with `id = \`asset-${nanoid()}\``, write to Dexie.
6. Return the new `id`.

Errors at any step surface as a thrown exception with a typed reason (`'invalid-file-type'`, `'parse-failed'`, `'thumbnail-failed'`, `'dexie-write-failed'`). The Assets section UI catches and displays per-row.

#### `resolveBlobUrl(id)` discipline

- First call for an `id` → `URL.createObjectURL(row.blob)`, cache in `Map<id, string>`, return.
- Subsequent calls → return cached URL.
- `remove(id)` → `URL.revokeObjectURL(cached)`, drop from map, delete Dexie row.
- Page unload → blob URLs auto-revoke. No explicit cleanup needed.

Returning `null` for unknown IDs is deliberate — callers (the future scene-builder resolver in Phase 3) treat null as "asset missing" and render a placeholder rather than crashing.

### `generateThumbnail(blob)` — function, sync per call

Creates and disposes a `WebGLRenderer` per call. No persistent offscreen renderer is kept alive.

```ts
async function generateThumbnail(blob: Blob): Promise<Blob>
```

1. Create a 256×256 `OffscreenCanvas` (or `<canvas>` fallback for browsers without `OffscreenCanvas`).
2. Instantiate `new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true })`.
3. Build a small scene: ambient + directional light.
4. Parse the GLB via `GLTFLoader.parseAsync(arrayBuffer)`.
5. Add `gltf.scene` to the scene, compute `Box3.setFromObject(gltf.scene)`.
6. Set up an `OrthographicCamera` framed to the bounding box (slight 3/4 angle).
7. Render one frame.
8. `await canvas.convertToBlob({ type: 'image/png' })`.
9. Dispose renderer + scene + geometries + materials.
10. Return the PNG blob.

Errors → throw. Caller catches and stores the row without a thumbnail; UI falls back to a "no preview" placeholder. The row is still usable.

### `AssetPicker` — modal component (W3)

```vue
<AssetPicker
  :open="pickerOpen"
  :kind-filter="'character'"
  @close="pickerOpen = false"
  @select="(assetId) => onSelect(assetId)"
/>
```

`<dialog>`-based. Lists assets from the store, filtered by `kindFilter` if provided. Each row: thumbnail + name + clip-count badge (for animation-pack and character kinds). Escape closes without selection.

---

## Resolver pattern (Phase 3 hookpoint)

This doc declares the contract; the wiring lands in Phase 3, not Phase 2.

When the scene-builder loads a `GltfObject` in Phase 3, the URL field is interpreted as a logical asset ID and resolved through the store:

```ts
// Pseudocode for the Phase 3 resolver — not implemented in Phase 2
function resolveGltfUrl(urlOrAssetId: string): string | null {
  if (urlOrAssetId.startsWith('asset-')) {
    return useAssetStore().resolveBlobUrl(urlOrAssetId)
  }
  return urlOrAssetId // legacy /public path
}
```

Two practical implications:

1. **`SHARED/packages/threejs-engine/src/AssetLoader.ts:91-114`** stays untouched. The resolver intercepts at the scene-builder layer, before `loadGLTF(url)` is called. `AssetLoader` continues to consume URLs (blob URLs are URLs).
2. **Legacy `/public/...` paths keep working** during the transition — the prefix check provides backward compatibility per D-5's piecewise migration plan.

---

## Decisions record (Q1–Q7)

Settled in this plan; revisit only with explicit new requirements.

| # | Question | Resolution | Why not the alternative |
|---|----------|------------|-------------------------|
| Q1 | Package location | `@base/ui` (add deps) | New `@base/asset-registry` sibling deferred until a second consumer exists; today everything that touches assets lives in the editor surface. |
| Q2 | Sequencing | Design-doc-first → bundled W2 → picker W3 | Single bundled PR has too much review surface for the first introduction of Dexie + Pinia + fflate to `@base/ui`. Strict per-feature PRs fragment a tightly-coupled foundation. |
| Q3 | `kind` enum | `character` / `prop` / `environment` / `animation-pack` | Texture kind deferred until F-LE5 (legacy GLB-placement migration) needs it. Heuristics for inference at upload time: `.fbx` → `animation-pack` (Mixamo convention); GLB with `>0 skinned meshes && >0 animations` → `character`; GLB with `>0 animations && 0 skinned meshes` → `animation-pack`; GLB `bbox > 20m diagonal` → `environment`; else → `prop`. User can override via dropdown on the row. |
| Q4 | Thumbnail timing | Synchronous on upload | Background-job path needs a queue + retry + UI state for "thumbnail pending" — premature complexity. Current GLB sizes (1–2MB post-optimize per memory) keep the ≈1s sync budget honest. |
| Q5 | Store shape | Single `useAssetStore` setup-store | Splitting upload + library adds coordination cost (two stores both watching `assetDb.assets`) for no current benefit. The store's surface area is small enough to keep cohesive. |
| Q6 | First consumer host | `threejs-engine-dev/src/views/SceneEditorPage.vue` only | three-dreams + three-dbox host pages inherit the section automatically once they rebuild, but no project-side rebuild is scheduled in Phase 2 — they stay on URL-typed configs until Phase 3 F-9 lands. |
| Q7 | `useLiveQuery` shape | Mirror the personal-planner composable in `@base/ui/src/editor/useLiveQuery.ts` | Lets future stores in `@base/ui` use the same primitive without inventing a second style. Internal-only (not exported). |

---

## Acceptance criteria

### W1 (this PR)
- [ ] `SHARED/packages/ui/docs/ASSET-PIPELINE.md` exists and renders cleanly
- [ ] `git status` shows only the one new `.md` file
- [ ] No `.ts` / `.vue` / `package.json` modified

### W2 (registry + upload + thumbnails)
- [ ] `pnpm --filter @base/ui build` succeeds clean (vue-tsc + vite)
- [ ] Existing engine-dev `/scene-editor` route (Sandbox + scene-01 + scene-02) loads unchanged
- [ ] Drag a `.glb` into the Assets section → row appears with thumbnail + name + kind badge
- [ ] Hard-refresh → asset row + thumbnail still present (persistence)
- [ ] Chrome DevTools → Application → IndexedDB → `@base-assets` → `assets` shows row with populated `blob` + `thumbnail`
- [ ] Drop a `.txt` → row shows error, no Dexie write
- [ ] Generated PNG visually shows the GLB (not blank, not all-black)
- [ ] No console errors / warnings during upload flow

### W3 (picker)
- [ ] Picker opens from Asset row "Use…" button
- [ ] Picker is pre-filtered to source row's kind
- [ ] Click row → modal closes, status bar logs `Selected asset: <id>`
- [ ] Escape closes the picker without selection emission

### Phase 2 done (all three landed)
- Assets section permanent in the editor sidebar across all hosts
- Phase 3 (F-9 NPC asset binding) can import `useAssetStore` + `AssetPicker` without touching registry internals
- DASHBOARD decisions log has three rows capturing W1 / W2 / W3
- Roadmap statuses: F-A1 ✅ · F-A2 ✅ · F-A3 ✅ · F-A4 ✅

---

## Out of scope

- Asset deletion UX beyond `remove(id)` — bulk-select, undo, archive — backlog
- Tagging UX — `tags` index exists in v1 schema but no UI authors it yet
- Texture asset kind — deferred until F-LE5 needs it
- HTTP-served asset registry (logical IDs over a remote backend) — D-3 keeps the descriptor portable, but the only resolver Phase 2 ships is IndexedDB-backed
- Modifying `SceneDescriptor.ts` `GltfObject` semantics — Phase 3 with F-9
- Wiring the Assets section into legacy `EditorView.vue` (engine-dev) — D-5 piecewise migration; legacy stays on URL-typed configs until M-FINAL
- ZIP package format and round-trip (F-A5 / F-A6 / F-A7) — Phase 5
- Reaction authoring panel (F-R1) — Phase 6, D-6 deferred
