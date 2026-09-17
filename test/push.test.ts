import { env } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'
import { addSubscription, listSubscriptionsForUser } from '../src/lib/db'
import { pushToRoles, pushToUser } from '../src/lib/push'
import { fakeSender, makeAdmin, makeExplorer, makeOperator } from './helpers'

const sub = (n: number) => ({ endpoint: `https://push.test/${n}`, p256dh: 'k', auth: 'a' })

describe('pushToUser', () => {
  it('sends to every subscription of the user', async () => {
    const { user } = await makeExplorer()
    await addSubscription(env.DB, user.id, sub(1))
    await addSubscription(env.DB, user.id, sub(2))
    const f = fakeSender()
    const r = await pushToUser(env.DB, f.send, user.id, { title: 'Hi', body: 'there' })
    expect(r).toEqual({ sent: 2, removed: 0 })
    expect(f.sent.map((s) => s.endpoint).sort()).toEqual(['https://push.test/1', 'https://push.test/2'])
    expect(f.sent[0].payload.title).toBe('Hi')
  })

  it('removes subscriptions that return 404 or 410, keeps ones that throw', async () => {
    const { user } = await makeExplorer()
    await addSubscription(env.DB, user.id, sub(1))
    await addSubscription(env.DB, user.id, sub(2))
    await addSubscription(env.DB, user.id, sub(3))
    await addSubscription(env.DB, user.id, sub(4))
    const f = fakeSender()
    f.statusFor.set('https://push.test/2', 410)
    f.statusFor.set('https://push.test/3', 404)
    f.statusFor.set('https://push.test/4', 0)
    const r = await pushToUser(env.DB, f.send, user.id, { title: 'x', body: 'y' })
    expect(r).toEqual({ sent: 1, removed: 2 })
    const left = (await listSubscriptionsForUser(env.DB, user.id)).map((s) => s.endpoint).sort()
    expect(left).toEqual(['https://push.test/1', 'https://push.test/4'])
  })

  it('is a no-op with no subscriptions', async () => {
    const { user } = await makeExplorer()
    const f = fakeSender()
    expect(await pushToUser(env.DB, f.send, user.id, { title: 'x', body: 'y' })).toEqual({ sent: 0, removed: 0 })
  })
})

describe('pushToRoles', () => {
  it('sends to operators and admins, not explorers', async () => {
    const e = await makeExplorer()
    const o = await makeOperator()
    const a = await makeAdmin()
    await addSubscription(env.DB, e.user.id, sub(1))
    await addSubscription(env.DB, o.user.id, sub(2))
    await addSubscription(env.DB, a.user.id, sub(3))
    const f = fakeSender()
    const r = await pushToRoles(env.DB, f.send, ['operator', 'admin'], { title: 'Overdue', body: 'x' })
    expect(r.sent).toBe(2)
    expect(f.sent.map((s) => s.endpoint).sort()).toEqual(['https://push.test/2', 'https://push.test/3'])
  })
})
