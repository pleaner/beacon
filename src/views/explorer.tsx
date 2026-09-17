import type { FC } from 'hono/jsx'
import type { User } from '../lib/db'

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
