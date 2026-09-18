import type { FC } from 'hono/jsx'
import { Icon } from './icons'

export const Login: FC<{ error?: string }> = ({ error }) => (
  <main class="signin">
    <img src="/sarza-logo.png" alt="SARZA Search &amp; Rescue" style="width: 132px; height: 132px; align-self: center;" />
    <div class="stack" style="gap: 10px;">
      <h1 class="display">Operator sign in</h1>
      <p class="lead">Explorers don't sign in. This is for SARZA operators.</p>
    </div>
    {error && <div class="banner error" role="alert">{error}</div>}
    <form method="post" action="/auth/link" class="stack">
      <div class="field">
        <label for="l-email">Email</label>
        <input id="l-email" name="email" type="email" required autocomplete="email" placeholder="you@sarza.org.za" />
      </div>
      <button class="btn yellow" type="submit"><Icon name="mail" />Send me a link</button>
    </form>
    <p style="margin: 0; font-size: 14px;">The link works for 15 minutes. On iPhone, open Beacon from your home screen and paste the link there.</p>
  </main>
)

export const LinkSent: FC = () => (
  <main class="signin">
    <img src="/sarza-logo.png" alt="SARZA Search &amp; Rescue" style="width: 96px; height: 96px; align-self: center;" />
    <h1 class="display">Check your email</h1>
    <p class="lead">If that address belongs to an operator, a sign-in link is on its way. It works for 15 minutes.</p>
    <p class="lead">On iPhone, open Beacon from your home screen, come back to this page, and paste the link from the email here.</p>
    <form method="post" action="/auth/verify" class="stack">
      <div class="field">
        <label for="l-link">Link from the email</label>
        <input id="l-link" name="link" type="text" />
      </div>
      <button class="btn yellow" type="submit">Sign in</button>
    </form>
  </main>
)
