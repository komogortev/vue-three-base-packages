/**
 * Clips the Anim tab can load into the timeline.
 *
 * "Load existing clip" used to list only the clips of the pack bound to the selected NPC.
 * But saving a recorded clip creates a NEW kit in the library without binding it, so
 * clips the author recorded earlier lived in kits the Anim tab never showed. It now
 * lists the clips of every animation kit, the NPC's own pack first. Loading still
 * resolves against the NPC's skeleton and refuses a kit authored for a different one.
 */

export interface LoadableClip {
  /** Unique within the list: `<assetId>::<clipName>`. */
  key: string
  assetId: string
  clipName: string
  /** `kit › clip`, the kit name without its extension. */
  label: string
  /** True for the pack bound to the selected NPC. */
  bound: boolean
}

interface KitLike {
  id: string
  name: string
  kind: string
  clipNames?: string[]
}

/**
 * What saving a NEW kit should do to the NPC it was recorded on: bind it when the NPC has
 * no animation pack yet, and leave an NPC that already has one alone (silently swapping a
 * pack the author chose would change what that NPC plays). `null` = change nothing.
 */
export function bindNewKitPatch(
  npc: { animationPackAssetId?: string } | undefined,
  kitAssetId: string,
): { animationPackAssetId: string } | null {
  if (!npc || npc.animationPackAssetId) return null
  return { animationPackAssetId: kitAssetId }
}

export function clipKey(assetId: string, clipName: string): string {
  return `${assetId}::${clipName}`
}

/** Inverse of `clipKey`. Splits at the first `::` (asset ids never contain it; clip names might). */
export function splitClipKey(key: string): { assetId: string; clipName: string } | null {
  const i = key.indexOf('::')
  if (i < 0) return null
  return { assetId: key.slice(0, i), clipName: key.slice(i + 2) }
}

export function listLoadableClips(assets: readonly KitLike[], boundPackId?: string): LoadableClip[] {
  const out: LoadableClip[] = []
  for (const a of assets) {
    if (a.kind !== 'animation-pack') continue
    const kit = a.name.replace(/\.[^./\\]+$/, '')
    for (const clipName of a.clipNames ?? []) {
      out.push({
        key: clipKey(a.id, clipName),
        assetId: a.id,
        clipName,
        label: `${kit} › ${clipName}`,
        bound: a.id === boundPackId,
      })
    }
  }
  // Stable: the bound pack's clips first, everything else in library order.
  return [...out.filter(c => c.bound), ...out.filter(c => !c.bound)]
}
