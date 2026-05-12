import Dexie, { type Table } from 'dexie'

/**
 * @base/ui asset registry — IndexedDB schema (Dexie).
 *
 * The asset pipeline contract is defined in
 * `SHARED/packages/ui/docs/ASSET-PIPELINE.md`.
 *
 * Version 1 — initial schema.
 *
 * Once shipped, a version is FROZEN. Schema changes go via a NEW version+upgrade.
 */

export type AssetKind =
  | 'character'      // skinned mesh intended as an NPC body
  | 'prop'           // small static GLB (rock, tree, crystal, pillar)
  | 'environment'   // large static GLB (terrain, room mesh, sky dome)
  | 'animation-pack' // GLB whose value is its animation clips, not its mesh

export interface AssetRow {
  /** 'asset-<nanoid>' — primary key, descriptor-resident logical ID. */
  id: string
  /** Original filename, e.g. 'father_60yo.glb'. */
  name: string
  kind: AssetKind
  /** Bytes — equal to `blob.size`. */
  size: number
  /** 'model/gltf-binary' | 'model/gltf+json' | 'application/octet-stream' (.fbx). */
  contentType: string
  /** The file itself. */
  blob: Blob
  /** Populated for GLBs that contain animations. */
  clipNames?: string[]
  /** 256×256 PNG, generated at upload time. */
  thumbnail?: Blob
  /** ISO 8601 timestamp. */
  createdAt: string
  /** Freeform — reserved for future picker filters. */
  tags?: string[]
}

export class AssetDb extends Dexie {
  assets!: Table<AssetRow, string>

  constructor() {
    super('@base-assets')
    this.version(1).stores({
      // Indices — first field is primary key, subsequent are secondary indices.
      // `size`, `contentType`, `blob`, `clipNames`, `thumbnail` are stored but
      // not indexed — read by primary key only.
      assets: 'id, name, kind, *tags, createdAt',
    })

    // ---------------------------------------------------------------------
    // Migration template — DO NOT REMOVE
    // ---------------------------------------------------------------------
    // Once shipped, a version() block is FROZEN. To change schema (add/remove
    // indices, rename fields, split tables), bump the version and provide a
    // new .upgrade() callback. Dexie applies upgrades in order for users who
    // installed earlier versions.
    //
    // Rules:
    //   - Never edit a shipped version() — only add new versions.
    //   - Test upgrades against a real DB populated at the prior version.
    //   - Tables not listed in a new version() call inherit the prior schema.
    //   - Set a store to `null` to drop it (rare; data loss).
  }
}

export const assetDb = new AssetDb()
