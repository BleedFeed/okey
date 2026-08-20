import { state } from './state.js'

const MOBILE_SHORT_EDGE_MAX = 1024

// Touch drag'in "gecikiyor" hissinin ana nedenlerinden biri 8px'lik eski
// mobile slop'tu. Parmağın doğal mikro hareketini hâlâ filtreliyoruz ama drag
// artık ilk gerçek harekette hemen tepki veriyor.
const TOUCH_DRAG_SLOP_PX = 2.5
const TOUCH_JOKER_CLICK_SLOP_PX = 14
const TOUCH_JOKER_DOUBLE_DISTANCE_PX = 44

// Telefonlarda WebGL canvas + HUD compositing maliyetini düşük tut. Masaüstü
// aynen 2 DPR üst sınırını kullanmaya devam eder.
const MOBILE_RENDER_DPR_MAX = 1.25

let mobileRoot = null
let cameraControls = null
let openingCameraButton = null
let discardHint = null
let lastOrientationKey = ''
let stylesInstalled = false
let cachedTouchLayout = null
let lastMobilePhaseKey = ''

function getScreenShortEdge() {
  const screenWidth = Number(window.screen?.width) || window.innerWidth
  const screenHeight = Number(window.screen?.height) || window.innerHeight
  return Math.min(screenWidth, screenHeight)
}

function computeTouchLayout() {
  const coarse = window.matchMedia?.('(pointer: coarse)')?.matches === true
  const hasTouch = Number(navigator.maxTouchPoints || 0) > 0

  if (!coarse || !hasTouch) return false
  return getScreenShortEdge() <= MOBILE_SHORT_EDGE_MAX
}

export function isTouchLayout() {
  // Pointermove sırasında matchMedia/screen sorgusunu tekrar tekrar yapmak
  // gereksiz. Resize/orientation geldiğinde cache updateLayoutClass ile yenilenir.
  return cachedTouchLayout ?? computeTouchLayout()
}

export function isTouchPointerEvent(event) {
  return Boolean(event && event.pointerType === 'touch')
}

export function getPointerMoveThreshold(event, desktopValue) {
  return isTouchPointerEvent(event)
    ? TOUCH_DRAG_SLOP_PX
    : desktopValue
}

export function getJokerClickMoveTolerance(event, desktopValue) {
  return isTouchPointerEvent(event)
    ? TOUCH_JOKER_CLICK_SLOP_PX
    : desktopValue
}

export function getJokerDoubleClickDistance(event, desktopValue) {
  return isTouchPointerEvent(event)
    ? TOUCH_JOKER_DOUBLE_DISTANCE_PX
    : desktopValue
}

export function getRendererPixelRatio() {
  const ratio = Math.max(1, Number(window.devicePixelRatio) || 1)
  return Math.min(ratio, isTouchLayout() ? MOBILE_RENDER_DPR_MAX : 2)
}

export function getVisualViewportSize() {
  const viewport = window.visualViewport

  return {
    width: Math.max(1, Number(viewport?.width) || window.innerWidth),
    height: Math.max(1, Number(viewport?.height) || window.innerHeight),
    offsetLeft: Number(viewport?.offsetLeft) || 0,
    offsetTop: Number(viewport?.offsetTop) || 0,
  }
}

export function isMobileDiscardDropPoint(clientX, clientY) {
  if (!isTouchLayout()) return false

  const viewport = getVisualViewportSize()
  const zoneWidth = Math.min(96, Math.max(68, viewport.width * 0.16))
  const safeBottom = 82
  const top = Math.max(128, viewport.height * 0.31)
  const bottom = Math.max(top + 76, viewport.height - safeBottom)

  return (
    clientX >= viewport.offsetLeft + viewport.width - zoneWidth &&
    clientY >= viewport.offsetTop + top &&
    clientY <= viewport.offsetTop + bottom
  )
}

function installStyles() {
  if (stylesInstalled) return
  stylesInstalled = true

  const style = document.createElement('style')
  style.id = 'okey-mobile-gameplay-style'
  style.textContent = `
    .okey-touch-ui {
      --okey-safe-top: env(safe-area-inset-top, 0px);
      --okey-safe-right: env(safe-area-inset-right, 0px);
      --okey-safe-bottom: env(safe-area-inset-bottom, 0px);
      --okey-safe-left: env(safe-area-inset-left, 0px);
      --okey-visible-height: 100dvh;
      --okey-keyboard-inset: 0px;
      --okey-mobile-panel: rgba(10, 16, 15, 0.92);
      --okey-mobile-panel-strong: rgba(8, 13, 12, 0.965);
      --okey-mobile-line: rgba(235, 240, 238, 0.13);
      --okey-mobile-text: rgba(247, 249, 248, 0.94);
    }

    .okey-touch-ui body,
    .okey-touch-ui canvas {
      overscroll-behavior: none;
    }

    .okey-touch-ui canvas {
      touch-action: none;
      -webkit-user-select: none;
      user-select: none;
      -webkit-touch-callout: none;
    }

    /* Telefon GPU'sunda canvas üstü blur katmanları drag FPS'ini ciddi
       düşürebiliyor. Mobilde temayı koruyup pahalı blur compositing'i kapat. */
    .okey-touch-ui #game-hud,
    .okey-touch-ui #social-panel,
    .okey-touch-ui #okey-mobile-gameplay-controls,
    .okey-touch-ui #opened-board-inspector-panel,
    .okey-touch-ui .okey-mm-shell {
      backdrop-filter: none !important;
      -webkit-backdrop-filter: none !important;
    }

    .okey-touch-ui #game-hud,
    .okey-touch-ui #social-panel,
    .okey-touch-ui #score-notebook,
    .okey-touch-ui #opened-board-inspector-panel {
      transition: none !important;
    }

    /* Kamera kontrolleri rack'in altında/üstünde yatay bir şerit olarak yer
       kaplamasın. Sol kenarda küçük bir dikey kontrol rayı. */
    #okey-mobile-gameplay-controls {
      position: fixed;
      left: calc(8px + var(--okey-safe-left, 0px));
      top: 52%;
      z-index: 152;
      display: none;
      grid-template-columns: 1fr;
      gap: 4px;
      width: 58px;
      padding: 4px;
      box-sizing: border-box;
      transform: translateY(-50%);
      border: 1px solid var(--okey-mobile-line);
      border-radius: 11px;
      background: rgba(8, 14, 13, 0.88);
      box-shadow: 0 6px 18px rgba(0,0,0,0.22);
      pointer-events: auto;
    }

    .okey-touch-ui #okey-mobile-gameplay-controls.visible {
      display: grid;
    }

    .okey-touch-ui.okey-mobile-keyboard-open #okey-mobile-gameplay-controls,
    .okey-touch-ui.okey-mobile-keyboard-open #okey-mobile-discard-hint {
      display: none !important;
    }

    #okey-mobile-gameplay-controls button {
      width: 48px;
      min-width: 48px;
      height: 39px;
      min-height: 39px;
      padding: 0 3px;
      border: 1px solid rgba(255,255,255,0.10);
      border-radius: 8px;
      background: rgba(255,255,255,0.055);
      color: var(--okey-mobile-text);
      box-shadow: none;
      font: 850 8.5px/1 "Segoe UI", Tahoma, sans-serif;
      letter-spacing: .015em;
      touch-action: manipulation;
    }

    #okey-mobile-gameplay-controls button:active:not(:disabled) {
      background: rgba(255,255,255,0.13);
    }

    #okey-mobile-gameplay-controls button:disabled {
      opacity: .30;
    }

    #okey-mobile-discard-hint {
      position: fixed;
      right: calc(7px + var(--okey-safe-right, 0px));
      top: 49%;
      z-index: 151;
      width: 66px;
      height: 88px;
      display: none;
      place-items: center;
      box-sizing: border-box;
      transform: translateY(-50%);
      border: 2px dashed rgba(255,219,123,.72);
      border-radius: 13px;
      background: rgba(20, 35, 28, .72);
      color: #ffe096;
      box-shadow: 0 6px 18px rgba(0,0,0,.20);
      font: 900 12px/1 "Segoe UI", sans-serif;
      letter-spacing: .10em;
      pointer-events: none;
      opacity: .92;
    }

    .okey-touch-ui #okey-mobile-discard-hint.visible {
      display: grid;
    }

    /* Ana HUD: oyun sırasında küçük bir durum kapsülü, açıldığında ise
       okunabilir ama ekranı kaplamayan kompakt panel. */
    .okey-touch-ui #game-hud {
      top: calc(7px + var(--okey-safe-top, 0px)) !important;
      left: calc(7px + var(--okey-safe-left, 0px)) !important;
      width: min(248px, calc(100vw - 14px - var(--okey-safe-left, 0px) - var(--okey-safe-right, 0px))) !important;
      border-radius: 11px !important;
      background: var(--okey-mobile-panel) !important;
      box-shadow: 0 6px 18px rgba(0,0,0,.24), inset 0 1px 0 rgba(255,255,255,.035) !important;
    }

    .okey-touch-ui.okey-mobile-playing #game-hud.is-collapsed {
      width: min(178px, calc(100vw - 138px)) !important;
    }

    .okey-touch-ui #hud-panel-toggle {
      min-height: 40px !important;
      padding: 7px 8px 7px 10px !important;
      border-radius: 10px !important;
      background: rgba(255,255,255,.018) !important;
    }

    .okey-touch-ui .hud-panel-title {
      font-size: 10px !important;
      letter-spacing: .09em !important;
    }

    .okey-touch-ui #hud-panel-summary {
      max-width: 86px !important;
      font-size: 8px !important;
      letter-spacing: .035em !important;
    }

    .okey-touch-ui .hud-panel-chevron {
      width: 24px !important;
      height: 24px !important;
      flex-basis: 24px !important;
    }

    .okey-touch-ui #game-hud #control-hint {
      display: none !important;
    }

    .okey-touch-ui #hud-panel-content-inner {
      max-height: min(40dvh, calc(var(--okey-visible-height, 100dvh) - 72px)) !important;
      padding: 6px 7px 8px !important;
      overflow-y: auto;
      overscroll-behavior: contain;
      -webkit-overflow-scrolling: touch;
    }

    .okey-touch-ui #game-hud button:not(#hud-panel-toggle),
    .okey-touch-ui #game-hud select {
      min-height: 38px !important;
      font-size: 10px !important;
    }

    /* Chat oyun alanının altını/rack'i kapatmasın. Kapalı düğme sağ üstte,
       panel açıldığında da ekranın üst yarısında kalır. */
    .okey-touch-ui #social-panel {
      top: calc(58px + var(--okey-safe-top, 0px)) !important;
      right: calc(7px + var(--okey-safe-right, 0px)) !important;
      bottom: auto !important;
      width: min(300px, calc(100vw - 14px - var(--okey-safe-left, 0px) - var(--okey-safe-right, 0px))) !important;
      max-height: min(44dvh, calc(var(--okey-visible-height, 100dvh) - 74px)) !important;
      padding: 7px !important;
      border-radius: 11px !important;
      background: var(--okey-mobile-panel-strong) !important;
      overflow: hidden;
    }

    .okey-touch-ui #social-panel #chat-log {
      max-height: min(18dvh, 118px) !important;
    }

    .okey-touch-ui.okey-mobile-keyboard-open #social-panel {
      top: calc(7px + var(--okey-safe-top, 0px)) !important;
      bottom: auto !important;
      max-height: calc(var(--okey-visible-height, 100dvh) - 14px) !important;
    }

    .okey-touch-ui #social-panel button,
    .okey-touch-ui #chat-input,
    .okey-touch-ui #chat-send-button {
      min-height: 38px !important;
    }

    .okey-touch-ui #chat-dock-button {
      top: calc(58px + var(--okey-safe-top, 0px)) !important;
      right: calc(7px + var(--okey-safe-right, 0px)) !important;
      bottom: auto !important;
      width: 42px !important;
      min-width: 42px !important;
      height: 42px !important;
      min-height: 42px !important;
      border-radius: 11px !important;
      background: rgba(8,14,13,.90) !important;
      backdrop-filter: none !important;
      -webkit-backdrop-filter: none !important;
    }

    .okey-touch-ui #okey-back-to-tables {
      min-height: 40px;
      padding-inline: 12px;
      touch-action: manipulation;
    }

    /* Üst satır: solda oyun HUD'u, sağda puan. Açılan taşlar ikinci satırda
       ortalanır; böylece üç HUD birbirinin üzerine binmez. */
    .okey-touch-ui #opened-board-inspector-toggle {
      top: calc(57px + var(--okey-safe-top, 0px)) !important;
      min-height: 38px !important;
      padding: 0 10px !important;
      border-radius: 9px !important;
      background: rgba(8,14,13,.90) !important;
      box-shadow: 0 5px 14px rgba(0,0,0,.20) !important;
      font-size: 9px !important;
      touch-action: manipulation;
    }

    .okey-touch-ui #opened-board-inspector-panel {
      top: calc(101px + var(--okey-safe-top, 0px)) !important;
      max-width: calc(100vw - 12px - var(--okey-safe-left, 0px) - var(--okey-safe-right, 0px)) !important;
      background: rgba(6,10,9,.88) !important;
      box-shadow: 0 8px 22px rgba(0,0,0,.25) !important;
    }

    .okey-touch-ui #opened-board-mobile-tabs button,
    .okey-touch-ui #opened-board-mobile-zoom button {
      background: rgba(16,24,21,.96) !important;
      box-shadow: none !important;
    }

    .okey-touch-ui #score-notebook {
      top: calc(7px + var(--okey-safe-top, 0px)) !important;
      right: calc(7px + var(--okey-safe-right, 0px)) !important;
      max-height: calc(var(--okey-visible-height, 100dvh) - 14px - var(--okey-safe-top, 0px) - var(--okey-safe-bottom, 0px)) !important;
    }

    .okey-touch-ui #score-notebook:not(.is-open) {
      width: 132px !important;
      max-height: 40px !important;
    }

    .okey-touch-ui #score-notebook-toggle {
      height: 40px !important;
      min-height: 40px !important;
      padding: 0 25px 0 9px !important;
      font-size: 10px !important;
      white-space: nowrap !important;
      touch-action: manipulation;
    }

    .okey-touch-ui #score-notebook.is-open {
      width: calc(100vw - 14px - var(--okey-safe-left, 0px) - var(--okey-safe-right, 0px)) !important;
    }

    .okey-touch-ui #score-notebook-body {
      max-height: calc(var(--okey-visible-height, 100dvh) - 54px) !important;
    }

    .okey-touch-ui #round-end-banner,
    .okey-touch-ui #seat-swap-offer-panel {
      max-width: calc(100vw - 16px - var(--okey-safe-left, 0px) - var(--okey-safe-right, 0px));
    }

    .okey-touch-ui #okey-matchmaker {
      padding:
        calc(7px + var(--okey-safe-top, 0px))
        calc(7px + var(--okey-safe-right, 0px))
        calc(7px + var(--okey-safe-bottom, 0px))
        calc(7px + var(--okey-safe-left, 0px)) !important;
    }

    .okey-touch-ui .okey-mm-shell {
      max-height: calc(var(--okey-visible-height, 100dvh) - 14px) !important;
      border-radius: 14px !important;
      background: rgba(9,15,14,.96) !important;
    }

    .okey-touch-ui .okey-mm-btn {
      min-height: 42px;
      touch-action: manipulation;
    }

    @media (orientation: portrait) {
      .okey-touch-ui #okey-mobile-gameplay-controls {
        top: 55%;
      }

      .okey-touch-ui #social-panel {
        max-height: min(40dvh, calc(var(--okey-visible-height, 100dvh) - 82px)) !important;
      }
    }

    @media (orientation: landscape) {
      .okey-touch-ui #game-hud {
        width: min(238px, calc(100vw - 14px)) !important;
      }

      .okey-touch-ui.okey-mobile-playing #game-hud.is-collapsed {
        width: 176px !important;
      }

      .okey-touch-ui #opened-board-inspector-toggle {
        top: calc(7px + var(--okey-safe-top, 0px)) !important;
      }
    }
  `

  document.head.appendChild(style)
}

function dispatchCameraAction(action) {
  window.dispatchEvent(new CustomEvent('okey:mobile-camera', {
    detail: { action },
  }))
}

function makeCameraButton(label, action) {
  const button = document.createElement('button')
  button.type = 'button'
  button.textContent = label
  button.dataset.mobileCameraAction = action
  button.addEventListener('pointerdown', event => {
    event.preventDefault()
    event.stopPropagation()
  })
  button.addEventListener('click', event => {
    event.preventDefault()
    event.stopPropagation()
    dispatchCameraAction(action)
  })
  return button
}

function ensureMobileDom() {
  if (mobileRoot) return

  cameraControls = document.createElement('div')
  cameraControls.id = 'okey-mobile-gameplay-controls'
  cameraControls.setAttribute('aria-label', 'Mobil kamera kontrolleri')

  const rackButton = makeCameraButton('ISTAKA', 'rack')
  const boardButton = makeCameraButton('AÇMA', 'board')
  openingCameraButton = makeCameraButton('AÇAN', 'opening')
  cameraControls.append(rackButton, boardButton, openingCameraButton)

  discardHint = document.createElement('div')
  discardHint.id = 'okey-mobile-discard-hint'
  discardHint.textContent = 'AT'
  discardHint.setAttribute('aria-hidden', 'true')

  document.body.append(cameraControls, discardHint)
  mobileRoot = cameraControls
}

function updateViewportCssVars() {
  const viewport = getVisualViewportSize()
  const keyboardInset = Math.max(
    0,
    window.innerHeight - (viewport.height + viewport.offsetTop)
  )

  document.documentElement.style.setProperty(
    '--okey-visible-height',
    `${Math.round(viewport.height)}px`
  )
  document.documentElement.style.setProperty(
    '--okey-keyboard-inset',
    `${Math.round(keyboardInset)}px`
  )
  document.documentElement.classList.toggle(
    'okey-mobile-keyboard-open',
    isTouchLayout() && keyboardInset > 80
  )
}

function updateLayoutClass() {
  const enabled = computeTouchLayout()
  if (cachedTouchLayout !== enabled) {
    cachedTouchLayout = enabled
    document.documentElement.classList.toggle('okey-touch-ui', enabled)
  }
  updateViewportCssVars()
  return enabled
}

function getOrientationKey() {
  return window.innerWidth >= window.innerHeight ? 'landscape' : 'portrait'
}

function handlePossibleOrientationChange() {
  const next = getOrientationKey()
  if (!lastOrientationKey) {
    lastOrientationKey = next
    return
  }

  if (next !== lastOrientationKey) {
    lastOrientationKey = next
    window.dispatchEvent(new CustomEvent('okey:mobile-gesture-reset', {
      detail: { reason: 'orientation' },
    }))
  }
}

export function setupMobileUi() {
  installStyles()
  ensureMobileDom()
  updateLayoutClass()
  lastOrientationKey = getOrientationKey()

  const onViewportChanged = () => {
    updateLayoutClass()
    handlePossibleOrientationChange()
  }

  window.addEventListener('resize', onViewportChanged, { passive: true })
  window.addEventListener('orientationchange', onViewportChanged, { passive: true })
  window.visualViewport?.addEventListener?.('resize', updateViewportCssVars, { passive: true })
  window.visualViewport?.addEventListener?.('scroll', updateViewportCssVars, { passive: true })
}

export function updateMobileUi() {
  if (!mobileRoot) return

  const enabled = cachedTouchLayout ?? updateLayoutClass()
  const inTable = Boolean(state.currentTableId && !state.matchmakingMode)
  const phase = state.publicGameState?.phase || ''
  const isPlaying = phase === 'playing'

  document.documentElement.classList.toggle(
    'okey-mobile-playing',
    enabled && inTable && isPlaying
  )

  cameraControls.classList.toggle(
    'visible',
    enabled && inTable && isPlaying && !state.isDraggingTile && !state.isStickyPickup
  )

  // Telefonda oyun başladığında masa alanını otomatik boşalt. Kullanıcı HUD veya
  // sohbeti tekrar açabilir; bu yalnız her masa/phase geçişinde bir kez yapılır.
  const phaseKey = `${state.currentTableId || ''}:${phase}`
  if (enabled && phaseKey !== lastMobilePhaseKey) {
    lastMobilePhaseKey = phaseKey

    if (isPlaying) {
      const hud = document.getElementById('game-hud')
      if (hud && !hud.classList.contains('is-collapsed')) {
        document.getElementById('hud-panel-toggle')?.click()
      }

      const social = document.getElementById('social-panel')
      if (social && !social.classList.contains('is-minimized')) {
        document.getElementById('chat-minimize-button')?.click()
      }
    }
  }

  const activeOpeningSeat = state.publicGameState?.activeOpeningSeat || null
  if (openingCameraButton) {
    openingCameraButton.disabled = !(
      isPlaying &&
      activeOpeningSeat &&
      activeOpeningSeat !== state.localSeat
    )
  }

  const canShowDiscard = Boolean(
    enabled &&
    isPlaying &&
    !state.openBoardDragCaptured &&
    (
      (state.isDraggingTile && state.activeRackDragMode === 'single') ||
      (state.isStickyPickup && state.stickyPickupSource === 'stock')
    )
  )

  discardHint.classList.toggle('visible', canShowDiscard)
}
