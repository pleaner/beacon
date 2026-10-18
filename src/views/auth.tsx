import type { FC } from 'hono/jsx'

export const LinkSent: FC = () => (
  <main class="signin">
    <img src="/sarza-logo.png" alt="SARZA Search &amp; Rescue" style="width: 96px; height: 96px; align-self: center;" />
    <h1 class="display">Check your email</h1>
    <p class="lead">If that address has a Guardian account, a sign-in link is on its way. It works once, for 15 minutes.</p>
    <p class="lead">On iPhone, open Guardian from your home screen, come back to this page, and paste the link from the email here.</p>
    <form method="post" action="/auth/verify" class="stack">
      <div class="field">
        <label for="l-link">Link from the email</label>
        <input id="l-link" name="link" type="text" />
      </div>
      <button class="btn yellow" type="submit">Sign in</button>
    </form>
  </main>
)

export const ConfirmLink: FC<{ token: string }> = ({ token }) => (
  <main class="signin">
    <img src="/sarza-logo.png" alt="SARZA Search &amp; Rescue" style="width: 96px; height: 96px; align-self: center;" />
    <h1 class="display">Sign in to Guardian</h1>
    <form method="post" action="/auth/verify" class="stack">
      <input type="hidden" name="link" value={token} />
      <button class="btn yellow" type="submit">Sign in</button>
    </form>
  </main>
)
