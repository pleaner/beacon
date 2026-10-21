import { raw } from 'hono/html'
import type { FC, PropsWithChildren } from 'hono/jsx'
import { APP_VERSION } from '../lib/constants'
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
  // Operators and admins switch between the regular app, the board and messages from a bar along the bottom.
  // Never on bare pages: flows and the help screen keep the whole screen.
  const tab = !isOps || v === 'bare' ? null : v === 'app' ? 'travel' : current === 'messages' ? 'messages' : current === 'board' ? 'trips' : 'none'
  const cls = [bodyClass, v === 'ops' ? 'ops' : '', tab ? 'has-tabs' : ''].filter(Boolean).join(' ')
  return (
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        {/* Inline, ahead of any stylesheet: the fonts sheet can land first, and a page without the opt-in at that moment drops the transition. */}
        {raw('<style>@view-transition { navigation: auto; }</style>')}
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        <meta name="theme-color" content="#212C65" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="default" />
        <meta name="apple-mobile-web-app-title" content="Guardian" />
        <title>{title} · Guardian by SARZA</title>
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
        {/* One header on every page: the logo and name, and the menu on the right once someone is signed in. */}
        <AppBar user={user} />
        {user && <AppMenu user={user} current={current} />}
        {children}
        {tab && <OpsTabs tab={tab} helpCount={helpCount} />}
        <div class="alpha-ribbon" aria-hidden="true">{APP_VERSION}</div>
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
          <b>Guardian</b>
          <small>SARZA Search &amp; Rescue</small>
        </span>
      </a>
      {user && (
        <a class="bar-menu" href="#menu" data-menu-open aria-label="Open menu" aria-controls="menu">
          <Icon name="menu" size={22} />
        </a>
      )}
    </div>
    <div class="strip"></div>
  </header>
)

// The one menu, for everyone signed in. Admins also get the admin pages; the board and messages are on the bottom tabs.
const AppMenu: FC<{ user: User; current?: string }> = ({ user, current }) => {
  const item = (href: string, key: string, icon: Parameters<typeof Icon>[0]['name'], label: string) => (
    <a class="item" href={href} aria-current={current === key ? 'page' : undefined}>
      <Icon name={icon} size={18} />
      <span class="grow">{label}</span>
    </a>
  )
  return (
    <div class="sheet-wrap" id="menu" data-menu>
      <a class="scrim" href="#" aria-label="Close menu" data-menu-close></a>
      <nav class="sheet" aria-label="Menu">
        <div class="head">
          <img src="/sarza-logo.png" alt="" />
          <div class="grow">
            <strong>{user.name}</strong>
            <small>{user.email ?? ''}</small>
          </div>
          <a class="icon-btn" href="#" aria-label="Close menu" data-menu-close>
            <Icon name="x" size={18} />
          </a>
        </div>
        <div class="body">
          {item('/profile', 'profile', 'user', 'Profile')}
          {item('/pets', 'pets', 'paw', 'My pets')}
          {user.role === 'admin' && (
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
          <form method="post" action="/logout">
            <button class="item" type="submit">
              <Icon name="logout" size={18} />
              <span>Log out</span>
            </button>
          </form>
        </div>
      </nav>
    </div>
  )
}

const OpsTabs: FC<{ tab: string; helpCount?: number }> = ({ tab, helpCount }) => {
  const t = (key: string, href: string, icon: Parameters<typeof Icon>[0]['name'], label: string, badge?: number) => (
    <a href={href} aria-current={tab === key ? 'page' : undefined}>
      <span class="ic"><Icon name={icon} size={24} />{badge ? <span class="count-badge">{badge}</span> : null}</span>
      <span>{label}</span>
    </a>
  )
  return (
    <nav class="ops-tabs" aria-label="Sections">
      {t('travel', '/', 'hike', 'Travel')}
      {t('trips', '/board', 'board', 'Active trips', helpCount)}
      {t('messages', '/board/messages', 'chat', 'Messages')}
    </nav>
  )
}

