import type { FC } from 'hono/jsx'
import { ACTIVITIES, AREAS, type Activity } from '../lib/constants'
import type { User } from '../lib/db'
import { toLocalInput, type Trip } from '../lib/trips'

export const ProfileForm: FC<{ user: User | null; error?: string; saved?: boolean }> = ({ user, error, saved }) => (
  <form method="post" action="/api/profile" enctype="multipart/form-data">
    <h1>{user ? 'Your profile' : 'Welcome to SARZA Beacon'}</h1>
    {!user && <p class="muted">Tell us who you are once. Then each trip takes a minute to file.</p>}
    {error && <div class="banner red">{error}</div>}
    {saved && <div class="banner ok">Saved.</div>}
    <label>Name</label>
    <input name="name" value={user?.name ?? ''} required autocomplete="name" />
    <label>Mobile number</label>
    <input name="phone" type="tel" value={user?.phone ?? ''} required autocomplete="tel" />
    <label>Email (optional)</label>
    <input name="email" type="email" value={user?.email ?? ''} autocomplete="email" />
    <label>Emergency contact name</label>
    <input name="emergency_name" value={user?.emergency_name ?? ''} />
    <label>Emergency contact number</label>
    <input name="emergency_phone" type="tel" value={user?.emergency_phone ?? ''} />
    <label>What you look like</label>
    <textarea name="description" placeholder="Height, build, hair, glasses, anything a searcher would notice">{user?.description ?? ''}</textarea>
    <label>Photo of you (optional, helps searchers)</label>
    {user?.photo_key && <img class="photo" src={`/photos/${user.photo_key}`} alt="" width="120" />}
    <input name="photo" type="file" accept="image/*" capture="user" />
    <label class="check">
      <input type="checkbox" name="consent_contact" checked={!!user?.consent_contact} />
      SARZA may contact me about the service, fundraising, and events
    </label>
    <button class="btn" type="submit">{user ? 'Save' : 'Save and continue'}</button>
  </form>
)

export const Home: FC<{ user: User; last: Trip | null; welcome: boolean }> = ({ user, last, welcome }) => (
  <>
    <h1>Hi {user.name.split(' ')[0]}</h1>
    {welcome && (
      <div class="banner ok">
        Profile saved. Two things make the alarm work: add Beacon to your home screen, and allow notifications.
      </div>
    )}
    <div id="alerts-off" class="banner warn" hidden>
      Notifications are off, so we can't reach you when you're overdue.
      <button class="btn quiet" type="button" data-enable-push>Enable alerts</button>
    </div>
    <p>What are you doing today?</p>
    {Object.entries(ACTIVITIES).map(([k, label]) => (
      <a class="btn" href={`/trip/new?activity=${k}`}>{label}</a>
    ))}
    <p class="muted">Plan a trip and we'll check on you if you're not back in time.</p>
    {last && (
      <p class="muted">
        Last trip: {ACTIVITIES[last.activity]} in {AREAS[last.area]}, {last.closed_reason === 'safe' ? 'back safe' : last.status}.
      </p>
    )}
  </>
)

export const NewTripForm: FC<{
  user: User; activity: Activity; checklist: string[]; shoes: string[]; error?: string
}> = ({ user, activity, checklist, shoes, error }) => (
  <form method="post" action="/api/trips" enctype="multipart/form-data" data-new-trip>
    <h1>{ACTIVITIES[activity]} plan</h1>
    {error && <div class="banner red">{error}</div>}
    <input type="hidden" name="activity" value={activity} />
    <input type="hidden" name="start_lat" />
    <input type="hidden" name="start_lng" />
    <input type="hidden" name="start_accuracy" />
    <input type="hidden" name="battery" />
    <label>Area</label>
    <select name="area">
      {Object.entries(AREAS).map(([k, label]) => <option value={k}>{label}</option>)}
    </select>
    <label>Where exactly</label>
    <textarea name="route_text" placeholder="Route up, route down, where you'll stop"></textarea>
    <label>Who's with you</label>
    <input name="companions_text" placeholder="Names, or 'alone'" />
    <label>What you're wearing</label>
    <input name="wearing_text" placeholder="Colours of jacket, pack, hat" />
    <label>Back by</label>
    <input name="return_by" type="datetime-local" required value={toLocalInput(Date.now() + 4 * 3_600_000)} />
    <label>Checklist</label>
    {checklist.map((item) => (
      <label class="check"><input type="checkbox" name="checklist" value={item} /> {item}</label>
    ))}
    <p class="muted" id="battery-line" hidden>Phone battery: <span></span></p>
    <label>Photo of you today (optional)</label>
    <input name="photo" type="file" accept="image/*" capture="user" />
    <label>Sole of your shoe (helps trackers)</label>
    {shoes.length > 0 && (
      <div class="thumbs">
        {shoes.map((k) => (
          <label><input type="radio" name="shoe_photo_key" value={k} /><img src={`/photos/${k}`} alt="" /></label>
        ))}
        <label><input type="radio" name="shoe_photo_key" value="" checked /><img src="/icon-192.png" alt="New" title="Take a new one" /></label>
      </div>
    )}
    <input name="shoe_photo" type="file" accept="image/*" capture="environment" />
    <button class="btn ok" type="submit">Start trip</button>
    <p class="muted">Only "Back by" is required. We'll ask if you're okay when that time passes.</p>
  </form>
)
