import { ref } from 'vue'

export function usePoseEditor() {
  const boneList = ref<string[]>([])
  const selectedBoneName = ref<string | null>(null)

  function setBoneList(names: string[]): void {
    boneList.value = names
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
