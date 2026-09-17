import type { FC } from 'hono/jsx'

export const Login: FC<{ error?: string }> = ({ error }) => (
  <form method="post" action="/auth/link">
    <h1>Operator sign in</h1>
    {error && <div class="banner red">{error}</div>}
    <p class="muted">Explorers don't sign in. This is for SARZA operators.</p>
    <label>Email</label>
    <input name="email" type="email" required autocomplete="email" />
    <button class="btn" type="submit">Send me a link</button>
  </form>
)

export const LinkSent: FC = () => (
  <>
    <h1>Check your email</h1>
    <p>If that address belongs to an operator, a sign-in link is on its way. It works for 15 minutes.</p>
    <p>On iPhone, open Beacon from your home screen, come back to this page, and paste the link from the email here.</p>
    <form method="post" action="/auth/verify">
      <label>Link from the email</label>
      <input name="link" />
      <button class="btn" type="submit">Sign in</button>
    </form>
  </>
)
