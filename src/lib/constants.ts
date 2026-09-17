export const ACTIVITIES = {
  hike: 'Hike',
  run: 'Trail run',
  climb: 'Climb',
  paraglide: 'Paraglide',
  mtb: 'Mountain bike',
  other: 'Other',
} as const
export type Activity = keyof typeof ACTIVITIES

export const AREAS = {
  table_mountain: 'Table Mountain',
  cape_peninsula: 'Cape Peninsula',
  cederberg: 'Cederberg',
  overberg: 'Overberg',
  drakensberg: 'Drakensberg',
  other: 'Other',
} as const
export type Area = keyof typeof AREAS

export const EXTEND_OPTIONS_MINUTES = [30, 60, 120, 240] as const
