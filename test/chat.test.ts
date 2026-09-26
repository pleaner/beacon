import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test'
import { env } from 'cloudflare:workers'
import { afterEach, describe, expect, it } from 'vitest'
import worker from '../src/index'
import { addSubscription, type Message } from '../src/lib/db'
import { setSenderForTests } from '../src/lib/push'
import { operatorClose, startTrip, type NewTrip } from '../src/lib/trips'
import { cookieFor, fakeSender, makeAdmin, makeExplorer, makeOperator } from './helpers'

async function call(path: string, init: RequestInit & { cookie?: string } = {}) {
  const headers = new Headers(init.headers)
  if (init.cookie) headers.set('cookie', init.cookie)
  const ctx = createExecutionContext()
  const res = await worker.fetch(new Request(`https://beacon.test${path}`, { ...init, headers, redirect: 'manual' }), env, ctx)
  await waitOnExecutionContext(ctx)
  return res
}
const post = (body: unknown, cookie: string) => ({ method: 'POST', cookie, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })

const base: NewTrip = {
  activity: 'hike', area: 'cape_peninsula', route_text: null, companions_text: null, wearing_text: null, photo_key: null,
  shoe_photo_key: null, start_lat: null, start_lng: null, start_accuracy: null, return_by: 0, checklist: [], battery_at_start: null,
}
async function setup() {
  const e = await makeExplorer({ name: 'Anele' })
  const o = await makeOperator({ name: 'Sipho' })
  const trip = await startTrip(env.DB, e.user.id, { ...base, return_by: Date.now() + 3_600_000 }, Date.now())
  const url = `/api/trips/${trip.id}/messages`
  return { e, o, trip, url, ec: cookieFor(e.token), oc: cookieFor(o.token) }
}
const list = async (url: string, cookie: string) => ((await (await call(url, { cookie })).json()) as { messages: Message[] }).messages

afterEach(() => setSenderForTests(null))

describe('trip chat', () => {
  it('explorer and operator share one thread, with names and roles', async () => {
    const { url, ec, oc } = await setup()
    expect((await call(url, post({ body: 'Ankle is sore' }, ec))).status).toBe(200)
    expect((await call(url, post({ body: 'Stay put, we are coming' }, oc))).status).toBe(200)
    const msgs = await list(url, ec)
    expect(msgs.map((m) => [m.author_name, m.author_role, m.body])).toEqual([
      ['Anele', 'explorer', 'Ankle is sore'],
      ['Sipho', 'operator', 'Stay put, we are coming'],
    ])
    expect(await list(url, oc)).toEqual(msgs)
  })

  it('pushes operators when the explorer writes and the explorer when an operator writes', async () => {
    const { e, o, trip, url, ec, oc } = await setup()
    await addSubscription(env.DB, e.user.id, { endpoint: 'https://push.test/e', p256dh: 'p', auth: 'a' })
    await addSubscription(env.DB, o.user.id, { endpoint: 'https://push.test/o', p256dh: 'p', auth: 'a' })
    const f = fakeSender()
    setSenderForTests(f.send)
    await call(url, post({ body: 'x'.repeat(500) }, ec))
    expect(f.sent).toHaveLength(1)
    expect(f.sent[0]!.endpoint).toBe('https://push.test/o')
    expect(f.sent[0]!.payload).toMatchObject({ title: 'Message from Anele', url: `/board/trips/${trip.id}` })
    expect(f.sent[0]!.payload.body.length).toBe(120)
    await call(url, post({ body: 'On our way' }, oc))
    expect(f.sent[1]).toMatchObject({ endpoint: 'https://push.test/e', payload: { title: 'SARZA: Sipho', body: 'On our way', url: '/trip' } })
  })

  it("keeps other explorers out and lets any operator or admin in", async () => {
    const { url, ec } = await setup()
    await call(url, post({ body: 'hello' }, ec))
    const other = await makeExplorer()
    expect((await call(url, { cookie: cookieFor(other.token) })).status).toBe(404)
    expect((await call(url, post({ body: 'sneaky' }, cookieFor(other.token)))).status).toBe(404)
    expect((await call(url)).status).toBe(401)
    const admin = await makeAdmin({ name: 'Ada' })
    expect((await call(url, post({ body: 'Admin here' }, cookieFor(admin.token)))).status).toBe(200)
    expect((await list(url, ec)).map((m) => m.author_role)).toEqual(['explorer', 'operator'])
  })

  it('rejects empty and over-long messages and closed trips', async () => {
    const { trip, url, ec, oc } = await setup()
    expect((await call(url, post({ body: '   ' }, ec))).status).toBe(400)
    expect((await call(url, post({ body: 'x'.repeat(1001) }, ec))).status).toBe(400)
    expect((await call(url, post({ body: 'x'.repeat(1000) }, ec))).status).toBe(200)
    await operatorClose(env.DB, trip.id, Date.now())
    expect((await call(url, post({ body: 'late' }, oc))).status).toBe(409)
    expect(await list(url, oc)).toHaveLength(1)
  })

  it('renders the thread escaped on both screens, and a form post redirects back', async () => {
    const { trip, url, ec, oc } = await setup()
    const form = { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'body=' + encodeURIComponent('<b>hi</b>') }
    const res = await call(url, { ...form, cookie: ec })
    expect(res.status).toBe(303)
    expect(res.headers.get('location')).toBe('/trip')
    for (const [path, cookie] of [['/trip', ec], [`/board/trips/${trip.id}`, oc]] as const) {
      const html = await (await call(path, { cookie })).text()
      expect(html).toContain(`data-chat="${trip.id}"`)
      expect(html).toContain('&lt;b&gt;hi&lt;/b&gt;')
      expect(html).not.toContain('<b>hi</b>')
    }
  })
})
