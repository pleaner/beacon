import type { FC } from 'hono/jsx'
import { ACTIVITIES, COUNTRY_CODES, EXTEND_OPTIONS_MINUTES, GEAR, GENDERS, LANGUAGES, RELATIONS, type Activity } from '../lib/constants'
import type { User } from '../lib/db'
import { formatPhone, splitPhone } from '../lib/phone'
import { toLocalInput, tripLine, type Trip } from '../lib/trips'
import { FlowHead, IconInput, IconTextarea, PhoneField, PhoneInputs, SelectField, Step } from './forms'
import { Icon, type IconName } from './icons'

const TZ = 'Africa/Johannesburg'

// What a trip is called in sentences: "during your ride".
export const ACTIVITY_NOUN: Record<Activity, string> = {
  hike: 'hike', run: 'run', climb: 'climb', paraglide: 'flight', mtb: 'ride', other: 'trip',
}

const opts = (xs: readonly string[]) => xs.map((x) => ({ value: x, label: x }))

// ---------- profile (4 steps) ----------

export const ProfileForm: FC<{ user: User | null; error?: string; saved?: boolean; draft?: Partial<User> }> = ({ user, error, saved, draft }) => {
  // After a failed save, show what was typed rather than what is stored.
  const v: Partial<User> | null = draft ?? user
  return (
  <div class="flow">
    <FlowHead total={4} backHref={user ? '/' : '/login'} />
    <main>
      <form method="post" action="/api/profile" enctype="multipart/form-data" class="stack grow" data-steps>
        <Step title="Who are you?" icon="user" eyebrowLabel="Your profile" lead="Tell us once. After that, each trip takes a minute to file.">
          {error && <div class="banner error" role="alert">{error}</div>}
          {saved && <div class="banner ok" role="status">Saved.</div>}
          <div class="stack">
            <SelectField id="p-lang" name="language" label="Language" icon="globe" hideLabel value={v?.language ?? 'en'}
              options={Object.entries(LANGUAGES).map(([value, label]) => ({ value, label }))} />
            <IconInput id="p-name" name="name" label="Name" icon="user" hideLabel value={v?.name} placeholder="Your full name" required autocomplete="name" />
            <IconInput id="p-bday" name="birthday" label="Birthday" icon="cake" hideLabel type="date" value={v?.birthday} max={new Date().toISOString().slice(0, 10)} />
            <SelectField id="p-gender" name="gender" label="Gender" icon="userCircle" hideLabel value={v?.gender} placeholder="Gender" options={opts(GENDERS)} />
            <PhoneField id="p-phone" name="phone" label="Mobile number" hideLabel value={v?.phone} required />
            <IconInput id="p-email" name="email" label="Email" icon="mail" hideLabel type="email" value={v?.email} placeholder="you@example.com" required autocomplete="email" pattern="[^@\s]+@[^@\s]+\.[^@\s]+" />
          </div>
        </Step>

        <Step title="Who should we call?" icon="phone" eyebrowLabel="Your profile" lead="If you're overdue or call for help, our operators can phone this person." skip>
          <div class="stack">
            <div class="field">
              <label for="p-ename">Their name</label>
              <input id="p-ename" name="emergency_name" type="text" value={v?.emergency_name ?? ''} placeholder="e.g. Lindiwe Mokoena" />
            </div>
            <SelectField id="p-erel" name="emergency_relation" label="How you know them" value={v?.emergency_relation} placeholder="Choose one" options={opts(RELATIONS)} />
            <PhoneField id="p-ephone" name="emergency_phone" label="Their number" value={v?.emergency_phone} />
          </div>
        </Step>

        <Step title="Help searchers find you" icon="search" eyebrowLabel="Your profile" lead="A clear photo and a few numbers help searchers recognise you." skip>
          <label class="avatar-pick" data-preview>
            {user?.photo_key ? <img src={`/photos/${user.photo_key}`} alt="Your profile picture" /> : <Icon name="camera" size={30} />}
            <span class="sr">Profile picture</span>
            <span aria-hidden="true">{user?.photo_key ? '' : 'Add photo'}</span>
            <input name="photo" type="file" accept="image/*" capture="user" />
          </label>
          <p class="lead" style="text-align: center; margin-top: -12px;">A clear photo of your face</p>
          <div class="grid3">
            <div class="field">
              <label for="p-height">Height</label>
              <div class="control"><input id="p-height" name="height_cm" type="number" inputmode="numeric" min="50" max="250" class="with-unit" value={v?.height_cm ?? ''} placeholder="175" /><span class="unit">cm</span></div>
            </div>
            <div class="field">
              <label for="p-weight">Weight</label>
              <div class="control"><input id="p-weight" name="weight_kg" type="number" inputmode="numeric" min="10" max="300" class="with-unit" value={v?.weight_kg ?? ''} placeholder="70" /><span class="unit">kg</span></div>
            </div>
            <div class="field">
              <label for="p-shoe">Shoe size</label>
              <div class="control"><input id="p-shoe" name="shoe_size" type="text" inputmode="decimal" class="with-unit" value={v?.shoe_size ?? ''} placeholder="8" /><span class="unit">UK</span></div>
            </div>
          </div>
        </Step>

        <Step title="Make sure we can reach you" icon="bell" eyebrowLabel="Your profile" lead="Two things make the alarm work. Without both, we can't tell you when you're overdue."
          submit={<button class="btn" type="submit"><Icon name="check" size={24} stroke={2.4} />{user ? 'Save' : 'Finish'}</button>}>
          <div class="stack">
            <div class="setup" data-standalone>
              <span class="n">1</span>
              <div>
                <strong>Add Beacon to your home screen</strong>
                <p>Tap Share, then "Add to Home Screen". On iPhone, alerts only work this way.</p>
              </div>
            </div>
            <div class="setup" data-push-setup>
              <span class="n">2</span>
              <div>
                <strong>Allow notifications</strong>
                <p>So we can gently ask if you're okay when you're late back.</p>
                <button class="btn outline small js-only" type="button" data-enable-push>Allow notifications</button>
              </div>
            </div>
          </div>
          <label class="check">
            <input type="checkbox" name="consent_contact" checked={!!v?.consent_contact} />
            <span>SARZA may contact me about the service, fundraising, and events</span>
          </label>
        </Step>
      </form>
    </main>
  </div>
)
}

// ---------- home ----------

const ACTIVITY_ICON: Record<Activity, IconName> = { hike: 'hike', run: 'run', climb: 'climb', paraglide: 'paraglide', mtb: 'mtb', other: 'other' }

export const Home: FC<{ user: User; last: Trip | null; welcome: boolean; notice?: string }> = ({ user, last, welcome, notice }) => (
  <main>
    <h1 class="display xl">Hi {user.name.split(' ')[0]}</h1>
    {welcome && (
      <div class="banner ok" role="status">Profile saved. Two things make the alarm work: add Beacon to your home screen, and allow notifications.</div>
    )}
    {notice && <div class="banner ok" role="status">{notice}</div>}
    <div id="alerts-off" class="banner warn" hidden>
      <Icon name="bell" />
      <div class="stack" style="gap: 10px;">
        <span>Notifications are off, so we can't reach you when you're overdue.</span>
        <button class="btn small" type="button" data-enable-push>Enable alerts</button>
      </div>
    </div>
    <section class="stack" style="gap: 12px;">
      <h2 style="margin: 0; font-size: 17px;">What are you doing today?</h2>
      <div class="tiles">
        {Object.entries(ACTIVITIES).map(([k, label]) => (
          <a class="tile" href={`/trip/new?activity=${k}`}>
            <span class="ic"><Icon name={ACTIVITY_ICON[k as Activity]} size={26} /></span>
            <span>{label}</span>
          </a>
        ))}
      </div>
    </section>
    <p class="lead">Plan a trip and we'll check on you if you're not back in time.</p>
    {last && (
      <p class="row muted" style="padding-top: 16px; border-top: 1px solid var(--line); margin: 0;">
        <span class="avatar soft" style="width: 28px; height: 28px;"><Icon name="check" size={16} stroke={3} /></span>
        Last trip: {tripLine(last)}, {last.closed_reason === 'safe' ? 'back safe' : last.status}.
      </p>
    )}
  </main>
)

// ---------- new trip (6 steps) ----------

const GearOrShoe: FC<{ label: string; name: string; fileName: string; keys: string[]; icon: IconName }> = ({ label, name, fileName, keys, icon }) => (
  <fieldset class="field" style="border: 0; margin: 0; padding: 0;">
    <legend class="lbl" style="padding: 0; margin-bottom: 8px; font-weight: 600;">{label}</legend>
    <div class="thumbs">
      {keys.map((k, i) => (
        <label><input type="radio" name={name} value={k} checked={i === 0} /><img src={`/photos/${k}`} alt={`${label}, from an earlier trip`} /></label>
      ))}
      <label class="thumb-new" data-preview>
        <input type="radio" name={name} value="" checked={keys.length === 0} />
        <Icon name={keys.length ? 'camera' : icon} size={26} />
        <span class="sr">Take a new photo</span>
        <input type="file" name={fileName} accept="image/*" capture="environment" data-select-radio />
      </label>
    </div>
  </fieldset>
)

// What was sent, so a failed start comes back filled in. Photos can't be kept and must be picked again.
export interface TripDraft {
  destination_text: string | null
  route_text: string | null
  return_by: string | null
  checklist: string[]
  companions: Array<{ name: string; phone: string | null }>
  alone: boolean
}

export const NewTripForm: FC<{
  user: User; activity: Activity; checklist: string[]; shoes: string[]; gear?: string[]; graceMinutes?: number; error?: string
  errorAt?: 'intro' | 'when' | 'photos'; draft?: TripDraft
}> = ({ activity, checklist, shoes, gear = [], graceMinutes = 30, error, errorAt = 'photos', draft }) => {
  const errorBanner = (at: string) => error && errorAt === at ? <div class="banner error" role="alert">{error}</div> : null
  const noun = ACTIVITY_NOUN[activity]
  const icon = ACTIVITY_ICON[activity]
  const label = `${ACTIVITIES[activity]} plan`
  const g = GEAR[activity]
  const defaultReturn = toLocalInput(Date.now() + 4 * 3_600_000)
  return (
    <div class="flow">
      <FlowHead total={6} backHref="/" cancelHref="/" />
      <main>
        <form method="post" action="/api/trips" enctype="multipart/form-data" class="stack grow" data-steps data-new-trip>
          <input type="hidden" name="activity" value={activity} />
          <input type="hidden" name="start_lat" />
          <input type="hidden" name="start_lng" />
          <input type="hidden" name="start_accuracy" />
          <input type="hidden" name="battery" />

          <Step title="How Beacon works" lead="A minute now will increase the odds of us turning a bad day into a great story. Only your return time is needed."
            icon={icon} eyebrowLabel={label} next={`Plan my ${noun}`}>
            {errorBanner('intro')}
            <ol class="how">
              <li><span class="n">1</span><div><strong>Tell us your plan</strong><p>Where you're going, when you'll be back, and anything that helps us find you if you ever need us.</p></div></li>
              <li><span class="n">2</span><div><strong>We'll check in</strong><p>If you're not back by then, we'll gently ask if you're okay.</p></div></li>
              <li><span class="n">3</span><div><strong>We come looking</strong><p>No answer within {graceMinutes} minutes? Our operators see your plan and last position, and we'll help bring you home safely.</p></div></li>
            </ol>
            <div class="stack" style="gap: 10px;">
              <div class="banner soft"><Icon name="pin" size={20} /><span>During your {noun}, we drop a pin every 2 minutes, so we know where you were last.</span></div>
              <div class="banner soft red-t"><Icon name="arrow" size={20} /><span>Need us sooner? Slide for help any time, and we'll know right away.</span></div>
            </div>
          </Step>

          <Step title="Where are you going?" icon={icon} eyebrowLabel={label}>
            <div class="startpoint" data-startpoint>
              <span class="map"><Icon name="pin" size={30} /></span>
              <div class="grow">
                <strong><span class="sr">Starting from </span><span data-place>Finding your location…</span></strong>
                <small><Icon name="gps" size={16} /><span class="sr">From GPS </span><span data-accuracy>Stay on this screen a moment</span></small>
              </div>
            </div>
            <div class="stack">
              <IconInput id="t-dest" name="destination_text" label="Headed to" icon="flag" hideLabel placeholder="Summit, peak or turnaround point" value={draft?.destination_text} />
              <IconTextarea id="t-route" name="route_text" label="Route" icon="route" hideLabel placeholder="Way up, way down, where you'll stop" value={draft?.route_text} />
            </div>
          </Step>

          <Step title="Who's with you?" icon="users" eyebrowLabel={label}>
            <fieldset class="seg">
              <legend class="sr">Who's going</legend>
              <label><input type="radio" name="company" value="alone" data-company checked={!!draft?.alone} /><Icon name="user" size={20} />Just me</label>
              <label><input type="radio" name="company" value="group" data-company checked={!draft?.alone} /><Icon name="users" size={20} />With others</label>
            </fieldset>
            <div class="stack" data-people-wrap hidden={!!draft?.alone}>
              <ul class="people" data-people>
                {draft?.companions.length
                  ? draft.companions.map((c, i) => <CompanionRow n={i + 1} name={c.name} phone={c.phone} />)
                  : <><CompanionRow n={1} /><CompanionRow n={2} noJsOnly /></>}
              </ul>
              <button class="add-person js-only" type="button" data-add-person><Icon name="plus" size={22} stroke={2.4} />Add a person</button>
              <template data-person-template><CompanionRow n={0} /></template>
              <p class="note"><Icon name="mobile" size={18} /><span>Their numbers help us reach your group if we can't reach you.</span></p>
            </div>
          </Step>

          <Step title="When will you be back?" icon={icon} eyebrowLabel={label}>
            {errorBanner('when')}
            <div class="backby">
              <label for="t-return">Back by</label>
              <div class="row js-only" style="align-items: baseline; gap: 12px;">
                <span class="big" data-return-time></span>
                <span class="day" data-return-day></span>
              </div>
              <input id="t-return" name="return_by" type="datetime-local" required value={draft?.return_by ?? defaultReturn} min={toLocalInput(Date.now())} data-return />
            </div>
            <div class="stack js-only" style="gap: 8px;">
              <span style="font-weight: 600;">Or from now</span>
              <div class="grid4">
                {[2, 4, 6, 8].map((h) => <button class="chip" type="button" data-plus-hours={h} aria-pressed={h === 4 ? 'true' : 'false'}>{h} h</button>)}
              </div>
            </div>
            <p class="note"><Icon name="clock" size={18} /><span>At this time we'll gently ask if you're okay. If we don't hear back within {graceMinutes} minutes, our operators are alerted. Don't worry about being exact, you can always add more time.</span></p>
          </Step>

          <Step title="Before you go" icon="list" eyebrowLabel={label} lead="Tick what's true. Nothing here stops you starting.">
            <div class="stack" style="gap: 2px;">
              {checklist.map((item, i) => (
                <label class="check"><input type="checkbox" name="checklist" value={item} id={`c${i}`} checked={draft?.checklist.includes(item)} /><span>{item}</span></label>
              ))}
            </div>
            <p class="note" id="battery-line" hidden><Icon name="battery" size={20} /><span>Phone battery <span></span></span></p>
          </Step>

          <Step title="What searchers look for" icon="camera" eyebrowLabel={label}
            lead={g ? g.hint : 'A quick photo helps us recognise you, and your footprints.'}
            submit={<button class="btn red" type="submit" data-start><Icon name="arrow" size={24} stroke={2.4} />Start trip</button>}>
            {errorBanner('photos')}
            <label class="photo-card" data-preview>
              <span class="frame"><Icon name="body" size={44} stroke={1.6} /></span>
              <span class="stack" style="gap: 4px;">
                <strong>Full-body photo, today</strong>
                <span class="hint">{activity === 'paraglide' ? 'Head to toe, in your harness and helmet.' : activity === 'mtb' ? 'Head to toe, in your helmet and kit.' : 'Head to toe, with your pack on.'} It shows us everything you're wearing.</span>
                <span class="go"><Icon name="camera" size={18} />Take photo</span>
              </span>
              <input type="file" name="photo" accept="image/*" aria-label="Full-body photo, today" />
            </label>
            {g ? (
              <div class="grid2">
                <GearOrShoe label={g.label} name="gear_photo_key" fileName="gear_photo" keys={gear} icon={icon} />
                <GearOrShoe label="Sole of your shoe" name="shoe_photo_key" fileName="shoe_photo" keys={shoes} icon="shoe" />
              </div>
            ) : (
              <GearOrShoe label="Sole of your shoe" name="shoe_photo_key" fileName="shoe_photo" keys={shoes} icon="shoe" />
            )}
            <div class="summary js-only">
              <span class="ic"><Icon name={icon} size={26} /></span>
              <div>
                <strong data-summary-line>{ACTIVITIES[activity]}</strong>
                <div class="muted" style="font-size: 14px;" data-summary-when></div>
              </div>
            </div>
          </Step>
        </form>
      </main>
    </div>
  )
}

const CompanionRow: FC<{ n: number; noJsOnly?: boolean; name?: string; phone?: string | null }> = ({ n, noJsOnly, name, phone }) => {
  const split = splitPhone(phone, COUNTRY_CODES)
  return (
  <li class={noJsOnly ? 'person no-js-only' : 'person'} data-person>
    <div class="top">
      <span class="avatar" aria-hidden="true" data-initials><Icon name="user" size={20} /></span>
      <label class="sr" for={n ? `co-name-${n}` : undefined}>Name</label>
      <input id={n ? `co-name-${n}` : undefined} name="companion_name" type="text" placeholder="Their name" autocomplete="off" class="grow" value={name ?? ''} />
      <button class="icon-btn js-only" type="button" data-remove-person aria-label="Remove this person"><Icon name="x" size={20} /></button>
    </div>
    <PhoneInputs name="companion_phone" label="Their number (optional)" placeholder="Their number" country={split.country} national={split.national} />
  </li>
  )
}

// ---------- active trip ----------

function clock(ms: number) {
  return new Date(ms).toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: TZ })
}
function dayWord(ms: number, now: number) {
  const d = (x: number) => new Date(x).toLocaleDateString('en-CA', { timeZone: TZ })
  if (d(ms) === d(now)) return 'Today'
  if (d(ms) === d(now + 86_400_000)) return 'Tomorrow'
  return new Date(ms).toLocaleDateString('en-ZA', { weekday: 'short', timeZone: TZ })
}
export function leftText(returnBy: number, now: number) {
  const mins = Math.round((returnBy - now) / 60_000)
  const fmt = (m: number) => (m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`)
  return mins >= 0 ? `${fmt(mins)} left` : `Overdue by ${fmt(-mins)}`
}

export const ActiveTrip: FC<{ trip: Trip; error?: string; now?: number }> = ({ trip, error, now = Date.now() }) => {
  const overdue = trip.status === 'overdue'
  return (
    <main class={overdue ? 'overdue' : undefined}>
      {error && <div class="banner error" role="alert">{error}</div>}
      {overdue && (
        <div class="banner red" role="alert">
          <strong>Are you okay?</strong>
          <span>You're past your return time. Let us know you're safe, or add more time. If we don't hear from you, we'll start checking on you.</span>
        </div>
      )}
      <div class="row">
        <Icon name={ACTIVITY_ICON[trip.activity]} />
        <span class="grow" style="font-weight: 600;">{tripLine(trip)}</span>
        <span class={`pill ${trip.status}`}>{trip.status}</span>
      </div>
      <section class="trip-when">
        <span class="k">Back by</span>
        <div class="row" style="align-items: baseline; gap: 12px;">
          <span class="big">{clock(trip.return_by)}</span>
          <span class="day">{dayWord(trip.return_by, now)}</span>
        </div>
        <span class="left">{leftText(trip.return_by, now)}</span>
      </section>
      <form method="post" action={`/api/trips/${trip.id}/back`}>
        <button class="btn big" type="submit"><Icon name="check" size={26} stroke={2.4} />I'm back</button>
      </form>
      <form method="post" action={`/api/trips/${trip.id}/extend`} class="stack" style="gap: 10px;">
        <h2 class="label">Add more time</h2>
        <div class="grid4">
          {EXTEND_OPTIONS_MINUTES.map((m) => (
            <button class="chip" type="submit" name="minutes" value={String(m)}>+{m < 60 ? `${m} min` : `${m / 60} h`}</button>
          ))}
        </div>
        <details class="more">
          <summary>Pick a new time</summary>
          <div class="stack" style="gap: 10px;">
            <label class="sr" for="x-return">New return time</label>
            <input id="x-return" name="return_by" type="datetime-local" />
            <button class="btn outline" type="submit">Save new time</button>
          </div>
        </details>
      </form>
      <div class="divider"></div>
      <div class="help-slider" data-help-slider>
        <input type="range" min="0" max="100" value="0" aria-label="Slide to call for help" />
        <span>Slide to call for help</span>
      </div>
      <p id="help-status" class="lead" role="status"></p>
      <p class="note"><Icon name="pin" size={18} /><span>While this screen is open we send your position every two minutes. Lock your phone and it stops.</span></p>
    </main>
  )
}

export const HelpScreen: FC<{ trip: Trip; emergency: string; error?: string }> = ({ trip, emergency, error }) => (
  <main class="help-screen" style="min-height: 100vh; min-height: 100dvh;">
    <a href="/" class="brand" style="align-self: flex-start;">
      <img src="/sarza-logo.png" alt="SARZA Search &amp; Rescue" />
      <span><b>Beacon</b></span>
    </a>
    {error && <div class="banner error" role="alert">{error}</div>}
    <div class="rings" aria-hidden="true"><div><div></div></div></div>
    <div class="alerted" role="status">SARZA has been alerted</div>
    <h1 class="display">Stay where you are</h1>
    <p style="margin: 0; font-size: 17px;">Keep your phone on and this screen open if you can. We send your position every 30 seconds while it's open.</p>
    <a class="btn white big" href={`tel:${emergency}`}><Icon name="phone" size={24} />Phone SARZA {formatPhone(emergency)}</a>
    <p id="help-status" role="status" style="margin: 0; font-size: 14px;"></p>
    <div class="grow"></div>
    <p style="margin: 0; font-size: 14px;">Trip: {tripLine(trip)}</p>
    <form method="post" action={`/api/trips/${trip.id}/cancel`}>
      <button class="btn ghost" type="submit">Cancel, I'm fine</button>
    </form>
  </main>
)
