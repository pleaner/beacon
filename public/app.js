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
      alert('On iPhone: tap Share, then "Add to Home Screen", then open Guardian from your home screen and try again.')
      return
    }
    if ((await Notification.requestPermission()) !== 'granted') return
    if (!vapid) return markPushDone() // profile not saved yet; the home screen subscribes once it is
    const reg = await navigator.serviceWorker.ready
    const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(vapid) })
    const r = await fetch('/api/push/subscribe', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(sub.toJSON()) })
    if (!r.ok) throw new Error('subscribe ' + r.status)
    markPushDone()
    if (off) off.hidden = true
  }
  $$('[data-enable-push]').forEach((b) => b.addEventListener('click', () => subscribePush().catch((e) => {
    console.error(e)
    alert("Couldn't turn on alerts. Check your signal and try again.")
  })))
  if (vapid && granted()) subscribePush().catch(() => { if (off) off.hidden = false })

  // Location and microphone, asked for during profile set-up so the browser's prompt doesn't first appear mid-trip.
  // Photos need no permission: the photo picker is the phone's own.
  const ask = {
    geolocation: () => new Promise((ok, fail) => navigator.geolocation.getCurrentPosition(ok, fail, { timeout: 20000 })),
    microphone: () => navigator.mediaDevices.getUserMedia({ audio: true }).then((s) => s.getTracks().forEach((t) => t.stop())),
  }
  const blocked = {
    geolocation: "Location is blocked. Turn it on for Guardian in your phone's settings, then try again.",
    microphone: "The microphone is blocked. Turn it on for Guardian in your phone's settings, then try again.",
  }
  $$('[data-permit]').forEach((row) => {
    const name = row.dataset.permit
    const button = $('[data-ask]', row)
    const done = () => { row.classList.add('done'); button.hidden = true }
    navigator.permissions?.query({ name }).then((p) => { if (p.state === 'granted') done() }).catch(() => {})
    button.addEventListener('click', () => ask[name]().then(done, () => alert(blocked[name])))
  })

  // "My pets": add and remove rows; the form saves the whole list.
  const petEditor = $('[data-pet-editor]')
  if (petEditor) {
    const rows = $('[data-pets]', petEditor)
    $$('.no-js-only', rows).forEach((li) => li.remove())
    $('[data-add-pet]', petEditor).addEventListener('click', () => {
      rows.append($('[data-pet-template]', petEditor).content.firstElementChild.cloneNode(true))
      $$('input', rows).pop().focus()
    })
    rows.addEventListener('click', (e) => e.target.closest('[data-remove-pet]')?.closest('[data-pet]').remove())
  }

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
    // A step holding the start point can't pass until the phone has given us a GPS fix.
    const noGps = (step) => $('[data-startpoint]', step) && !stepForm.start_lat?.value
    function valid(step) {
      for (const el of $$('input, select, textarea', step)) {
        if (!el.checkValidity()) { el.reportValidity(); return false }
      }
      if (noGps(step)) { $('[data-startpoint]', step).dispatchEvent(new Event('needgps')); return false }
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
      const bad = steps.findIndex((s) => noGps(s) || $$('input, select, textarea', s).some((el) => !el.checkValidity()))
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
    const startEl = $('[data-startpoint]', form)
    let placeName = null
    const locate = () => navigator.geolocation?.getCurrentPosition(
      async (p) => {
        startEl.classList.remove('need')
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
      (err) => {
        placeEl.textContent = "We couldn't find you yet"
        accEl.textContent = err.code === err.PERMISSION_DENIED
          ? 'Location is off. Turn it on for this site in your browser settings, then tap Next.'
          : 'Still looking. Step outside if you can, then tap Next.'
      },
      { enableHighAccuracy: true, timeout: 15000 },
    )
    locate()
    startEl.addEventListener('needgps', () => {
      startEl.classList.add('need')
      if (!navigator.geolocation) { accEl.textContent = "This browser can't share your location. Try another browser."; return }
      accEl.textContent = 'We need your location before you go. Checking again…'
      locate()
    })
    battery().then((b) => {
      if (b == null) return
      form.battery.value = b
      const line = $('#battery-line')
      line.hidden = false
      $('span span', line).textContent = b + '%'
      const item = $('input[name=checklist][value^="Phone battery"]', form)
      if (!item) return
      if (b > 50) { item.checked = true; summary() }
      else if (b < 50) item.parentElement.classList.add('low')
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
      const mins = Math.max(0, Math.round((d - Date.now()) / 60000))
      const parts = [[Math.floor(mins / 10080), 'w'], [Math.floor(mins / 1440) % 7, 'd'], [Math.floor(mins / 60) % 24, 'h'], [mins % 60, 'm']]
        .filter(([n]) => n).map(([n, u]) => n + u)
      $('[data-return-in]').textContent = `in ${parts.join(' ') || '0m'}`
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
    form.activity_text?.addEventListener('input', summary)
    setInterval(showReturn, 30000) // keep the countdown honest while they sit on the step

    function summary() {
      const line = $('[data-summary-line]', form)
      const when = $('[data-summary-when]', form)
      if (!line) return
      const base = line.dataset.base || (line.dataset.base = line.textContent)
      const act = form.activity_text?.value.trim() || base
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
    // One person, a full-body photo; more than one, a group photo. Pets don't count.
    const photoCard = $('[data-photo-copy]', form)
    const photoCopy = JSON.parse(photoCard.dataset.photoCopy)
    form.addEventListener('step', () => {
      const group = form.company.value === 'group' && $$('input[name=companion_name]', list).some((i) => i.value.trim())
      const c = photoCopy[group ? 'group' : 'solo']
      $('[data-photo-title]', photoCard).textContent = c.title
      $('[data-photo-hint]', photoCard).textContent = c.hint
      $('input[type=file]', photoCard).setAttribute('aria-label', c.title)
    })
    const pets = $('[data-pets]', form)
    $$('.no-js-only', pets).forEach((li) => li.remove())
    const addPet = (name = '') => {
      pets.append($('[data-pet-template]', form).content.firstElementChild.cloneNode(true))
      const input = $$('input[name=pet_name]', pets).pop()
      input.value = name
      if (!name) input.focus()
    }
    // With pets from earlier trips, "Add a pet" opens a picker: one of those, or a new one.
    // A pet already on the list isn't offered; with nothing left to offer, it adds a blank row straight away.
    const addPetBtn = $('[data-add-pet]', form)
    const picker = $('[data-pet-picks]', form)
    const picks = $$('[data-pet-pick]', form)
    const syncPicks = () => {
      const on = $$('input[name=pet_name]', pets).map((i) => i.value.trim().toLowerCase())
      picks.forEach((b) => { b.hidden = on.includes(b.dataset.petPick.toLowerCase()) })
    }
    const closePicker = () => { if (picker) picker.hidden = true; addPetBtn.hidden = false }
    addPetBtn.addEventListener('click', () => {
      syncPicks()
      if (!picks.some((b) => !b.hidden)) return addPet()
      picker.hidden = false
      addPetBtn.hidden = true
    })
    picks.forEach((b) => b.addEventListener('click', () => { addPet(b.dataset.petPick); closePicker() }))
    if (picker) $('[data-pet-new]', picker).addEventListener('click', () => { closePicker(); addPet() })
    pets.addEventListener('click', (e) => e.target.closest('[data-remove-pet]')?.closest('[data-pet]').remove())
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

  // The SARZA text number, set by admins. Kept on the phone so it's there when the signal isn't.
  if (body.dataset.sms !== undefined) { try { localStorage.setItem('sms', body.dataset.sms) } catch {} }

  // ---------- live trip ----------
  const tripId = body.dataset.tripId
  if (tripId) {
    const every = body.dataset.tripStatus === 'help' ? 30000 : 120000
    const status = $('#help-status')
    // Fixes wait in localStorage until they reach the server, so a stretch without signal
    // or the app being closed doesn't lose them. Other trips' leftovers are dropped.
    const key = 'positions:' + tripId
    try {
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const k = localStorage.key(i)
        if (k.startsWith('positions:') && k !== key) localStorage.removeItem(k)
      }
    } catch {}
    const load = () => { try { return JSON.parse(localStorage.getItem(key)) || [] } catch { return [] } }
    const save = (q) => { try { localStorage.setItem(key, JSON.stringify(q)) } catch {} }
    let sending = false
    async function flush() {
      if (sending) return
      sending = true
      try {
        for (let q = load(); q.length; q = load()) {
          const batch = q.slice(0, 50)
          const res = await fetch(`/api/trips/${tripId}/positions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(batch) })
          if (res.status === 409) { localStorage.removeItem(key); clearInterval(intervalId); location.reload(); return }
          if (!res.ok) return
          // fixes taken while this batch was in flight were appended after it
          save(load().slice(batch.length))
          delivered = batch[batch.length - 1]
        }
      } catch {} finally { sending = false; show() }
    }
    // On the help screen, two cases. Signal, and the last fix we delivered is near where the phone is now: we know
    // where they are. No signal (fixes queued, or the phone offline): we still have their plan and return time.
    const where = $('#help-where')
    let delivered = where && where.dataset.at
      ? { lat: +where.dataset.lat, lng: +where.dataset.lng, altitude: where.dataset.alt ? +where.dataset.alt : null, at: +where.dataset.at }
      : null
    let latest = null
    let noFix = false
    const deg = (v, pos, neg) => `${Math.abs(v).toFixed(5)}° ${v < 0 ? neg : pos}`
    const fixLine = (p) => `${deg(p.lat, 'N', 'S')}, ${deg(p.lng, 'E', 'W')}` + (p.altitude != null ? `\nElevation ${Math.round(p.altitude)} m` : '')
    const hhmm = (ms) => new Date(ms).toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' })
    const metres = (a, b) => {
      const r = Math.PI / 180
      return 6371000 * Math.hypot((b.lng - a.lng) * r * Math.cos(((a.lat + b.lat) / 2) * r), (b.lat - a.lat) * r)
    }
    function show() {
      if (body.dataset.tripStatus !== 'help' || !where) return
      const title = $('b', where)
      const stay = $('#help-stay')
      const STAY = "If it's safe where you are, stay put."
      const offline = load().length > 0 || !navigator.onLine
      // ponytail: 100 m or the fix's own accuracy, whichever is wider, counts as "near"
      const near = delivered && (!latest || metres(latest, delivered) <= Math.max(100, latest.accuracy || 0))
      stay.textContent = STAY
      // Near the position we hold: show it, so they can see we have it.
      $('#help-fix').textContent = delivered && near ? fixLine(delivered) : ''
      if (offline) {
        // Without signal we still hold their plan and return time, so the message is: stay put, we'll come.
        title.textContent = 'No signal right now.'
        status.textContent = `We have your trip plan, and you're due back at ${where.dataset.back}.`
        stay.textContent = `${STAY} If we still can't reach you by ${where.dataset.back}, we'll come and find you.`
      } else if (delivered && near) {
        title.textContent = 'We know where you are.'
        status.textContent = 'Last position ' + hhmm(delivered.at)
        stay.textContent = STAY + ' We know where you are.'
      } else if (noFix && !delivered) {
        title.textContent = "We can't get your location."
        const tel = document.createElement('a')
        tel.href = 'tel:' + where.dataset.emergency
        tel.textContent = where.dataset.emergencyLabel
        status.replaceChildren('Phone SARZA on ', tel, ' and tell them where you are.')
      } else {
        title.textContent = 'Finding your location…'
        status.textContent = ''
      }
    }
    addEventListener('offline', show)
    function ping() {
      navigator.geolocation?.getCurrentPosition(
        async (p) => {
          const c = p.coords
          // Signal at the moment of the fix: offline, the connection type where the browser says (Android), or just online.
          const signal = !navigator.onLine ? 'none' : navigator.connection?.effectiveType || 'online'
          const fix = { lat: c.latitude, lng: c.longitude, accuracy: c.accuracy, altitude: c.altitude, altitude_accuracy: c.altitudeAccuracy, battery: await battery(), signal, at: p.timestamp || Date.now() }
          noFix = false
          latest = fix
          const q = load()
          q.push(fix)
          // ponytail: keeps the newest 500 (about 16 h at one fix every 2 min); thin the old ones if trips run longer
          save(q.slice(-500))
          flush()
        },
        () => { noFix = true; show() },
        { enableHighAccuracy: true, timeout: 20000, maximumAge: 10000 },
      )
    }
    addEventListener('online', flush)
    ping()
    const intervalId = setInterval(ping, every)
    flush()

    // A call for help stays on the phone until the server confirms it, so no signal, a locked screen or a closed app
    // doesn't lose it. Only the server's answer leads to the "SARZA has been alerted" screen.
    const slider = $('[data-help-slider] input')
    const pending = $('#help-pending')
    const helpKey = 'help:' + tripId
    let helpWanted = false
    const isPending = () => { if (helpWanted) return true; try { return !!localStorage.getItem(helpKey) } catch { return false } }
    const dropHelp = () => { helpWanted = false; try { localStorage.removeItem(helpKey) } catch {} }
    // The server has it: a leftover must not resend after "Cancel, I'm fine" brings the trip screen back.
    if (body.dataset.tripStatus === 'help') dropHelp()
    let sendingHelp = false
    async function sendHelp() {
      if (!pending) return
      helpWanted = true
      try { localStorage.setItem(helpKey, String(Date.now())) } catch {}
      body.classList.add('help-pending')
      pending.hidden = false
      scrollTo(0, 0)
      if (sendingHelp) return
      sendingHelp = true
      const title = $('[data-pending-title]', pending), sub = $('[data-pending-sub]', pending)
      const sms = $('[data-help-sms]', pending)
      let number = ''
      try { number = localStorage.getItem('sms') || '' } catch {}
      while (isPending()) {
        try {
          const r = await fetch(`/api/trips/${tripId}/help`, { method: 'POST', headers: { accept: 'application/json', 'content-type': 'application/json' }, body: '{}' })
          // 4xx (trip already ended, say) won't get better by retrying: let the server's page explain.
          if (r.ok || (r.status >= 400 && r.status < 500)) { dropHelp(); location.href = '/trip'; return }
        } catch {}
        title.textContent = "We haven't reached SARZA yet."
        sub.textContent = "We'll keep trying, and send it the moment you have signal."
        if (number) {
          const fix = latest || delivered
          const text = pending.dataset.smsText + (fix ? ` Position ${fix.lat.toFixed(5)}, ${fix.lng.toFixed(5)}.` : '')
          sms.href = `sms:${number}?&body=${encodeURIComponent(text)}`
          sms.hidden = false
        }
        await new Promise((r) => { const t = setTimeout(r, 5000); addEventListener('online', () => { clearTimeout(t); r() }, { once: true }) })
      }
      sendingHelp = false
    }
    if (slider) {
      dragOnly(slider, sendHelp)
      slider.value = 0
      const undo = pending && $('[data-help-undo]', pending)
      // Works offline: no reload, just back to the trip screen. A request already in flight may still land,
      // and then the alert screen, with its own cancel, is the truth.
      if (undo) undo.addEventListener('click', () => {
        dropHelp()
        body.classList.remove('help-pending')
        pending.hidden = true
        slider.value = 0
        slider.disabled = false
      })
      if (isPending()) sendHelp()
    }
  }

  // ---------- chat ----------
  const chat = $('[data-chat]')
  if (chat) {
    const url = `/api/trips/${chat.dataset.chat}/messages`
    const list = $('[data-msgs]', chat)
    const chatForm = $('form', chat)
    const text = $('textarea', chatForm)
    const time = (ms) => new Date(ms).toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit', hour12: false })
    // Names and bodies are user input: textContent only.
    function media(m) {
      if (!m.media_type) return []
      const src = `${url}/${m.id}/media`
      if (m.media_type.startsWith('audio/')) {
        const a = document.createElement('audio')
        a.className = 'media'
        a.controls = true
        a.preload = 'none'
        a.src = src
        return [a]
      }
      const link = document.createElement('a')
      link.className = 'media'
      link.href = src
      link.target = '_blank'
      const img = document.createElement('img')
      img.src = src
      img.alt = 'Photo'
      img.loading = 'lazy'
      link.append(img)
      return [link]
    }
    function render(msgs) {
      // Follow the newest message, unless they've scrolled up to read and nothing new came in.
      const follow = msgs.length > list.children.length || list.scrollHeight - list.scrollTop - list.clientHeight < 40
      // A new message from the other side while the screen is open: buzz (Android), since no push banner may show.
      const mine = chat.dataset.me
      if (list.children.length && msgs.length > list.children.length && msgs.slice(list.children.length).some((m) => m.author_role !== mine)) navigator.vibrate?.([120, 80, 120])
      list.replaceChildren(...msgs.map((m) => {
        const li = document.createElement('li')
        li.className = 'msg ' + m.author_role
        const who = document.createElement('div')
        who.className = 'who2'
        const small = document.createElement('small')
        const n = document.createElement('span')
        n.className = 'n'
        n.textContent = `${m.author_name} · `
        small.append(n, time(m.created_at))
        const span = document.createElement('span')
        span.textContent = m.body
        who.append(small, span, ...media(m))
        li.append(who)
        return li
      }))
      if (follow) list.scrollTop = list.scrollHeight
      // photos arrive after layout; keep the newest in view as they load
      if (follow) $$('img', list).forEach((i) => i.addEventListener('load', () => { list.scrollTop = list.scrollHeight }, { once: true }))
    }
    async function poll() {
      if (document.hidden) return
      try { const r = await fetch(url, { headers: { accept: 'application/json' } }); if (r.ok) render((await r.json()).messages) } catch {}
    }
    list.scrollTop = list.scrollHeight
    // On the alert screen replies matter most: check every 5 seconds, not 15.
    setInterval(poll, $('main.help-screen') ? 5000 : 15000)
    document.addEventListener('visibilitychange', poll)

    // One way out for text, photos and voice notes. Returns true once the server has it.
    async function send(payload) {
      chatForm.setAttribute('aria-busy', 'true')
      try {
        const r = payload instanceof FormData
          ? await fetch(url, { method: 'POST', headers: { accept: 'application/json' }, body: payload })
          : await fetch(url, { method: 'POST', headers: { accept: 'application/json', 'content-type': 'application/json' }, body: JSON.stringify(payload) })
        const j = await r.json().catch(() => ({}))
        if (r.ok) { render(j.messages); return true }
        alert(j.error || 'Not sent. Try again.')
      } catch { alert('Not sent. Check your signal and try again.') } finally { chatForm.removeAttribute('aria-busy') }
      return false
    }
    const sendFile = (file) => { const fd = new FormData(); fd.append('media', file); return send(fd) }

    // Enter sends, Shift+Enter starts a new line.
    text.enterKeyHint = 'send'
    text.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); if (text.value.trim()) chatForm.requestSubmit() }
    })
    chatForm.addEventListener('submit', async (e) => {
      e.preventDefault()
      if (text.value.trim() && (await send({ body: text.value }))) text.value = ''
    })

    // Photos go out as soon as they're picked, shrunk to 1600 px so they get through on a weak signal.
    const photo = $('input[type=file]', chatForm)
    photo.addEventListener('change', async () => {
      const file = photo.files[0]
      photo.value = ''
      if (file) await sendFile(await shrink(file))
    })
    async function shrink(file) {
      try {
        const bmp = await createImageBitmap(file)
        const k = Math.min(1, 1600 / Math.max(bmp.width, bmp.height))
        const c = document.createElement('canvas')
        c.width = Math.round(bmp.width * k)
        c.height = Math.round(bmp.height * k)
        c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height)
        const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.8))
        return blob ? new File([blob], 'photo.jpg', { type: 'image/jpeg' }) : file
      } catch { return file }
    }

    // Voice note: tap the mic to record, tap again to send. Safari gives audio/mp4, Chrome audio/webm.
    const mic = $('[data-voice]', chatForm)
    if (mic && window.MediaRecorder && navigator.mediaDevices) {
      mic.hidden = false
      const hint = text.placeholder
      let recorder = null
      let tick = null
      mic.addEventListener('click', async () => {
        if (recorder) { recorder.stop(); return }
        let stream
        try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }) } catch { alert('Allow the microphone to send a voice note.'); return }
        const chunks = []
        const r = recorder = new MediaRecorder(stream, { audioBitsPerSecond: 64000 })
        r.ondataavailable = (e) => chunks.push(e.data)
        r.onstop = async () => {
          stream.getTracks().forEach((t) => t.stop())
          clearInterval(tick)
          recorder = null
          mic.classList.remove('rec')
          text.placeholder = hint
          const type = (r.mimeType || chunks[0]?.type || 'audio/webm').split(';')[0]
          const file = new File(chunks, 'voice.' + type.split('/')[1], { type })
          if (file.size) await sendFile(file)
        }
        r.start()
        mic.classList.add('rec')
        const started = Date.now()
        const show = () => { const s = Math.floor((Date.now() - started) / 1000); text.placeholder = `Recording ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}. Tap to send` }
        show()
        tick = setInterval(show, 500)
        // ponytail: two minutes at 64 kbit/s stays under the server's 2 MB cap
        setTimeout(() => r.state === 'recording' && r.stop(), 120000)
      })
    }
  }

  // ---------- end of trip: share ----------
  const done = $('[data-share-url]')
  if (done) {
    const { shareUrl: url, shareText: text, shareName: name } = done.dataset
    // An SVG drawn through <img> can't reach the page's web fonts, so the PNG falls back to system fonts.
    // Pin each line to its width in the web font, so a wider fallback is squeezed rather than overflowing.
    const cardPng = () => document.fonts.ready.then(() => new Promise((resolve, reject) => {
      const card = $('#trip-card').cloneNode(true)
      $$('text', $('#trip-card')).forEach((t, i) => {
        const c = $$('text', card)[i]
        if (!c.hasAttribute('textLength')) { c.setAttribute('textLength', t.getComputedTextLength().toFixed(1)); c.setAttribute('lengthAdjust', 'spacingAndGlyphs') }
      })
      const svg = new XMLSerializer().serializeToString(card)
      const img = new Image()
      img.onload = () => {
        const cv = document.createElement('canvas')
        cv.width = 1080; cv.height = 1920
        cv.getContext('2d').drawImage(img, 0, 0, 1080, 1920)
        cv.toBlob((b) => (b ? resolve(new File([b], name, { type: 'image/png' })) : reject(new Error('no image'))), 'image/png')
      }
      img.onerror = reject
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg)
    }))
    const share = async (data) => {
      try { await navigator.share(data); return true } catch (e) { return e && e.name === 'AbortError' }
    }
    // Draw it now: Safari only opens the share sheet straight after a tap, not after slow work.
    const ready = cardPng().catch(() => null)
    $('[data-share-card]').addEventListener('click', async () => {
      const file = await ready
      if (file && navigator.canShare && navigator.canShare({ files: [file] }) && (await share({ files: [file], text: `${text} ${url}` }))) return
      // No file sharing (most desktops): save the image instead.
      if (file) { const a = document.createElement('a'); a.href = URL.createObjectURL(file); a.download = name; a.click() }
    })
  }

  // ---------- end of trip: confetti ----------
  // ponytail: hand-rolled, SARZA navy, red and yellow; skipped for people who turn motion off.
  if (done && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
    const cv = document.createElement('canvas')
    cv.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:50'
    document.body.append(cv)
    const W = (cv.width = innerWidth * devicePixelRatio), H = (cv.height = innerHeight * devicePixelRatio)
    const ctx = cv.getContext('2d'), colors = ['#212c65', '#d2202f', '#fadf06']
    const d = devicePixelRatio
    // Staggered above the top edge so it keeps raining for a few seconds.
    const bits = Array.from({ length: 400 }, (_, i) => ({
      x: Math.random() * W, y: -Math.random() * H * 1.5 - 20 * d, vy: (3 + Math.random() * 4) * d,
      sway: Math.random() * Math.PI * 2, r: Math.random() * 6, vr: Math.random() * 0.2 - 0.1,
      w: (7 + Math.random() * 6) * d, h: (11 + Math.random() * 8) * d, c: colors[i % 3],
    }))
    const frame = (t) => {
      ctx.clearRect(0, 0, W, H)
      let live = 0
      for (const b of bits) {
        b.y += b.vy; b.x += Math.sin(t / 400 + b.sway) * 1.5 * d; b.r += b.vr
        if (b.y > H + 20 * d) continue
        live++
        ctx.save(); ctx.translate(b.x, b.y); ctx.rotate(b.r); ctx.scale(1, Math.cos(t / 150 + b.sway))
        ctx.fillStyle = b.c; ctx.fillRect(-b.w / 2, -b.h / 2, b.w, b.h); ctx.restore()
      }
      if (live) requestAnimationFrame(frame); else cv.remove()
    }
    requestAnimationFrame(frame)
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
