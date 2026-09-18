import { raw } from 'hono/html'
import type { FC, PropsWithChildren } from 'hono/jsx'
import type { User } from '../lib/db'
import { Icon } from './icons'

type Variant = 'app' | 'bare' | 'ops'

type Props = PropsWithChildren<{
  title: string
  user: User | null
  bodyAttrs?: Record<string, string>
  // app: navy bar for explorers. bare: no bar (flows, help, sign in). ops: operator bar and menu.
  variant?: Variant
  bodyClass?: string
  // ops only: which menu item is current, and how many trips need help (menu badge).
  current?: string
  helpCount?: number
}>

const FONTS =
  'https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@600;700;800&family=IBM+Plex+Mono:wght@500&family=IBM+Plex+Sans:wght@400;500;600;700&display=swap'

export const Layout: FC<Props> = ({ title, user, bodyAttrs = {}, variant, bodyClass, current, helpCount, children }) => {
  const isOps = user?.role === 'operator' || user?.role === 'admin'
  const v: Variant = variant ?? (isOps ? 'ops' : 'app')
  const cls = [bodyClass, v === 'ops' ? 'ops' : ''].filter(Boolean).join(' ')
  return (
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        <meta name="theme-color" content="#212C65" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="default" />
        <meta name="apple-mobile-web-app-title" content="Beacon" />
        <title>{title} · SARZA Beacon</title>
        {raw("<script>document.documentElement.classList.add('js')</script>")}
        <link rel="manifest" href="/manifest.json" />
        <link rel="icon" href="/icon-192.png" type="image/png" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="" />
        <link rel="stylesheet" href={FONTS} />
        <link rel="stylesheet" href="/app.css" />
        <script src="/app.js" defer></script>
      </head>
      <body class={cls || undefined} {...bodyAttrs}>
        {v === 'app' && <AppBar user={user} />}
        {v === 'ops' && <OpsBar user={user!} title={title} current={current} helpCount={helpCount} />}
        {children}
      </body>
    </html>
  )
}

const AppBar: FC<{ user: User | null }> = ({ user }) => (
  <header class="appbar">
    <div class="inner">
      <a href="/" class="brand">
        <img src="/sarza-logo.png" alt="SARZA Search &amp; Rescue" />
        <span>
          <b>Beacon</b>
          <small>SARZA Search &amp; Rescue</small>
        </span>
      </a>
      {user && (
        <nav aria-label="Main">
          <a href="/profile">Profile</a>
        </nav>
      )}
    </div>
    <div class="strip"></div>
  </header>
)

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('')

const OpsBar: FC<{ user: User; title: string; current?: string; helpCount?: number }> = ({ user, title, current, helpCount }) => {
  const isAdmin = user.role === 'admin'
  const item = (href: string, key: string, icon: Parameters<typeof Icon>[0]['name'], label: string, badge?: number) => (
    <a class="item" href={href} aria-current={current === key ? 'page' : undefined}>
      <Icon name={icon} size={18} />
      <span class="grow">{label}</span>
      {badge ? <span class="count-badge">{badge}</span> : null}
    </a>
  )
  return (
    <>
      <header class="ops-bar">
        <a class="menu-btn" href="#menu" data-menu-open aria-label="Open menu" aria-controls="menu">
          <Icon name="menu" size={20} />
        </a>
        <img src="/sarza-logo.png" alt="SARZA" />
        <span class="title">{title}</span>
        <span class="me" title={user.name}>{initials(user.name)}</span>
      </header>
      <div class="sheet-wrap" id="menu" data-menu>
        <a class="scrim" href="#" aria-label="Close menu" data-menu-close></a>
        <nav class="sheet" aria-label="Operator menu">
          <div class="head">
            <img src="/sarza-logo.png" alt="" />
            <div class="grow">
              <strong>Beacon</strong>
              <small>{isAdmin ? 'Admin' : 'Operator'}</small>
            </div>
            <a class="icon-btn" href="#" aria-label="Close menu" data-menu-close>
              <Icon name="x" size={18} />
            </a>
          </div>
          <div class="body">
            <span class="group">Operations</span>
            {item('/board', 'board', 'board', 'Board', helpCount)}
            {isAdmin && (
              <>
                <div class="sep"></div>
                <span class="group">Admin</span>
                {item('/admin?tab=users', 'users', 'users', 'Users')}
                {item('/admin?tab=checklists', 'checklists', 'list', 'Checklists')}
                {item('/admin?tab=broadcast', 'broadcast', 'megaphone', 'Broadcast')}
                {item('/admin?tab=settings', 'settings', 'settings', 'Settings')}
              </>
            )}
          </div>
          <div class="foot">
            <div class="who">
              <span class="me">{initials(user.name)}</span>
              <div>
                <strong>{user.name}</strong>
                <small>{user.email ?? ''}</small>
              </div>
            </div>
            <form method="post" action="/logout">
              <button class="item" type="submit">
                <Icon name="logout" size={18} />
                <span>Log out</span>
              </button>
            </form>
          </div>
        </nav>
      </div>
    </>
  )
}
