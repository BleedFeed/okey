import { state } from './state.js'

const MOBILE_SHORT_EDGE_MAX = 1024
const TOUCH_DRAG_SLOP_PX = 8
const TOUCH_JOKER_CLICK_SLOP_PX = 14
const TOUCH_JOKER_DOUBLE_DISTANCE_PX = 44
const MOBILE_RENDER_DPR_MAX = 1.5

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

export function isTouchLayout() {
  const coarse = window.matchMedia?.('(pointer: coarse)')?.matches === true
  const hasTouch = Number(navigator.maxTouchPoints || 0) > 0

  if (!coarse || !hasTouch) return false
  return getScreenShortEdge() <= MOBILE_SHORT_EDGE_MAX
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
  const zoneWidth = Math.min(108, Math.max(78, viewport.width * 0.17))
  const safeBottom = 92
  const top = Math.max(118, viewport.height * 0.30)
  const bottom = Math.max(top + 80, viewport.height - safeBottom)

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

    #okey-mobile-gameplay-controls {
      position: fixed;
      right: calc(10px + var(--okey-safe-right, 0px));
      bottom: calc(12px + var(--okey-safe-bottom, 0px));
      z-index: 152;
      display: none;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 6px;
      width: min(236px, calc(100vw - 28px));
      padding: 6px;
      box-sizing: border-box;
      border: 1px solid rgba(235,240,238,0.12);
      border-radius: 13px;
      background: rgba(10,16,15,0.48);
      box-shadow: 0 8px 24px rgba(0,0,0,0.18);
      backdrop-filter: blur(13px) saturate(.92);
      -webkit-backdrop-filter: blur(13px) saturate(.92);
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
      min-width: 0;
      min-height: 46px;
      padding: 6px 5px;
      border: 1px solid rgba(255,255,255,0.11);
      border-radius: 9px;
      background: rgba(255,255,255,0.055);
      color: rgba(247,249,248,0.93);
      font: 850 10px/1.05 "Segoe UI", Tahoma, sans-serif;
      letter-spacing: .035em;
      touch-action: manipulation;
    }

    #okey-mobile-gameplay-controls button:disabled {
      opacity: .35;
    }

    #okey-mobile-discard-hint {
      position: fixed;
      right: calc(7px + var(--okey-safe-right, 0px));
      top: 43%;
      z-index: 151;
      width: 82px;
      height: 100px;
      display: none;
      place-items: center;
      box-sizing: border-box;
      border: 2px dashed rgba(255,219,123,.72);
      border-radius: 16px;
      background: rgba(31,49,39,.38);
      color: #ffe096;
      box-shadow: 0 8px 28px rgba(0,0,0,.22), inset 0 0 22px rgba(255,214,104,.05);
      font: 900 13px/1 "Segoe UI", sans-serif;
      letter-spacing: .11em;
      pointer-events: none;
      opacity: .88;
    }

    .okey-touch-ui #okey-mobile-discard-hint.visible {
      display: grid;
    }

    .okey-touch-ui #game-hud {
      top: calc(8px + var(--okey-safe-top, 0px)) !important;
      left: calc(8px + var(--okey-safe-left, 0px)) !important;
      width: min(300px, calc(100vw - 16px - var(--okey-safe-left, 0px) - var(--okey-safe-right, 0px))) !important;
    }

    .okey-touch-ui #game-hud #hud-panel-toggle,
    .okey-touch-ui #game-hud button,
    .okey-touch-ui #game-hud select {
      min-height: 44px;
    }

    .okey-touch-ui #game-hud #control-hint {
      display: none !important;
    }

    .okey-touch-ui #hud-panel-content-inner {
      max-height: min(46dvh, calc(var(--okey-visible-height, 100dvh) - 78px)) !important;
      overflow-y: auto;
      overscroll-behavior: contain;
      -webkit-overflow-scrolling: touch;
    }

    .okey-touch-ui #social-panel {
      right: calc(8px + var(--okey-safe-right, 0px)) !important;
      bottom: calc(68px + var(--okey-safe-bottom, 0px)) !important;
      width: min(340px, calc(100vw - 16px - var(--okey-safe-left, 0px) - var(--okey-safe-right, 0px))) !important;
      max-height: min(48dvh, calc(var(--okey-visible-height, 100dvh) - 92px)) !important;
      overflow: hidden;
    }

    .okey-touch-ui #social-panel #chat-log {
      max-height: min(21dvh, 150px) !important;
    }

    .okey-touch-ui.okey-mobile-keyboard-open #social-panel {
      bottom: calc(8px + var(--okey-keyboard-inset, 0px) + var(--okey-safe-bottom, 0px)) !important;
      max-height: calc(var(--okey-visible-height, 100dvh) - 16px) !important;
    }

    .okey-touch-ui #social-panel button,
    .okey-touch-ui #chat-input,
    .okey-touch-ui #chat-send-button,
    .okey-touch-ui #chat-dock-button {
      min-height: 44px;
    }

    .okey-touch-ui #chat-dock-button {
      right: calc(10px + var(--okey-safe-right, 0px)) !important;
      bottom: calc(70px + var(--okey-safe-bottom, 0px)) !important;
      min-width: 44px;
    }

    .okey-touch-ui #okey-back-to-tables {
      min-height: 44px;
      padding-inline: 14px;
      touch-action: manipulation;
    }

    .okey-touch-ui #opened-board-inspector-toggle {
      top: calc(6px + var(--okey-safe-top, 0px)) !important;
      min-height: 44px;
      padding-inline: 12px !important;
      touch-action: manipulation;
    }

    .okey-touch-ui #score-notebook {
      top: calc(8px + var(--okey-safe-top, 0px)) !important;
      right: calc(8px + var(--okey-safe-right, 0px)) !important;
      max-height: calc(var(--okey-visible-height, 100dvh) - 16px - var(--okey-safe-top, 0px) - var(--okey-safe-bottom, 0px)) !important;
    }

    .okey-touch-ui #score-notebook-toggle {
      min-height: 44px;
      touch-action: manipulation;
    }

    .okey-touch-ui #okey-matchmaker {
      padding:
        calc(8px + var(--okey-safe-top, 0px))
        calc(8px + var(--okey-safe-right, 0px))
        calc(8px + var(--okey-safe-bottom, 0px))
        calc(8px + var(--okey-safe-left, 0px)) !important;
    }

    .okey-touch-ui .okey-mm-shell {
      max-height: calc(var(--okey-visible-height, 100dvh) - 16px) !important;
      border-radius: 17px !important;
    }

    .okey-touch-ui .okey-mm-btn {
      min-height: 46px;
      touch-action: manipulation;
    }

    .okey-touch-ui #score-notebook,
    .okey-touch-ui #round-end-banner,
    .okey-touch-ui #seat-swap-offer-panel {
      max-width: calc(100vw - 20px - var(--okey-safe-left, 0px) - var(--okey-safe-right, 0px));
    }

    @media (orientation: portrait) {
      .okey-touch-ui #okey-mobile-gameplay-controls {
        width: min(220px, calc(100vw - 24px));
      }

      .okey-touch-ui #social-panel {
        max-height: min(42dvh, calc(var(--okey-visible-height, 100dvh) - 98px)) !important;
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
  const enabled = isTouchLayout()
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
