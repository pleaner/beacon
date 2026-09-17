let last: { to: string; url: string } | null = null

export function lastMagicLinkForTests() {
  return last
}

export async function sendMagicLink(env: Env, to: string, url: string): Promise<void> {
  last = { to, url }
  const text = `Open this link on your phone to sign in to SARZA Beacon. It works for 15 minutes.\n\n${url}\n\nIf you didn't ask for this, ignore it.`
  if (!env.RESEND_API_KEY) {
    console.log('MAGIC LINK', to, url)
    return
  }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: env.EMAIL_FROM, to, subject: 'Your SARZA Beacon sign-in link', text }),
  })
  if (!res.ok) throw new Error(`Resend error ${res.status}: ${await res.text()}`)
}
