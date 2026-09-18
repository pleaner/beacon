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

// Activities where searchers look for gear before the person, and what to call it.
export const GEAR: Partial<Record<Activity, { label: string; hint: string }>> = {
  paraglide: { label: 'Your wing', hint: 'From the air, searchers spot your wing long before they spot you.' },
  mtb: { label: 'Your bike', hint: 'A bike on its side is often easier to spot than the rider.' },
}

export const GENDERS = ['Female', 'Male', 'Non-binary', 'Prefer to self-describe', 'Prefer not to say'] as const

export const RELATIONS = ['Partner or spouse', 'Parent', 'Child', 'Brother or sister', 'Other family', 'Friend', 'Colleague', 'Other'] as const

// South Africa's official languages, by their own names. The UI is English-only for now;
// the choice is stored so translations can follow.
// What an operator would need to speak to this person. Ordered by where visitors to
// South Africa come from, the same logic as COUNTRY_CODES below.
export const LANGUAGES = {
  en: 'English', de: 'German', nl: 'Dutch', fr: 'French', es: 'Spanish',
  it: 'Italian', pt: 'Portuguese', zh: 'Mandarin',
} as const
export type Language = keyof typeof LANGUAGES

// Country calling codes offered on phone fields. South Africa first; the neighbours and the
// countries most visitors come from after it.
export const COUNTRY_CODES = [
  { code: '27', label: 'South Africa' },
  { code: '264', label: 'Namibia' },
  { code: '267', label: 'Botswana' },
  { code: '263', label: 'Zimbabwe' },
  { code: '258', label: 'Mozambique' },
  { code: '266', label: 'Lesotho' },
  { code: '268', label: 'Eswatini' },
  { code: '44', label: 'United Kingdom' },
  { code: '49', label: 'Germany' },
  { code: '31', label: 'Netherlands' },
  { code: '33', label: 'France' },
  { code: '1', label: 'USA / Canada' },
  { code: '61', label: 'Australia' },
] as const
