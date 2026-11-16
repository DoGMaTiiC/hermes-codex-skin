// Global plugin preference, deliberately independent of selected/focused owner.
const UNIVERSAL_INBOX_KEY = 'universal-inbox'
const UNIVERSAL_INBOX_EVENT = `${ID}:universal-inbox`
function readUniversalInbox() {
  // Local fork: a stored profile selection implies the aggregate it narrows, so
  // a selection keeps working even though the setting itself was never written.
  try { return pluginStorage?.get(UNIVERSAL_INBOX_KEY, readCodexInboxProfiles() !== null) === true }
  catch { return false }
}
function setUniversalInbox(value) {
  const next = value === true
  try {
    if (!pluginStorage?.set || !pluginStorage?.get) throw new Error('Storage unavailable')
    pluginStorage.set(UNIVERSAL_INBOX_KEY, next)
    if (pluginStorage.get(UNIVERSAL_INBOX_KEY, null) !== next) throw new Error('Setting was not saved')
  } catch {
    host.notify?.({ kind: 'error', message: 'Could not save the Universal Inbox setting.' })
    return readUniversalInbox()
  }
  window.dispatchEvent(new CustomEvent(UNIVERSAL_INBOX_EVENT))
  return next
}

// Fork local: the profile selection narrows the stock Universal Inbox.
//   absent / ['*'] -> every profile (upstream behaviour)
//   ['a', 'b']     -> only those profiles are read, owned and rendered
// A live event for a hidden profile resolves to no owner, so it is dropped by
// the existing scope check instead of gaining a new filter of its own.
const INBOX_PROFILES_KEY = 'inbox-profiles'
const INBOX_PROFILES_EVENT = `${ID}:inbox-profiles`
const INBOX_ALL_SCOPES = '*'

function readCodexInboxProfiles() {
  try {
    const raw = pluginStorage?.get(INBOX_PROFILES_KEY, null)
    if (!Array.isArray(raw) || !raw.length) return null
    const list = [...new Set(raw.filter(value => typeof value === 'string' && value.trim()).map(value => value.trim()))]
    return list.length ? list : null
  } catch { return null }
}

function isInboxAllProfiles(list) {
  return Array.isArray(list) && list.length === 1 && list[0] === INBOX_ALL_SCOPES
}

/** Profiles the aggregated Inbox may read, or null when it keeps them all. */
function codexInboxProfileFilter() {
  const list = readCodexInboxProfiles()
  if (!list || isInboxAllProfiles(list)) return null
  const wanted = new Set(list.filter(profile => profile !== INBOX_ALL_SCOPES))
  return wanted.size ? wanted : null
}

// Local fork: the stock Inbox admits a chat only while it is observed working,
// so a quiet profile renders as an empty list. Backfill the newest work-bearing
// chats of each selected profile once per selection, then keep admitting chats
// touched inside the recent window so a thread opened now shows up on its own.
const INBOX_SEED_KEY = 'inbox-seed-v2'
const INBOX_SEED_PER_PROFILE = 20
const INBOX_SEED_RECENT_WINDOW_S = 48 * 60 * 60

function seedCodexInboxOwner(inbox, scope, snapshot) {
  try {
    if (!inbox?.admission?.observe || !scope || !snapshot) return
    if (!readCodexInboxProfiles()) return
    const rows = Array.isArray(snapshot.sessions) ? snapshot.sessions : []
    if (!rows.length) return
    const stamp = `${JSON.stringify(readCodexInboxProfiles() || [])}|${scope.connectionId}|${scope.profile}`
    const saved = pluginStorage?.get(INBOX_SEED_KEY, null)
    const map = saved && typeof saved === 'object' && !Array.isArray(saved) ? saved : {}
    const seeded = map[stamp] === true
    const cutoff = Date.now() / 1000 - INBOX_SEED_RECENT_WINDOW_S
    const candidates = rows.filter(row => row && codexInboxId(row) && !row.hidden && !row.archived &&
      Number(row.message_count) > 0 && codexInboxSource(row) === 'noncron')
    const recent = candidates.filter(row => (Number(row.last_active) || Number(row.started_at) || 0) >= cutoff)
    const newest = [...candidates]
      .sort((left, right) => (Number(right.last_active) || 0) - (Number(left.last_active) || 0))
      .slice(0, INBOX_SEED_PER_PROFILE)
    const chosen = seeded ? recent.slice(0, INBOX_SEED_PER_PROFILE) : [...new Map([...newest, ...recent].map(row => [codexInboxId(row), row])).values()]
    if (chosen.length) inbox.admission.observe(scope, chosen, { workingSessions: chosen })
    if (!seeded) pluginStorage?.set(INBOX_SEED_KEY, { ...map, [stamp]: true })
  } catch { /* seeding is best-effort; live work still admits */ }
}

function codexInboxProfileLabel() {
  const list = readCodexInboxProfiles()
  if (!list) return 'Todos'
  return isInboxAllProfiles(list) ? 'Todos' : list.join(', ')
}

function setCodexInboxProfiles(list) {
  const value = Array.isArray(list) && list.length ? [...new Set(list)] : null
  try {
    pluginStorage?.set(INBOX_PROFILES_KEY, value)
    if (JSON.stringify(pluginStorage?.get(INBOX_PROFILES_KEY, null)) !== JSON.stringify(value)) throw new Error('Inbox profiles were not saved.')
  } catch {
    host.notify?.({ kind: 'error', message: 'Could not save the Inbox profiles.' })
    return readCodexInboxProfiles()
  }
  window.dispatchEvent(new CustomEvent(INBOX_PROFILES_EVENT, { detail: readCodexInboxProfiles() }))
  return readCodexInboxProfiles()
}

/** Small centered picker: which profiles feed the aggregated Inbox. */
async function openInboxProfilesPicker() {
  const doc = globalThis.document
  if (!doc?.body) return
  let routes = []
  try { routes = typeof host.profileRoutes === 'function' ? await host.profileRoutes() : [] } catch { routes = [] }
  const names = (Array.isArray(routes) ? routes : [])
    .map(route => route && (route.profile || route.targetProfile))
    .filter(name => typeof name === 'string' && name && name !== INBOX_ALL_SCOPES && name !== 'all')
  const current = readCodexInboxProfiles()
  const available = [...new Set([...names, ...(current || []).filter(name => name !== INBOX_ALL_SCOPES)])].sort()
  const activeProfile = inboxGatewayScope().profile
  let allMode = !current || isInboxAllProfiles(current)
  const selected = new Set(current && !allMode ? current : [])

  const overlay = doc.createElement('div')
  overlay.setAttribute('data-codex-inbox-profiles', '')
  overlay.style.cssText = 'position:fixed;inset:0;z-index:10001;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.38);font:13px/1.5 -apple-system,system-ui,sans-serif;'
  const panel = doc.createElement('div')
  panel.style.cssText = 'box-sizing:border-box;width:360px;max-height:70vh;overflow:auto;padding:18px 20px 16px;border-radius:14px;border:1px solid var(--ui-stroke-secondary,#e5e5e5);background:var(--codex-color-card,var(--ui-editor-surface-background,#fff));color:var(--ui-text-primary,#171717);box-shadow:0 18px 48px #0000002e;'
  const title = doc.createElement('div')
  title.textContent = 'Inbox — perfis agregados'
  title.style.cssText = 'font-size:13px;font-weight:600;margin-bottom:4px;'
  const hint = doc.createElement('div')
  hint.textContent = 'Escolha quais perfis aparecem no Inbox. Settle/Snooze continuam por perfil.'
  hint.style.cssText = 'font-size:11px;color:var(--ui-text-tertiary,#737373);margin-bottom:12px;'
  panel.append(title, hint)

  const makeRow = (labelText, checked, onChange, muted) => {
    const row = doc.createElement('label')
    row.style.cssText = `display:flex;align-items:center;gap:9px;padding:7px 8px;border-radius:8px;cursor:pointer;${muted ? 'opacity:.55;' : ''}`
    const box = doc.createElement('input')
    box.type = 'checkbox'
    box.checked = checked
    box.style.cssText = 'width:14px;height:14px;accent-color:var(--dt-primary,#0d0d0d);'
    box.addEventListener('change', () => onChange(box.checked))
    const text = doc.createElement('span')
    text.textContent = labelText
    text.style.cssText = 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;'
    row.append(box, text)
    row.addEventListener('mouseenter', () => { row.style.background = 'var(--ui-row-hover-background,#f3f3f3)' })
    row.addEventListener('mouseleave', () => { row.style.background = 'transparent' })
    return row
  }

  panel.append(makeRow('Todos os perfis', allMode, checked => {
    allMode = checked
    if (checked) selected.clear()
    else if (!selected.size) selected.add(activeProfile)
    renderRows()
  }))

  const list = doc.createElement('div')
  list.style.cssText = 'margin:6px 0 2px;border-top:1px solid var(--ui-stroke-tertiary,#eee);padding-top:6px;'
  const renderRows = () => {
    list.replaceChildren()
    for (const name of available) {
      const row = makeRow(name, allMode || selected.has(name), checked => {
        if (allMode) return
        if (checked) selected.add(name)
        else selected.delete(name)
      }, allMode)
      row.querySelector('input').disabled = allMode
      list.append(row)
    }
    if (!available.length) {
      const empty = doc.createElement('div')
      empty.textContent = 'Nenhum perfil disponível neste dispositivo.'
      empty.style.cssText = 'font-size:11px;color:var(--ui-text-tertiary,#737373);padding:6px 8px;'
      list.append(empty)
    }
  }
  renderRows()
  panel.append(list)

  const footer = doc.createElement('div')
  footer.style.cssText = 'display:flex;justify-content:flex-end;gap:8px;margin-top:14px;'
  const button = (labelText, primary) => {
    const b = doc.createElement('button')
    b.type = 'button'
    b.textContent = labelText
    b.style.cssText = `padding:7px 14px;border-radius:9px;border:1px solid var(--ui-stroke-secondary,#e5e5e5);cursor:pointer;font:inherit;background:transparent;color:inherit;${primary ? 'background:var(--dt-primary,#0d0d0d);color:var(--dt-primary-foreground,#fff);border-color:transparent;' : ''}`
    return b
  }
  const close = () => overlay.remove()
  const cancel = button('Cancelar')
  cancel.addEventListener('click', close)
  const save = button('Salvar', true)
  save.addEventListener('click', () => {
    const value = allMode ? [INBOX_ALL_SCOPES] : (selected.size ? [...selected] : null)
    setCodexInboxProfiles(value)
    // A selection is inert while the aggregate is off, so choosing profiles
    // turns the stock Universal Inbox on instead of saving a dead preference.
    if (value && !readUniversalInbox()) setUniversalInbox(true)
    close()
  })
  footer.append(cancel, save)
  panel.append(footer)
  overlay.append(panel)
  overlay.addEventListener('click', event => { if (event.target === overlay) close() })
  doc.addEventListener('keydown', function onKey(event) {
    if (event.key === 'Escape') { close(); doc.removeEventListener('keydown', onKey) }
  })
  doc.body.append(overlay)
}

function inboxProfileAppearance(route, agent) {
  const name = route.profile.trim(), label = agent?.profileMetadata?.display_name?.trim() || route.profile
  let color = typeof profileColor === 'function' ? profileColor(name) : null
  // Approved compatibility seam: read only this native, credential-free key.
  // Never patch the storage/store; normal projection and storage events reread it.
  if (name && name !== 'default') try {
    const overrides = JSON.parse(window.localStorage.getItem('hermes.desktop.profileColors') || '{}')
    const value = Object.hasOwn(overrides || {}, name) ? overrides[name] : null
    if (typeof value === 'string' && value.length <= 128 && window.CSS.supports('color', value) && !/var\(|url\(/i.test(value)) color = value
  } catch { /* Public deterministic native color remains the fallback. */ }
  const segments = new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(label.trim())
  const letter = [...segments].map(part => part.segment).find(part => /[\p{L}\p{N}\p{Extended_Pictographic}\p{Regional_Indicator}]/u.test(part)) || '?'
  return { name, label, letter, color, background: color && typeof profileColorSoft === 'function' ? profileColorSoft(color, 22) : null }
}

function codexInboxReadLimiter(limit = 4) {
  let running = 0
  const queue = []
  const drain = () => {
    while (running < limit && queue.length) {
      const item = queue.shift()
      item.signal?.removeEventListener('abort', item.abort)
      if (item.signal?.aborted) { item.reject(new Error('Inbox read cancelled')); continue }
      running++
      let released = false
      item.resolve(() => { if (!released) { released = true; running--; drain() } })
    }
  }
  return signal => new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new Error('Inbox read cancelled')); return }
    const item = { signal, resolve, reject, abort: () => {
      const index = queue.indexOf(item)
      if (index >= 0) queue.splice(index, 1)
      reject(new Error('Inbox read cancelled'))
    } }
    queue.push(item); signal?.addEventListener('abort', item.abort, { once: true }); drain()
  })
}

async function readUniversalInboxInventory() {
  if (!host.profileRoutes || !window.hermesDesktop?.getAgentRoster) throw new Error('Universal Inbox requires exact profile routes and roster')
  const [routes, roster] = await Promise.all([host.profileRoutes(), window.hermesDesktop.getAgentRoster()])
  if (!Array.isArray(routes) || !Array.isArray(roster?.agents) || !Array.isArray(roster?.sources) || !roster.sources.length) throw new Error('Incomplete Inbox inventory')
  const sources = new Map(roster.sources.map(source => [source.connectionId, source]))
  const routeCounts = new Map()
  for (const route of routes) {
    const key = JSON.stringify([route?.connectionId, route?.profile])
    routeCounts.set(key, (routeCounts.get(key) || 0) + 1)
  }
  // Local fork: the profile selection narrows the inventory, so proof is kept
  // for the selected profiles only. A hidden profile can never make the Inbox
  // "incomplete" and keep stale rows alive.
  const permitted = codexInboxProfileFilter()
  const permittedProfile = profile => !permitted || (typeof profile === 'string' && permitted.has(profile))
  const usedSources = new Set()
  const available = [], seen = new Set(), backendAliases = new Map()
  let complete = true
  for (const route of routes) {
    if (!permittedProfile(route?.profile)) continue
    usedSources.add(route?.connectionId)
    if (!route || !['connectionId', 'profile', 'targetProfile'].every(field => typeof route[field] === 'string' && route[field] && route[field] !== '*') || route.profile === 'all' || route.targetProfile === 'all' || !['local', 'remote'].includes(route.mode)) { complete = false; continue }
    const key = JSON.stringify([route.connectionId, route.profile])
    const agents = roster.agents.filter(agent => sameInboxScope(agent, route) && (!agent.targetProfile || agent.targetProfile === route.targetProfile))
    const source = sources.get(route.connectionId)
    if (routeCounts.get(key) !== 1 || agents.length !== 1 || source?.reachable !== true || source.error || source.needsSignIn) { complete = false; continue }
    seen.add(key)
    const backendKey = JSON.stringify([route.connectionId, route.targetProfile])
    backendAliases.set(backendKey, (backendAliases.get(backendKey) || 0) + 1)
    available.push({ key, route: { ...route }, agent: agents[0], backendKey })
  }
  if (roster.sources.some(source => usedSources.has(source.connectionId) && (source.reachable !== true || source.error || source.needsSignIn))) complete = false
  if (roster.agents.some(agent => permittedProfile(agent.profile) && !seen.has(JSON.stringify([agent.connectionId, agent.profile])))) complete = false
  const verified = available.filter(item => {
    if (backendAliases.get(item.backendKey) === 1) return true
    complete = false; return false
  })
  return { complete, routes: verified, sources: roster.sources, ambiguous: !complete }
}

function startUniversalInboxObserver(ctx, inbox, acquire = codexInboxReadLimiter(4)) {
  let disposed = false
  const owners = new Map(), liveOwners = new Map(), stamp = Symbol('Universal inventory')
  let projectionQueued = false
  const onOwnersChanged = () => {
    if (projectionQueued || disposed) return
    projectionQueued = true
    queueMicrotask(() => {
      projectionQueued = false
      if (!disposed) for (const item of owners.values()) if (item.active) item.proxy?.reproject?.()
    })
  }
  const publish = () => {
    if (disposed) return
    inbox.updateOwners([...owners.values()].filter(item => item.snapshot).map(item => {
      const appearance = inboxProfileAppearance(item.route, item.agent), previous = item.published
      // Only this owner's new projection/availability/appearance invalidates its
      // published reference. An unrelated owner's progress must not clone it.
      if (!previous || item.publishedSource !== item.snapshot || previous.routeAvailable !== item.active ||
          Object.keys(appearance).some(key => appearance[key] !== previous.appearance[key])) {
        item.publishedSource = item.snapshot
        item.published = { ...item.snapshot, scope: item.route, route: item.route, appearance,
          routeAvailable: item.active, ownerGeneration: item.generation }
      }
      return item.published
    }))
  }
  const retire = (item, remove = false) => {
    item.active = false; item.stop?.(); item.stop = null
    for (const [key, proof] of liveOwners) if (sameInboxScope(proof, item.route) && !proof.conflicted) liveOwners.delete(key)
    onOwnersChanged()
    if (remove) owners.delete(item.key)
    else if (item.snapshot) item.snapshot = { ...item.snapshot, liveSessions: [], childSnapshots: [], busyBySession: {}, liveStatusKnown: false, error: 'Owner inventory unavailable' }
  }
  const reconcile = () => {
    if (disposed) return

    const query = observer.getCurrentResult(), data = query.data
    if (query.error || data?.stamp !== stamp) {
      if (query.error) for (const item of owners.values()) retire(item)
      publish(); return
    }
    const present = new Set(data.routes.map(item => item.key))
    for (const item of owners.values()) if (!present.has(item.key)) retire(item, data.complete && !data.ambiguous)
    for (const discovered of data.routes) {
      let item = owners.get(discovered.key)
      if (item && JSON.stringify(item.route) !== JSON.stringify(discovered.route)) { retire(item, true); item = null }
      if (!item) { item = { ...discovered, generation: Symbol('Universal owner'), active: true, snapshot: null }; owners.set(item.key, item) }
      item.agent = discovered.agent
      if (item.stop) continue
      item.active = true
      const localDisposals = []
      const proxy = { model: inbox.model, admission: inbox.admission, setMode() {},
        activity: event => item.active && !disposed && owners.get(item.key) === item && inbox.activity({ ...event, scope: { ...item.route, _codexInboxGeneration: item.generation } }),
        update: snapshot => {
          if (disposed || !item.active || owners.get(item.key) !== item) return
          seedCodexInboxOwner(inbox, item.route, snapshot)
          item.snapshot = snapshot; publish()
        }
      }
      item.proxy = proxy
      startCodexInboxObserver({ onDispose: fn => localDisposals.push(fn) }, proxy, {
        ownerScope: () => item.active && !disposed ? item.route : null,
        mode: () => item.active && !disposed && readUniversalInbox() ? readCodexInboxMode() : 'off',
        queryKey: ['universal', item.route.targetProfile, item.route.mode], acquire, liveOwners, onOwnersChanged,
        liveAvailable: () => !host.state.gateway?.get || host.state.gateway.get() === 'open'
      })
      item.stop = () => localDisposals.reverse().forEach(fn => fn())
    }
    publish()
  }
  const observer = new CodexInboxObserverVendor.QueryObserver(queryClient, {
    queryKey: [ID, 'universal-inbox-inventory'],
    queryFn: async () => ({ ...await readUniversalInboxInventory(), stamp }),
    staleTime: 0, refetchInterval: 10_000, retry: 1
  })
  const resolve = event => {
    const item = owners.get(JSON.stringify([event.connectionId, event.profile]))
    const resolved = item?.active && item.proxy?.resolveLiveEvent?.(event)
    return resolved ? { ...resolved, scope: { ...item.route, _codexInboxGeneration: item.generation } } : null
  }
  inbox.resolveLiveEvent = resolve
  const stopQuery = observer.subscribe(reconcile)
  const storageChanged = event => { if (!event.key || event.key === 'hermes.desktop.profileColors') publish() }
  window.addEventListener('storage', storageChanged)
  // Local fork: a new profile selection re-reads the inventory, which retires
  // the owners that fell out of it and starts the ones that joined.
  const profilesChanged = () => { if (!disposed) void observer.refetch() }
  window.addEventListener(INBOX_PROFILES_EVENT, profilesChanged)
  const stopGateway = host.state.gateway?.subscribe?.(() => {
    // The selected socket is not the availability of independent HTTP owners.
    // Per-owner observers revoke live proof; metadata remains roster-routed.
    liveOwners.clear()
    onOwnersChanged()
    void observer.refetch()
  })
  reconcile()
  const stop = () => {
    if (disposed) return
    disposed = true; stopQuery(); observer.destroy(); stopGateway?.()
    window.removeEventListener('storage', storageChanged)
    window.removeEventListener(INBOX_PROFILES_EVENT, profilesChanged)
    for (const item of owners.values()) retire(item)
    owners.clear()
    if (inbox.resolveLiveEvent === resolve) delete inbox.resolveLiveEvent
  }
  ctx.onDispose(stop)
  return stop
}

function startCodexInboxService(ctx, inbox) {
  if (!inbox) return () => {}
  // Keep the bound across retired generations whose native IPC cannot abort.
  const acquire = codexInboxReadLimiter(4)
  let disposed = false, signature = null, disposals = []
  const configure = () => {
    if (disposed) return
    const next = JSON.stringify([readUniversalInbox(), readUniversalInbox() ? readCodexInboxMode() : null])
    if (signature === next) return
    signature = next; disposals.reverse().forEach(fn => fn()); disposals = []
    const local = { onDispose: fn => disposals.push(fn) }
    inbox.resetOwners?.()
    inbox.setMode(readCodexInboxMode() === 'on')
    if (readUniversalInbox() && readCodexInboxMode() === 'on') startUniversalInboxObserver(local, inbox, acquire)
    else startCodexInboxObserver(local, inbox)
  }
  window.addEventListener(UNIVERSAL_INBOX_EVENT, configure)
  window.addEventListener(INBOX_MODE_EVENT, configure)
  configure()
  const stop = () => {
    if (disposed) return
    disposed = true; disposals.reverse().forEach(fn => fn()); disposals = []
    window.removeEventListener(UNIVERSAL_INBOX_EVENT, configure); window.removeEventListener(INBOX_MODE_EVENT, configure)
  }
  ctx.onDispose(stop)
  return stop
}
