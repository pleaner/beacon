import { raw } from 'hono/html'
import type { FC } from 'hono/jsx'

// Stroke icons drawn for Beacon. They inherit the text colour.
const PATHS = {
  hike: '<path d="M3 20 L9.5 9 L13 15 L15.5 11 L21 20 Z"/><path d="M8 13.5 L10 12 L11.5 13.5"/>',
  run: '<circle cx="15" cy="4.5" r="1.8"/><path d="M6 21 L9.5 15 L13 17 L14 12 L10 10 L7 12"/><path d="M14 12 L17 14.5 L20 13"/><path d="M9.5 15 L12 11.5"/>',
  climb: '<rect x="6" y="3" width="10" height="18" rx="5" transform="rotate(20 11 12)"/><path d="M14.5 7.5 L12.8 12"/>',
  paraglide: '<path d="M3 9 C7 3.5 17 3.5 21 9"/><path d="M3.5 9 L12 18"/><path d="M20.5 9 L12 18"/><path d="M9 6.5 L12 18"/><path d="M15 6.5 L12 18"/><circle cx="12" cy="20" r="1.5"/>',
  mtb: '<circle cx="5.5" cy="16.5" r="3.5"/><circle cx="18.5" cy="16.5" r="3.5"/><path d="M5.5 16.5 L9.5 9 L15 9 L18.5 16.5"/><path d="M9.5 9 L12 16.5 L15 9"/><path d="M8 7 L11 7"/><path d="M14 6 L16 6"/>',
  other: '<circle cx="12" cy="12" r="9"/><path d="M12 7 L13.4 10.6 L17 12 L13.4 13.4 L12 17 L10.6 13.4 L7 12 L10.6 10.6 Z"/>',
  phone: '<path d="M5 3 H9 L11 8 L8.5 9.5 C9.6 11.8 12.2 14.4 14.5 15.5 L16 13 L21 15 V19 C21 20.1 20.1 21 19 21 C10.2 21 3 13.8 3 5 C3 3.9 3.9 3 5 3 Z"/>',
  mobile: '<rect x="7" y="2.5" width="10" height="19" rx="2.5"/><path d="M11 18 H13"/>',
  camera: '<path d="M4 7 H7.5 L9 5 H15 L16.5 7 H20 C20.6 7 21 7.4 21 8 V18 C21 18.6 20.6 19 20 19 H4 C3.4 19 3 18.6 3 18 V8 C3 7.4 3.4 7 4 7 Z"/><circle cx="12" cy="13" r="3.5"/>',
  check: '<path d="M5 12.5 L10 17 L19 7"/>',
  back: '<path d="M15 5 L8 12 L15 19"/>',
  chev: '<path d="M9 5 L16 12 L9 19"/>',
  chevs: '<path d="M6 6 L12 12 L6 18"/><path d="M12 6 L18 12 L12 18"/>',
  down: '<path d="M6 9 L12 15 L18 9"/>',
  bell: '<path d="M6 16 V11 C6 7.7 8.7 5 12 5 C15.3 5 18 7.7 18 11 V16 L20 18 H4 Z"/><path d="M10 21 H14"/>',
  pin: '<path d="M12 21 C12 21 5 14.5 5 9.5 C5 5.9 8.1 3 12 3 C15.9 3 19 5.9 19 9.5 C19 14.5 12 21 12 21 Z"/><circle cx="12" cy="9.5" r="2.5"/>',
  gps: '<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2.5"/><path d="M12 2 V5"/><path d="M12 19 V22"/><path d="M2 12 H5"/><path d="M19 12 H22"/>',
  battery: '<rect x="3" y="7" width="16" height="10" rx="2"/><path d="M21 10.5 V13.5"/><path d="M6 10 V14"/><path d="M9 10 V14"/><path d="M12 10 V14"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7 V12 L15.5 14"/>',
  arrow: '<path d="M5 12 H19"/><path d="M13 6 L19 12 L13 18"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21 C4 16.6 7.6 14 12 14 C16.4 14 20 16.6 20 21"/>',
  userCircle: '<circle cx="12" cy="12" r="9.5"/><circle cx="12" cy="10" r="3"/><path d="M6.5 18.5 C7.8 16.3 9.7 15 12 15 C14.3 15 16.2 16.3 17.5 18.5"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20 C2.5 16.5 5.5 14 9 14 C12.5 14 15.5 16.5 15.5 20"/><circle cx="17" cy="9" r="2.5"/><path d="M17 14 C19.5 14 21.5 16 21.5 19"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3.5 6 L12 13 L20.5 6"/>',
  ext: '<path d="M14 4 H20 V10"/><path d="M20 4 L11 13"/><path d="M18 14 V19 C18 19.6 17.6 20 17 20 H5 C4.4 20 4 19.6 4 19 V7 C4 6.4 4.4 6 5 6 H10"/>',
  shoe: '<path d="M3 16 V9 L8 8 C9 10 11 11 13 11 L19 12.5 C20.2 12.8 21 13.8 21 15 V16 Z"/><path d="M3 19 H21"/>',
  body: '<circle cx="12" cy="4.5" r="2.2"/><path d="M8.5 9 C8.5 8 10 7.5 12 7.5 C14 7.5 15.5 8 15.5 9 V14 H14 L13.5 21"/><path d="M8.5 9 V14 H10 L10.5 21"/>',
  flag: '<path d="M5 21 V4"/><path d="M5 4 H17 L14.5 8 L17 12 H5"/>',
  route: '<circle cx="6" cy="19" r="2"/><circle cx="18" cy="5" r="2"/><path d="M8 19 H15 C17 19 18 17.5 18 16 C18 14.5 17 13 15 13 H9 C7 13 6 11.5 6 10 C6 8.5 7 7 9 7 H16"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12 H21"/><path d="M12 3 C15 6 15 18 12 21 C9 18 9 6 12 3 Z"/>',
  cake: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M4 15.5 C6 17 8 14 10 15.5 C12 17 14 14 16 15.5 C18 17 20 15.5 20 15.5"/><path d="M12 11 V7.5"/><path d="M12 3 C13 4.2 13 5.5 12 5.5 C11 5.5 11 4.2 12 3 Z"/>',
  plan: '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4 V3 H15 V4"/><path d="M9 10 H15"/><path d="M9 14 H13"/>',
  x: '<path d="M6 6 L18 18"/><path d="M18 6 L6 18"/>',
  plus: '<path d="M12 5 V19"/><path d="M5 12 H19"/>',
  menu: '<path d="M4 6 H20"/><path d="M4 12 H20"/><path d="M4 18 H20"/>',
  board: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9 H21"/><path d="M9 9 V20"/>',
  list: '<path d="M9 6 H20"/><path d="M9 12 H20"/><path d="M9 18 H20"/><path d="M4 6 L5 7 L7 5"/><path d="M4 12 L5 13 L7 11"/><path d="M4 18 L5 19 L7 17"/>',
  megaphone: '<path d="M3 11 V13 C3 13.6 3.4 14 4 14 H7 L14 18 V6 L7 10 H4 C3.4 10 3 10.4 3 11 Z"/><path d="M17.5 9 C18.5 10.5 18.5 13.5 17.5 15"/><path d="M7 14 L8 20"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M12 2.5 V5"/><path d="M12 19 V21.5"/><path d="M2.5 12 H5"/><path d="M19 12 H21.5"/><path d="M5.3 5.3 L7 7"/><path d="M17 17 L18.7 18.7"/><path d="M5.3 18.7 L7 17"/><path d="M17 7 L18.7 5.3"/>',
  logout: '<path d="M15 4 H19 C19.6 4 20 4.4 20 5 V19 C20 19.6 19.6 20 19 20 H15"/><path d="M10 16 L14 12 L10 8"/><path d="M14 12 H4"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M16.5 16.5 L21 21"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 10 H20.5"/><path d="M8 3 V7"/><path d="M16 3 V7"/>',
  alert: '<circle cx="12" cy="12" r="3"/><path d="M6.3 6.3 A8 8 0 0 0 6.3 17.7"/><path d="M17.7 6.3 A8 8 0 0 1 17.7 17.7"/>',
} as const

export type IconName = keyof typeof PATHS

export const Icon: FC<{ name: IconName; size?: number; stroke?: number; class?: string }> = ({ name, size = 22, stroke = 2, class: cls }) =>
  raw(
    `<svg class="${cls ? `icon ${cls}` : 'icon'}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" ` +
      `stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${PATHS[name]}</svg>`,
  )

// South African flag for the +27 country code.
export const FlagZA: FC = () =>
  raw(
    '<svg class="flag" width="22" height="15" viewBox="0 0 900 600" aria-hidden="true">' +
      '<rect width="900" height="600" fill="#002395"/><rect width="900" height="300" fill="#DE3831"/>' +
      '<path d="M0 0 L450 300 L0 600 M450 300 H900" fill="none" stroke="#FFF" stroke-width="200"/>' +
      '<path d="M0 0 L450 300 L0 600 Z" fill="#000" stroke="#FFB612" stroke-width="134"/>' +
      '<path d="M0 0 L450 300 L0 600 M450 300 H900" fill="none" stroke="#007A4D" stroke-width="120"/></svg>',
  )
