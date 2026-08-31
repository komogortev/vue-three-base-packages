/**
 * Marker palette + colour resolution — the data half of marker construction.
 *
 * Mesh building stays in the viewport (it needs THREE); the colours do not.
 * `zoneColorHex` in particular has a sharp edge worth pinning: a numeric colour
 * must be zero-padded to six digits, or 0x00ff88 renders as the three-digit
 * CSS colour "#ff88" — a different colour that still parses.
 */
import type { EditorZoneEntry } from './sceneEditorTypes'

/** NPC marker: head sphere and stem. */
export const NPC_MARKER_COLOR = '#00aaff'
export const NPC_STEM_COLOR = '#0077bb'

/** Default zone ring colours by zone type, used when the entry sets no override. */
export const ZONE_DEFAULT_COLORS: Record<EditorZoneEntry['type'], string> = {
  exit: '#ffdd44',
  proximity: '#44ff88',
}

/** Resolve a zone's ring colour: explicit numeric override, else the type default. */
export function zoneColorHex(zone: Pick<EditorZoneEntry, 'type' | 'color'>): string {
  if (zone.color === undefined || zone.color === null) {
    return ZONE_DEFAULT_COLORS[zone.type] ?? ZONE_DEFAULT_COLORS.proximity
  }
  return `#${zone.color.toString(16).padStart(6, '0')}`
}
