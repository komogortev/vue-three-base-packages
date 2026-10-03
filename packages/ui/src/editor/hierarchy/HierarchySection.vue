<!--
  HierarchySection — one collapsible group in the editor's left panel (E9).

  NPCs, Objects and Zones all use this, so they look and behave identically by
  construction: a chevron + title + count toggle, an optional "+" in the same
  header, rows in the default slot. Open state is owned by the parent
  (`v-model:open`) because the parent opens a section when a selection of its
  kind occurs. See hierarchy/sectionForSelection.ts.
-->
<template>
  <section class="hsec" :class="{ open }">
    <div class="hsec-head">
      <button
        class="hsec-toggle"
        type="button"
        :aria-expanded="open"
        :title="open ? `Collapse ${title}` : `Expand ${title}`"
        @click="emit('update:open', !open)"
      >
        <span class="hsec-chevron" aria-hidden="true">{{ open ? '▾' : '▸' }}</span>
        <span class="hsec-title">{{ title }}</span>
        <span class="hsec-count">{{ count }}</span>
      </button>
      <button
        v-if="addTitle"
        class="hsec-add"
        type="button"
        :title="addTitle"
        :aria-label="addTitle"
        @click="emit('add')"
      >+</button>
    </div>
    <div v-if="open" class="hsec-body">
      <slot />
      <p v-if="count === 0" class="hsec-empty">None</p>
    </div>
  </section>
</template>

<script setup lang="ts">
defineProps<{
  title: string
  count: number
  open: boolean
  /** Tooltip + label for the header "+"; omit for a section with no add action. */
  addTitle?: string
}>()

const emit = defineEmits<{
  'update:open': [open: boolean]
  add: []
}>()
</script>

<style scoped>
.hsec { border-top: 1px solid #182a40; }

.hsec-head {
  display: flex;
  align-items: center;
  gap: 4px;
  padding-right: 8px;
}

/* Whole header is the toggle: a wide, tall target rather than a thin caption. */
.hsec-toggle {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 4px 8px 10px;
  background: transparent;
  border: none;
  color: #5a7a90;
  font-family: inherit;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  text-align: left;
  cursor: pointer;
}
.hsec-toggle:hover { color: #9cc0dc; }
.hsec.open .hsec-toggle { color: #7a9ab4; }

.hsec-chevron { width: 10px; flex-shrink: 0; font-size: 10px; }
.hsec-title { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.hsec-count {
  background: #18304a;
  color: #4a7090;
  font-family: monospace;
  padding: 0 5px;
  border-radius: 8px;
  font-size: 9px;
  letter-spacing: 0;
}

.hsec-add {
  width: 24px;
  height: 24px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  background: transparent;
  border: 1px solid #1e3050;
  border-radius: 4px;
  color: #4a7090;
  font-size: 15px;
  font-weight: bold;
  line-height: 1;
  cursor: pointer;
  transition: color 0.1s, border-color 0.1s, background 0.1s;
}
.hsec-add:hover {
  color: #8ac0e8;
  border-color: rgba(90, 176, 245, 0.45);
  background: rgba(24, 48, 74, 0.5);
}

.hsec-body { padding-bottom: 4px; }
.hsec-empty {
  margin: 0;
  padding: 3px 12px 6px 26px;
  font-size: 10px;
  color: #34506a;
}
</style>
