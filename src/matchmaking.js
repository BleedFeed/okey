import { state } from './state.js'
import { resetClientToMatchmaker } from './network.js'

const STATUS_LABELS = Object.freeze({
  waiting: 'LOBİ',
  playing: 'OYUNDA',
  'round-ended': 'TUR SONU',
  'match-ended': 'MAÇ BİTTİ',
})

function addStyles() {
  if (document.getElementById('okey-matchmaking-styles')) return
  const style = document.createElement('style')
  style.id = 'okey-matchmaking-styles'
  style.textContent = `
    #okey-matchmaker {
      position: fixed;
      inset: 0;
      z-index: 240;
      display: grid;
      place-items: center;
      padding: 24px;
      background:
        radial-gradient(circle at 50% 18%, rgba(80, 132, 91, .16), transparent 38%),
        linear-gradient(180deg, rgba(7, 12, 10, .84), rgba(6, 9, 8, .94));
      backdrop-filter: blur(9px);
      font-family: "Segoe UI", system-ui, sans-serif;
      color: rgba(255,255,255,.94);
    }
    #okey-matchmaker[hidden] { display: none !important; }
    .okey-mm-shell {
      width: min(760px, 100%);
      max-height: min(760px, calc(100vh - 48px));
      display: flex;
      flex-direction: column;
      overflow: hidden;
      border: 1px solid rgba(223, 193, 108, .25);
      border-radius: 24px;
      background: linear-gradient(180deg, rgba(24, 32, 28, .96), rgba(13, 19, 16, .96));
      box-shadow: 0 28px 90px rgba(0,0,0,.48), inset 0 1px rgba(255,255,255,.05);
    }
    .okey-mm-head {
      padding: 25px 28px 18px;
      border-bottom: 1px solid rgba(255,255,255,.07);
      background: linear-gradient(180deg, rgba(255,255,255,.025), transparent);
    }
    .okey-mm-kicker {
      color: #d7bb6a;
      font-size: 11px;
      font-weight: 900;
      letter-spacing: .24em;
    }
    .okey-mm-title {
      margin: 5px 0 2px;
      font-size: clamp(24px, 5vw, 38px);
      line-height: 1;
      font-weight: 900;
      letter-spacing: -.03em;
    }
    .okey-mm-subtitle { color: rgba(255,255,255,.55); font-size: 13px; }
    .okey-mm-toolbar {
      display: flex;
      gap: 10px;
      align-items: center;
      padding: 14px 18px;
      border-bottom: 1px solid rgba(255,255,255,.06);
    }
    .okey-mm-status { flex: 1; min-width: 0; color: rgba(255,255,255,.62); font-size: 12px; }
    .okey-mm-btn {
      appearance: none;
      border: 1px solid rgba(255,255,255,.13);
      border-radius: 12px;
      padding: 10px 14px;
      color: white;
      background: rgba(255,255,255,.06);
      font: 800 12px/1 "Segoe UI", system-ui, sans-serif;
      letter-spacing: .035em;
      cursor: pointer;
      transition: transform 120ms ease, background 120ms ease, border-color 120ms ease, opacity 120ms ease;
    }
    .okey-mm-btn:hover:not(:disabled) { transform: translateY(-1px); background: rgba(255,255,255,.1); }
    .okey-mm-btn:disabled { opacity: .42; cursor: default; }
    .okey-mm-btn.primary {
      border-color: rgba(113, 190, 128, .38);
      background: linear-gradient(180deg, rgba(66, 139, 82, .95), rgba(43, 103, 57, .95));
      box-shadow: 0 7px 20px rgba(21, 76, 35, .22);
    }
    .okey-mm-list {
      overflow: auto;
      padding: 14px 18px 20px;
      min-height: 210px;
    }
    .okey-mm-empty {
      display: grid;
      place-items: center;
      min-height: 220px;
      text-align: center;
      color: rgba(255,255,255,.43);
      font-size: 14px;
    }
    .okey-mm-card {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto auto;
      gap: 14px;
      align-items: center;
      padding: 14px 14px 14px 17px;
      margin-bottom: 9px;
      border: 1px solid rgba(255,255,255,.075);
      border-radius: 15px;
      background: rgba(255,255,255,.035);
    }
    .okey-mm-card-name { font-size: 15px; font-weight: 850; }
    .okey-mm-card-meta { margin-top: 4px; color: rgba(255,255,255,.45); font-size: 11px; }
    .okey-mm-pill {
      padding: 5px 8px;
      border: 1px solid rgba(255,255,255,.09);
      border-radius: 999px;
      color: rgba(255,255,255,.67);
      background: rgba(0,0,0,.15);
      font-size: 10px;
      font-weight: 900;
      letter-spacing: .07em;
      white-space: nowrap;
    }
    .okey-mm-pill.joinable { color: #a8dfb3; border-color: rgba(91, 177, 108, .28); }
    #okey-back-to-tables {
      position: fixed;
      top: 72px;
      left: 16px;
      z-index: 156;
      display: none;
      border: 1px solid rgba(223,193,108,.24);
      border-radius: 999px;
      padding: 8px 11px;
      color: rgba(255,255,255,.88);
      background: rgba(13, 19, 16, .78);
      backdrop-filter: blur(8px);
      box-shadow: 0 5px 18px rgba(0,0,0,.22);
      font: 800 11px/1 "Segoe UI", system-ui, sans-serif;
      cursor: pointer;
    }
    #okey-back-to-tables.visible { display: block; }
    @media (max-width: 620px) {
      #okey-matchmaker { padding: 10px; }
      .okey-mm-shell { max-height: calc(100vh - 20px); border-radius: 18px; }
      .okey-mm-head { padding: 20px 18px 15px; }
      .okey-mm-toolbar { align-items: stretch; flex-wrap: wrap; }
      .okey-mm-status { flex-basis: 100%; }
      .okey-mm-card { grid-template-columns: minmax(0,1fr) auto; }
      .okey-mm-card .okey-mm-btn { grid-column: 1 / -1; width: 100%; }
    }
  `
  document.head.appendChild(style)
}

export function setupMatchmaking(socket, setMessage) {
  addStyles()

  const overlay = document.createElement('div')
  overlay.id = 'okey-matchmaker'
  overlay.innerHTML = `
    <section class="okey-mm-shell" aria-label="Okey masaları">
      <header class="okey-mm-head">
        <div class="okey-mm-kicker">SALON 101</div>
        <h1 class="okey-mm-title">Oyun Masaları</h1>
        <div class="okey-mm-subtitle">Bir masaya katıl veya yeni bir masa aç.</div>
      </header>
      <div class="okey-mm-toolbar">
        <div class="okey-mm-status" data-mm-status>Sunucuya bağlanıyor…</div>
        <button class="okey-mm-btn" data-mm-refresh type="button">YENİLE</button>
        <button class="okey-mm-btn primary" data-mm-create type="button">YENİ MASA AÇ</button>
      </div>
      <div class="okey-mm-list" data-mm-list></div>
    </section>
  `
  document.body.appendChild(overlay)

  const backButton = document.createElement('button')
  backButton.id = 'okey-back-to-tables'
  backButton.type = 'button'
  backButton.textContent = 'MASALARA DÖN'
  document.body.appendChild(backButton)

  const listEl = overlay.querySelector('[data-mm-list]')
  const statusEl = overlay.querySelector('[data-mm-status]')
  const createButton = overlay.querySelector('[data-mm-create]')
  const refreshButton = overlay.querySelector('[data-mm-refresh]')

  let pendingAction = false
  let reconnectForBrowser = false

  function syncBackButtonPosition() {
    const gameHud = document.getElementById('game-hud')
    if (!gameHud) {
      backButton.style.top = window.innerWidth <= 640 ? '65px' : '72px'
      backButton.style.left = window.innerWidth <= 640 ? '10px' : '16px'
      return
    }

    const hudRect = gameHud.getBoundingClientRect()
    const gap = 10
    backButton.style.top = `${Math.round(hudRect.bottom + gap)}px`
    backButton.style.left = `${Math.round(hudRect.left)}px`
  }

  const gameHud = document.getElementById('game-hud')
  const hudResizeObserver = gameHud && typeof ResizeObserver === 'function'
    ? new ResizeObserver(syncBackButtonPosition)
    : null
  hudResizeObserver?.observe(gameHud)
  window.addEventListener('resize', syncBackButtonPosition)
  syncBackButtonPosition()

  function setPending(value, text = null) {
    pendingAction = Boolean(value)
    createButton.disabled = pendingAction || !socket.connected
    refreshButton.disabled = pendingAction || !socket.connected
    if (text) statusEl.textContent = text
    renderTables()
  }

  function showBrowser(message = null) {
    state.matchmakingMode = true
    overlay.hidden = false
    if (message) statusEl.textContent = message
    updateBackButton()
  }

  function hideBrowser() {
    state.matchmakingMode = false
    overlay.hidden = true
    updateBackButton()
  }

  function updateBackButton() {
    syncBackButtonPosition()
    const canLeave = Boolean(
      state.currentTableId &&
      (!state.publicGameState || state.publicGameState.phase === 'waiting') &&
      !state.matchmakingMode
    )
    backButton.classList.toggle('visible', canLeave)
    backButton.textContent = state.currentTableId
      ? `MASALARA DÖN · ${state.currentTableId}`
      : 'MASALARA DÖN'
  }

  function renderTables() {
    const tables = Array.isArray(state.tableList) ? state.tableList : []
    listEl.replaceChildren()

    if (tables.length === 0) {
      const empty = document.createElement('div')
      empty.className = 'okey-mm-empty'
      empty.innerHTML = '<div><strong>Henüz açık masa yok.</strong><br>İlk masayı sen açabilirsin.</div>'
      listEl.appendChild(empty)
      return
    }

    for (const table of tables) {
      const card = document.createElement('article')
      card.className = 'okey-mm-card'

      const info = document.createElement('div')
      const botText = table.botCount > 0 ? ` · ${table.botCount} bot` : ''
      info.innerHTML = `
        <div class="okey-mm-card-name"></div>
        <div class="okey-mm-card-meta"></div>
      `
      info.querySelector('.okey-mm-card-name').textContent = table.name || `Masa ${table.id}`
      info.querySelector('.okey-mm-card-meta').textContent = `${table.playerCount}/4 oyuncu${botText}`

      const pill = document.createElement('div')
      pill.className = `okey-mm-pill${table.joinable ? ' joinable' : ''}`
      pill.textContent = STATUS_LABELS[table.phase] || String(table.phase || '').toUpperCase()

      const button = document.createElement('button')
      button.type = 'button'
      button.className = `okey-mm-btn${table.joinable ? ' primary' : ''}`
      button.disabled = pendingAction || !table.joinable || !socket.connected
      button.textContent = table.joinable ? 'MASAYA KATIL' : (table.playerCount >= 4 ? 'DOLU' : 'OYUNDA')
      button.addEventListener('click', () => joinTable(table.id))

      card.append(info, pill, button)
      listEl.appendChild(card)
    }
  }

  function requestTables() {
    if (!socket.connected || pendingAction) return
    statusEl.textContent = 'Masalar yenileniyor…'
    socket.emit('request-table-list', result => {
      if (result?.ok && Array.isArray(result.tables)) {
        state.tableList = result.tables
        statusEl.textContent = `${result.tables.length} masa bulundu.`
        renderTables()
      }
      else {
        statusEl.textContent = 'Masa listesi alınamadı.'
      }
    })
  }

  function joinTable(tableId) {
    if (pendingAction || !socket.connected) return
    setPending(true, 'Masaya katılınıyor…')
    socket.emit('join-table', tableId, result => {
      if (result?.ok) {
        state.currentTableId = String(result.table?.id || tableId)
        statusEl.textContent = 'Masaya katıldın.'
        // `you-joined` authoritative seat event hides the browser.
        return
      }
      setPending(false, result?.message || 'Masaya katılınamadı.')
      requestTables()
    })
  }

  createButton.addEventListener('click', () => {
    if (pendingAction || !socket.connected) return
    setPending(true, 'Yeni masa hazırlanıyor…')
    socket.emit('create-table', result => {
      if (result?.ok) {
        state.currentTableId = String(result.table?.id || '') || state.currentTableId
        statusEl.textContent = 'Masa hazır.'
        return
      }
      setPending(false, result?.message || 'Yeni masa açılamadı.')
    })
  })

  refreshButton.addEventListener('click', requestTables)

  backButton.addEventListener('click', () => {
    if (
      pendingAction ||
      (state.publicGameState && state.publicGameState.phase !== 'waiting')
    ) return

    const approved = window.confirm('Bu masadan çıkıp masa listesine dönmek istiyor musun?')
    if (!approved) return

    pendingAction = true
    reconnectForBrowser = true
    state.returningToMatchmaker = true
    backButton.disabled = true

    socket.emit('leave-table', result => {
      if (!result?.ok) {
        pendingAction = false
        reconnectForBrowser = false
        state.returningToMatchmaker = false
        backButton.disabled = false
        setMessage(result?.message || 'Masadan çıkılamadı.')
      }
      // Successful path intentionally waits for the server disconnect; this
      // guarantees all table-specific server listeners and room membership die.
    })
  })

  socket.on('table-list', tables => {
    state.tableList = Array.isArray(tables) ? tables : []
    if (state.matchmakingMode) {
      statusEl.textContent = socket.connected
        ? `${state.tableList.length} masa bulundu.`
        : 'Bağlantı bekleniyor…'
      renderTables()
    }
  })

  socket.on('you-joined', player => {
    state.currentTableId = String(player?.tableId || state.currentTableId || '') || null
    pendingAction = false
    reconnectForBrowser = false
    state.returningToMatchmaker = false
    backButton.disabled = false
    hideBrowser()
    updateBackButton()
  })

  socket.on('game-state', updateBackButton)

  socket.on('connect', () => {
    createButton.disabled = false
    refreshButton.disabled = false
    if (!state.currentTableId) {
      showBrowser('Masalar yükleniyor…')
      requestTables()
    }
  })

  socket.on('disconnect', reason => {
    const wasInTable = Boolean(state.currentTableId)
    if (wasInTable || reconnectForBrowser) {
      resetClientToMatchmaker()
    }

    pendingAction = false
    backButton.disabled = false
    showBrowser('Sunucu bağlantısı yeniden kuruluyor…')
    renderTables()

    // Server-initiated disconnect (used for explicit table leave) disables
    // Socket.IO's automatic reconnect. Other network failures auto-reconnect.
    if (reason === 'io server disconnect') {
      window.setTimeout(() => socket.connect(), 80)
    }
  })

  window.addEventListener('okey:matchmaker-reset', () => {
    showBrowser('Masalar yükleniyor…')
    updateBackButton()
  })

  // Initial state before the socket's first connection resolves.
  showBrowser('Sunucuya bağlanıyor…')
  renderTables()

  return {
    showBrowser,
    hideBrowser,
    requestTables,
  }
}
