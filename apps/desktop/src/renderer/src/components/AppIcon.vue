<script setup lang="ts">
import type { IconName } from "../types/workspace";

withDefaults(defineProps<{ name: IconName; size?: number }>(), { size: 18 });
</script>

<template>
  <svg
    :width="size"
    :height="size"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.8"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <template v-if="name === 'logo'">
      <image href="/app-icon.png" x="0" y="0" width="24" height="24" />
    </template>
    <template v-else-if="name === 'plus'">
      <path d="M12 5v14M5 12h14" />
    </template>
    <template v-else-if="name === 'close'">
      <path d="m6 6 12 12M18 6 6 18" />
    </template>
    <template v-else-if="name === 'directory'">
      <path d="M3.5 6.5h6l2 2h9v9.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z" />
      <path d="M3.5 9h17" />
    </template>
    <template v-else-if="name === 'download'">
      <path d="M12 3v12M7 10l5 5 5-5M5 20h14" />
    </template>
    <template v-else-if="name === 'edit'">
      <path d="M4 20h4l11-11a2.8 2.8 0 0 0-4-4L4 16zM13.5 6.5l4 4M4 16l4 4" />
    </template>
    <template v-else-if="name === 'model'">
      <path d="m12 3 7 4v10l-7 4-7-4V7z" />
      <path d="m5 7 7 4 7-4M12 11v10" />
    </template>
    <template v-else-if="name === 'wand'">
      <path d="m15 4 5 5L9 20H4v-5zM13 6l5 5" />
      <path d="M6 3v3M4.5 4.5h3M19 15v4M17 17h4" />
    </template>
    <template v-else-if="name === 'more'">
      <circle cx="5" cy="12" r="1" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" />
      <circle cx="19" cy="12" r="1" fill="currentColor" stroke="none" />
    </template>
    <template v-else-if="name === 'panel-left'">
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M9 4v16" />
    </template>
    <template v-else-if="name === 'panel-right'">
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M15 4v16" />
    </template>
    <template v-else-if="name === 'pin'">
      <path d="m8 3 8 8M14.5 4.5l5 5-3 1-4.5 4.5-1 4-6-6 4-1 4.5-4.5zM9 17l-5 5" />
    </template>
    <template v-else-if="name === 'chevron'">
      <path d="m9 6 6 6-6 6" />
    </template>
    <template v-else-if="name === 'book'">
      <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H11v16H6.5A2.5 2.5 0 0 0 4 21.5zM20 5.5A2.5 2.5 0 0 0 17.5 3H13v16h4.5a2.5 2.5 0 0 1 2.5 2.5z" />
    </template>
    <template v-else-if="name === 'library'">
      <path d="M5 4h4v16H5zM10 4h4v16h-4zM15.5 5l3.5-1 3.5 14-3.5 1z" />
    </template>
    <template v-else-if="name === 'archive'">
      <path d="M4 7h16v13H4zM3 4h18v3H3zM9 11h6" />
    </template>
    <template v-else-if="name === 'folder'">
      <path d="M3.5 6.5h6l2 2h9v9.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z" />
    </template>
    <template v-else-if="name === 'file'">
      <path d="M6 3.5h8l4 4V20H6zM14 3.5V8h4" />
    </template>
    <template v-else-if="name === 'image'">
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <circle cx="8.5" cy="9" r="1.5" />
      <path d="m5 18 5-5 3 3 2-2 4 4" />
    </template>
    <template v-else-if="name === 'globe'">
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" />
    </template>
    <template v-else-if="name === 'user'">
      <circle cx="12" cy="8" r="3" />
      <path d="M5.5 20a6.5 6.5 0 0 1 13 0" />
    </template>
    <template v-else-if="name === 'ledger'">
      <path d="M5 3.5h14V21H5zM8 3.5v17M11 8h5M11 12h5M11 16h4" />
    </template>
    <template v-else-if="name === 'sparkles'">
      <path d="m12 3 1.2 3.8L17 8l-3.8 1.2L12 13l-1.2-3.8L7 8l3.8-1.2zM18.5 14l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8zM5 13l.8 2.2 2.2.8-2.2.8L5 19l-.8-2.2L2 16l2.2-.8z" />
    </template>
    <template v-else-if="name === 'history'">
      <path d="M4 6v5h5M4.8 10A8 8 0 1 1 6 17.5" />
      <path d="M12 8v5l3 2" />
    </template>
    <template v-else-if="name === 'message'">
      <path d="M5 5h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H9l-5 4v-4a2 2 0 0 1-1-2V7a2 2 0 0 1 2-2Z" />
    </template>
    <template v-else-if="name === 'attach'">
      <path d="m8.5 12.5 5.7-5.7a3 3 0 0 1 4.2 4.2l-7.8 7.8a5 5 0 0 1-7.1-7.1l7.8-7.8" />
    </template>
    <template v-else-if="name === 'brain'">
      <path d="M9.5 5.5A3 3 0 0 0 4.8 8a3.2 3.2 0 0 0 .2 6 3 3 0 0 0 4.5 3.5M14.5 5.5A3 3 0 0 1 19.2 8a3.2 3.2 0 0 1-.2 6 3 3 0 0 1-4.5 3.5M12 4v16M8 10h4M12 14h4" />
    </template>
    <template v-else-if="name === 'temperature'">
      <path d="M10 14.8V5a2 2 0 0 1 4 0v9.8a4 4 0 1 1-4 0Z" />
      <path d="M12 8v8" />
    </template>
    <template v-else-if="name === 'mic'">
      <rect x="9" y="3" width="6" height="12" rx="3" />
      <path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3M9 21h6" />
    </template>
    <template v-else-if="name === 'arrow-up'">
      <path d="m7 11 5-5 5 5M12 6v12" />
    </template>
    <template v-else-if="name === 'stop'">
      <rect x="6.5" y="6.5" width="11" height="11" rx="1.5" fill="currentColor" stroke="none" />
    </template>
    <template v-else-if="name === 'search'">
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="m15.5 15.5 4 4" />
    </template>
    <template v-else-if="name === 'settings'">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </template>
    <template v-else-if="name === 'save'">
      <path d="M5 3.5h12l2 2V20H5zM8 3.5v6h8v-6M8 20v-6h8v6" />
    </template>
    <template v-else-if="name === 'bold'">
      <path d="M8 5h5a4 4 0 0 1 0 8H8zM8 13h6a3.5 3.5 0 0 1 0 7H8z" />
    </template>
    <template v-else-if="name === 'italic'">
      <path d="M10 4h8M6 20h8M14 4 10 20" />
    </template>
    <template v-else-if="name === 'keyboard'">
      <rect x="2" y="6" width="20" height="12" rx="2" />
      <path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M8 14h8" />
    </template>
    <template v-else-if="name === 'quote'">
      <path d="M5 8h5v5H6a4 4 0 0 1 4-4M14 8h5v5h-4a4 4 0 0 1 4-4" />
    </template>
    <template v-else-if="name === 'check'">
      <path d="m5 12 4 4L19 6" />
    </template>
    <template v-else-if="name === 'copy'">
      <rect x="8" y="8" width="11" height="12" rx="2" />
      <path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h3" />
    </template>
    <template v-else-if="name === 'terminal'">
      <rect x="3" y="4" width="18" height="16" rx="3" />
      <path d="m7 9 3 3-3 3M12.5 15H17" />
    </template>
    <template v-else-if="name === 'trash'">
      <path d="M4 7h16M9 7V4h6v3M7 7l1 14h8l1-14M10 11v6M14 11v6" />
    </template>
  </svg>
</template>
