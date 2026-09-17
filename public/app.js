;(async function () {
  const body = document.body
  const $ = (s) => document.querySelector(s)

  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {})

  function b64ToBytes(s) {
    const pad = '='.repeat((4 - (s.length % 4)) % 4)
    const bin = atob((s + pad).replace(/-/g, '+').replace(/_/g, '/'))
    return Uint8Array.from(bin, (ch) => ch.charCodeAt(0))
  }

  async function battery() {
    try { const b = await navigator.getBattery(); return Math.round(b.level * 100) } catch { return null }
  }

  // push
  const vapid = body.dataset.vapid
  const off = $('#alerts-off')
  const canPush = 'Notification' in window && 'PushManager' in window
  if (off && (!canPush || Notification.permission !== 'granted')) off.hidden = false

  async function subscribePush() {
    if (!canPush) {
      alert('On iPhone: tap Share, then "Add to Home Screen", then open Beacon from your home screen and try again.')
      return
    }
    if ((await Notification.requestPermission()) !== 'granted') return
    const reg = await navigator.serviceWorker.ready
    const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(vapid) })
    await fetch('/api/push/subscribe', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(sub.toJSON()) })
    if (off) off.hidden = true
  }
  document.querySelectorAll('[data-enable-push]').forEach((b) => b.addEventListener('click', () => subscribePush().catch(console.error)))
  if (vapid && canPush && Notification.permission === 'granted') subscribePush().catch(() => {})

  // new trip form
  const form = $('[data-new-trip]')
  if (form) {
    navigator.geolocation?.getCurrentPosition(
      (p) => { form.start_lat.value = p.coords.latitude; form.start_lng.value = p.coords.longitude; form.start_accuracy.value = p.coords.accuracy },
      () => {},
      { enableHighAccuracy: true, timeout: 15000 },
    )
    battery().then((b) => {
      if (b == null) return
      form.battery.value = b
      const line = $('#battery-line')
      line.hidden = false
      line.querySelector('span').textContent = b + '%'
    })
  }

  // live trip
  const tripId = body.dataset.tripId
  if (tripId) {
    const every = body.dataset.tripStatus === 'help' ? 30000 : 120000
    const queue = []
    function ping() {
      navigator.geolocation?.getCurrentPosition(
        async (p) => {
          queue.push({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy, battery: await battery(), at: Date.now() })
          while (queue.length > 5) queue.shift()
          try {
            const res = await fetch(`/api/trips/${tripId}/positions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(queue) })
            if (res.ok) queue.length = 0
            if (res.status === 409) { clearInterval(intervalId); location.reload() }
          } catch {}
        },
        () => {},
        { enableHighAccuracy: true, timeout: 20000, maximumAge: 10000 },
      )
    }
    ping()
    const intervalId = setInterval(ping, every)

    const slider = $('[data-help-slider] input')
    if (slider) {
      slider.addEventListener('change', async () => {
        if (Number(slider.value) < 95) { slider.value = 0; return }
        slider.disabled = true
        const status = $('#help-status')
        status.textContent = 'Reaching SARZA…'
        for (;;) {
          try {
            const r = await fetch(`/api/trips/${tripId}/help`, { method: 'POST', headers: { accept: 'application/json', 'content-type': 'application/json' }, body: '{}' })
            if (r.ok) { location.href = '/trip'; return }
          } catch {}
          status.textContent = 'Still trying to reach SARZA. Phone ' + body.dataset.emergency + ' if you can.'
          await new Promise((r) => setTimeout(r, 5000))
        }
      })
    }
  }

  // board auto refresh
  if (body.dataset.refresh) setTimeout(() => location.reload(), Number(body.dataset.refresh) * 1000)
})()
