<script setup>
defineProps({ name: { type: String, default: 'spark' }, size: { type: [Number, String], default: 20 } })
const paths = {
  spark: ['m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3Z'],
  plus: ['M12 5v14M5 12h14'],
  home: ['m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1V10Z'],
  search: ['M21 21l-5-5', 'M18 10.5a7.5 7.5 0 1 1-15 0 7.5 7.5 0 0 1 15 0Z'],
  chat: ['M21 11.5a8.5 8.5 0 0 1-8.5 8.5H4l-2 2V11.5A8.5 8.5 0 0 1 10.5 3h2a8.5 8.5 0 0 1 8.5 8.5Z', 'M7 9h9M7 13h6'],
  folder: ['M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v10H3V7Z'],
  settings: ['m9 3-1 3-3 1v4l-2 1 2 1v4l3 1 1 3h6l1-3 3-1v-4l2-1-2-1V7l-3-1-1-3H9Z', 'M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z'],
  panel: ['M4 3h16v18H4V3ZM9 3v18'],
  menu: ['M4 6h16M4 12h16M4 18h16'],
  close: ['m6 6 12 12M6 18 18 6'],
  arrow: ['M5 12h14m-6-6 6 6-6 6'],
  up: ['M12 19V5m-6 6 6-6 6 6'],
  down: ['m6 9 6 6 6-6'],
  code: ['m8 7-5 5 5 5m8-10 5 5-5 5M14 4l-4 16'],
  document: ['M5 3h9l5 5v13H5V3Zm9 0v6h5M8 13h8M8 17h5'],
  globe: ['M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM3 12h18M12 3c5 5 5 13 0 18-5-5-5-13 0-18Z'],
  clock: ['M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM12 7v5l3 2'],
  edit: ['m15 4 5 5M4 20l5-1L21 7l-5-5L4 14v6Z'],
  trash: ['M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7'],
  copy: ['M9 9h12v12H9V9ZM15 6V3H3v12h3'],
  undo: ['M4 4v6h6M4 10a8 8 0 1 1 1 9'],
  stop: ['M6 6h12v12H6V6Z'],
  paperclip: ['m8 12 6-6a3 3 0 0 1 4 4l-8 8a5 5 0 0 1-7-7l8-8a7 7 0 0 1 10 10l-8 8'],
  check: ['m5 12 4 4L19 6'],
  info: ['M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM12 11v6M12 7v.1'],
  link: ['m10 13 4-4M8 15l-1 1a3 3 0 0 1-4-4l5-5a3 3 0 0 1 4 0m0 10a3 3 0 0 0 4 0l5-5a3 3 0 0 0-4-4l-1 1'],
}
</script>

<template>
  <svg :width="size" :height="size" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path v-for="(path, index) in paths[name] || paths.spark" :key="index" :d="path" /></svg>
</template>
