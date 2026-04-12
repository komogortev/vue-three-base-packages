/**
 * Default orbit-camera bookmarks for the scene editor top bar.
 *
 * Extracted from both harnesses (threejs-engine-dev + three-dreams) where the
 * file was identical. Host pages may pass a custom set via the `orbitBookmarks`
 * prop on SceneEditorView; these defaults are used when no override is provided.
 */
import type { EditorOrbitBookmark } from './sceneEditorTypes'

/**
 * Ids of orbit presets where WASD moves the session avatar (camera-relative)
 * during play-simulation. Only relevant in harnesses that wire up walk mode.
 */
export const EDITOR_ORBIT_LOCOMOTION_IDS = new Set<string>(['author', 'bird'])

export const EDITOR_ORBIT_BOOKMARKS: EditorOrbitBookmark[] = [
  {
    id:     'overview',
    label:  'Overview',
    camera: [0, 45, 50],
    target: [0, 0, 0],
  },
  {
    id:     'author',
    label:  'Author',
    camera: [0, 14, 24],
    target: [0, 3.5, 0],
  },
  {
    id:     'bird',
    label:  'Bird-eye',
    camera: [0, 72, 0.15],
    target: [0, 0, 0],
  },
  {
    id:     'corner',
    label:  'Corner',
    camera: [38, 22, 38],
    target: [0, 2, 0],
  },
]
