import { ref } from 'vue'
import type { PoseBoneNode } from './sceneEditorTypes'

export function usePoseEditor() {
  /** DFS-ordered bone tree of the attached pose mesh (empty = no mesh). */
  const boneList = ref<PoseBoneNode[]>([])
  const selectedBoneName = ref<string | null>(null)

  function setBoneList(nodes: PoseBoneNode[]): void {
    boneList.value = nodes
    selectedBoneName.value = null
  }

  function selectBone(name: string | null): void {
    selectedBoneName.value = name
  }

  function reset(): void {
    boneList.value = []
    selectedBoneName.value = null
  }

  return { boneList, selectedBoneName, setBoneList, selectBone, reset }
}
