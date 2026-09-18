;(async function () {
  const body = document.body
  const $ = (s, root = document) => root.querySelector(s)
  const $$ = (s, root = document) => Array.from(root.querySelectorAll(s))

  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {})

  function b64ToBytes(s) {
    const pad = '='.repeat((4 - (s.length % 4)) % 4)
    const bin = atob((s + pad).replace(/-/g, '+').replace(/_/g, '/'))
    return Uint8Array.from(bin, (ch) => ch.charCodeAt(0))
  }

  async function battery() {
    try { const b = await navigator.getBattery(); return Math.round(b.level * 100) } catch { return null }
  }

  // ---------- push ----------
  const vapid = body.dataset.vapid
  const off = $('#alerts-off')
  const canPush = 'Notification' in window && 'PushManager' in window
  const granted = () => canPush && Notification.permission === 'granted'
  if (off && !granted()) off.hidden = false
  const pushSetup = $('[data-push-setup]')
  const markPushDone = () => { if (pushSetup) { pushSetup.classList.add('done'); const b = $('[data-enable-push]', pushSetup); if (b) b.hidden = true } }
  if (granted()) markPushDone()
  const standalone = $('[data-standalone]')
  if (standalone && (matchMedia('(display-mode: standalone)').matches || navigator.standalone)) standalone.classList.add('done')

  async function subscribePush() {
    if (!canPush) {
      alert('On iPhone: tap Share, then "Add to Home Screen", then open Beacon from your home screen and try again.')
      return
    }
    if ((await Notification.requestPermission()) !== 'granted') return
    markPushDone()
    if (!vapid) return // profile not saved yet; the home screen subscribes once it is
    const reg = await navigator.serviceWorker.ready
    const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(vapid) })
    await fetch('/api/push/subscribe', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(sub.toJSON()) })
    if (off) off.hidden = true
  }
  $$('[data-enable-push]').forEach((b) => b.addEventListener('click', () => subscribePush().catch(console.error)))
  if (vapid && granted()) subscribePush().catch(() => {})

  // ---------- multi-step forms ----------
  const stepForm = $('[data-steps]')
  if (stepForm) {
    const steps = $$('[data-step]', stepForm)
    const count = $('[data-step-count]')
    const bars = $$('[data-step-progress] span')
    const back = $('[data-step-back]')
    let at = 0
    // After a server error, open on the step that holds the message.
    const errorStep = steps.findIndex((s) => $('.banner.error', s))
    function show(i, focus) {
      at = Math.max(0, Math.min(steps.length - 1, i))
      steps.forEach((s, j) => s.classList.toggle('current', j === at))
      if (count) count.textContent = `${at + 1}/${steps.length}`
      if (count) count.setAttribute('aria-label', `Step ${at + 1} of ${steps.length}`)
      bars.forEach((b, j) => b.classList.toggle('on', j <= at))
      window.scrollTo(0, 0)
      if (focus) { const h = $('h1', steps[at]); if (h) { h.setAttribute('tabindex', '-1'); h.focus() } }
      stepForm.dispatchEvent(new CustomEvent('step', { detail: at }))
    }
    function valid(step) {
      for (const el of $$('input, select, textarea', step)) {
        if (!el.checkValidity()) { el.reportValidity(); return false }
      }
      return true
    }
    stepForm.addEventListener('click', (e) => {
      const next = e.target.closest('[data-step-next]')
      if (!next) return
      if (!next.hasAttribute('data-skip') && !valid(steps[at])) return
      show(at + 1, true)
    })
    back?.addEventListener('click', (e) => {
      if (at === 0) return // follow the link
      e.preventDefault()
      show(at - 1, true)
    })
    // Enter moves forward instead of submitting half a form.
    stepForm.addEventListener('keydown', (e) => {
      const t = e.target
      const texty = t.tagName === 'INPUT' && !['button', 'submit', 'checkbox', 'radio', 'file', 'range'].includes(t.type)
      if (e.key !== 'Enter' || !texty) return
      if (at < steps.length - 1) { e.preventDefault(); if (valid(steps[at])) show(at + 1, true) }
    })
    stepForm.addEventListener('submit', (e) => {
      const bad = steps.findIndex((s) => $$('input, select, textarea', s).some((el) => !el.checkValidity()))
      if (bad !== -1) { e.preventDefault(); show(bad); valid(steps[bad]) }
    })
    show(errorStep === -1 ? 0 : errorStep)
  }

  // Sliders that must be dragged from the start, not tapped: a tap on a range input jumps
  // straight to where you touched, so any first jump past 25% is thrown back to zero.
  function dragOnly(range, onDone, onMove = () => {}) {
    let ok = false
    let fresh = true
    const reset = () => { range.value = 0; ok = false; fresh = true; onMove() }
    range.addEventListener('pointerdown', () => { fresh = true; ok = false })
    range.addEventListener('input', () => {
      if (fresh) { fresh = false; ok = Number(range.value) <= 25; if (!ok) { reset(); return } }
      onMove()
    })
    range.addEventListener('change', () => {
      if (ok && Number(range.value) >= 90) onDone()
      else reset()
    })
    return reset
  }

  // Slide to cancel: needs a deliberate drag all the way across.
  const cancel = $('[data-slide-cancel]')
  if (cancel) {
    const range = $('input', cancel)
    const knob = $('.knob', cancel)
    const place = () => { knob.style.transform = `translateX(${(range.value / 100) * (cancel.clientWidth - 41)}px)` }
    dragOnly(range, () => { location.href = cancel.dataset.slideCancel }, place)
  }

  // Photo previews: show what was picked in place of the placeholder icon.
  $$('[data-preview] input[type=file]').forEach((input) => {
    input.addEventListener('change', () => {
      const file = input.files && input.files[0]
      if (!file) return
      const box = input.closest('[data-preview]')
      const frame = $('.frame', box) || box
      $$('.icon', frame).forEach((i) => i.remove())
      let img = $('img', frame)
      if (!img) { img = document.createElement('img'); img.alt = ''; frame.prepend(img) }
      img.src = URL.createObjectURL(file)
      if (input.hasAttribute('data-select-radio')) { const r = $('input[type=radio]', box); if (r) r.checked = true }
    })
  })

  // ---------- new trip ----------
  const form = $('[data-new-trip]')
  if (form) {
    const placeEl = $('[data-place]', form)
    const accEl = $('[data-accuracy]', form)
    let placeName = null
    navigator.geolocation?.getCurrentPosition(
      async (p) => {
        form.start_lat.value = p.coords.latitude
        form.start_lng.value = p.coords.longitude
        form.start_accuracy.value = p.coords.accuracy
        accEl.textContent = `±${Math.round(p.coords.accuracy)} m`
        placeEl.textContent = `${p.coords.latitude.toFixed(4)}, ${p.coords.longitude.toFixed(4)}`
        try {
          const r = await fetch(`/api/place?lat=${p.coords.latitude}&lng=${p.coords.longitude}`, { headers: { accept: 'application/json' } })
          const j = await r.json()
          if (j.place) { placeName = j.place; placeEl.textContent = j.place; summary() }
        } catch {}
      },
      () => { placeEl.textContent = "We couldn't find you yet"; accEl.textContent = 'Allow location so we know where you started' },
      { enableHighAccuracy: true, timeout: 15000 },
    )
    battery().then((b) => {
      if (b == null) return
      form.battery.value = b
      const line = $('#battery-line')
      line.hidden = false
      $('span span', line).textContent = b + '%'
    })

    // back-by
    const ret = $('[data-return]', form)
    const pad = (n) => String(n).padStart(2, '0')
    const toInput = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
    function dayWord(d) {
      const t = new Date(); const tm = new Date(Date.now() + 86400000)
      if (d.toDateString() === t.toDateString()) return 'Today'
      if (d.toDateString() === tm.toDateString()) return 'Tomorrow'
      return d.toLocaleDateString('en-ZA', { weekday: 'short' })
    }
    function showReturn() {
      const d = new Date(ret.value)
      if (isNaN(d)) return
      $('[data-return-time]').textContent = `${pad(d.getHours())}:${pad(d.getMinutes())}`
      $('[data-return-day]').textContent = dayWord(d)
      summary()
    }
    ret.addEventListener('input', () => { $$('[data-plus-hours]').forEach((b) => b.setAttribute('aria-pressed', 'false')); showReturn() })
    $$('[data-plus-hours]').forEach((b) => b.addEventListener('click', () => {
      const d = new Date(Date.now() + Number(b.dataset.plusHours) * 3600000)
      d.setMinutes(Math.ceil(d.getMinutes() / 5) * 5, 0, 0)
      ret.value = toInput(d)
      $$('[data-plus-hours]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)))
      showReturn()
    }))
    showReturn()

    function summary() {
      const line = $('[data-summary-line]', form)
      const when = $('[data-summary-when]', form)
      if (!line) return
      const act = line.dataset.base || (line.dataset.base = line.textContent)
      line.textContent = placeName ? `${act} from ${placeName}` : act
      const d = new Date(ret.value)
      const ticked = $$('input[name=checklist]', form)
      if (!isNaN(d)) when.textContent = `Back by ${dayWord(d).toLowerCase()} ${pad(d.getHours())}:${pad(d.getMinutes())} · ${ticked.filter((c) => c.checked).length} of ${ticked.length} ticked`
    }
    form.addEventListener('change', summary)

    // companions
    const list = $('[data-people]', form)
    const wrap = $('[data-people-wrap]', form)
    const tpl = $('[data-person-template]', form)
    $$('.no-js-only', list).forEach((li) => li.remove())
    $$('[data-company]', form).forEach((r) => r.addEventListener('change', () => { wrap.hidden = form.company.value === 'alone' }))
    $('[data-add-person]', form).addEventListener('click', () => {
      list.append(tpl.content.firstElementChild.cloneNode(true))
      $$('input[name=companion_name]', list).pop().focus()
    })
    list.addEventListener('click', (e) => {
      const rm = e.target.closest('[data-remove-person]')
      if (!rm) return
      const li = rm.closest('[data-person]')
      if ($$('[data-person]', list).length > 1) li.remove()
      else $$('input', li).forEach((i) => { i.value = '' })
    })
    list.addEventListener('input', (e) => {
      if (e.target.name !== 'companion_name') return
      const av = $('[data-initials]', e.target.closest('[data-person]'))
      const ini = e.target.value.trim().split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('')
      if (ini) av.textContent = ini
    })
  }

  // Flags follow the chosen country code (only South Africa has one drawn).
  $$('select[data-cc]').forEach((sel) => sel.addEventListener('change', () => {
    const flag = $('.flag', sel.parentElement)
    if (flag) flag.style.visibility = sel.value === '27' ? 'visible' : 'hidden'
    sel.style.paddingLeft = sel.value === '27' ? '' : '14px'
  }))

  // ---------- live trip ----------
  const tripId = body.dataset.tripId
  if (tripId) {
    const every = body.dataset.tripStatus === 'help' ? 30000 : 120000
    const queue = []
    const status = $('#help-status')
    function ping() {
      navigator.geolocation?.getCurrentPosition(
        async (p) => {
          queue.push({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy, battery: await battery(), at: Date.now() })
          while (queue.length > 5) queue.shift()
          try {
            const res = await fetch(`/api/trips/${tripId}/positions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(queue) })
            if (res.ok) {
              queue.length = 0
              if (body.dataset.tripStatus === 'help' && status) status.textContent = 'Position sent ' + new Date().toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' })
            }
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
      dragOnly(slider, async () => {
        slider.disabled = true
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
      slider.value = 0
    }
  }

  // ---------- operator menu ----------
  const menu = $('[data-menu]')
  if (menu) {
    const open = (e) => { e.preventDefault(); menu.classList.add('open'); $('.sheet a, .sheet button', menu)?.focus() }
    const close = (e) => { if (e) e.preventDefault(); menu.classList.remove('open'); if (location.hash === '#menu') history.replaceState(null, '', location.pathname + location.search) }
    $$('[data-menu-open]').forEach((a) => a.addEventListener('click', open))
    $$('[data-menu-close]', menu).forEach((a) => a.addEventListener('click', close))
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && menu.classList.contains('open')) close() })
  }

  // board auto refresh
  if (body.dataset.refresh) {
    const tick = () => { if (menu && menu.classList.contains('open')) setTimeout(tick, 5000); else location.reload() }
    setTimeout(tick, Number(body.dataset.refresh) * 1000)
  }
})()
