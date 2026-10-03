/**
 * Which hierarchy section a selection belongs to (E9).
 *
 * The left panel's NPC / Object / Zone sections are collapsed on a fresh load and
 * open themselves when something of their kind becomes selected, by row click,
 * viewport click, or after an add (an add auto-selects, so one rule covers both).
 * This is the whole rule, pure so it can be tested without a component.
 *
 * Player View, Scene Settings and "nothing selected" belong to no section, so they
 * never force one open.
 */
import type { EditorSelection } from '../sceneEditorTypes'

export type HierarchySectionId = 'npcs' | 'objects' | 'zones'

export function sectionForSelection(sel: EditorSelection): HierarchySectionId | null {
  switch (sel?.kind) {
    case 'npc': return 'npcs'
    case 'placed': return 'objects'
    case 'zone': return 'zones'
    default: return null
  }
}

/**
 * Stable identity of a selection, so "the selection changed" can be told apart from
 * "the same selection was re-announced". A section opens on a change to a new key,
 * and does not force itself open again while the user holds the same selection and
 * has collapsed it.
 */
export function selectionKey(sel: EditorSelection): string {
  if (!sel) return ''
  switch (sel.kind) {
    case 'npc': return `npc:${sel.entityId}`
    case 'zone': return `zone:${sel.id}`
    case 'placed': return `placed:${sel.objectId}`
    default: return sel.kind
  }
}
