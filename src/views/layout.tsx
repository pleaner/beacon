import type { FC, PropsWithChildren } from 'hono/jsx'
import type { User } from '../lib/db'

type Props = PropsWithChildren<{ title: string; user: User | null; bodyAttrs?: Record<string, string> }>

export const Layout: FC<Props> = ({ title, user, bodyAttrs = {}, children }) => {
  const isOps = user?.role === 'operator' || user?.role === 'admin'
  return (
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        <meta name="theme-color" content="#c8102e" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="default" />
        <meta name="apple-mobile-web-app-title" content="Beacon" />
        <title>{title} · SARZA Beacon</title>
        <link rel="manifest" href="/manifest.json" />
        <link rel="icon" href="/icon.svg" type="image/svg+xml" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
        <link rel="stylesheet" href="/app.css" />
        <script src="/app.js" defer></script>
      </head>
      <body {...bodyAttrs}>
        <header class="top">
          <a href={isOps ? '/board' : '/'} class="brand">SARZA Beacon</a>
          <nav>
            {user && !isOps && <a href="/profile">Profile</a>}
            {isOps && <a href="/board">Board</a>}
            {user?.role === 'admin' && <a href="/admin">Admin</a>}
            {isOps && (
              <form method="post" action="/logout">
                <button class="linklike" type="submit">Log out</button>
              </form>
            )}
          </nav>
        </header>
        <main>{children}</main>
      </body>
    </html>
  )
}
