import * as THREE from 'three'
import './style.css'

import { state } from './state.js'
import {
  scene,
  camera,
  renderer,
  resizeScene,
  seatCameraSettings,
} from './scene.js'
import {
  setupRackDragging,
  updateRackInteractionAnimation,
  getHandMap,
  renderOwnHand,
  visualValidateMeld,
  visualValidatePair,
  visualValidateOpeningPair,
} from './rack.js'
import {
  playerAvatars,
  updateAvatarEyes,
  setupSeatSwapEyeInteractions,
} from './avatars.js'
import { setMessage, setupBotControls } from './hud.js'
import { createSocket } from './network.js'
import { setupMatchmaking } from './matchmaking.js'
import {
  setupTableInteractions,
  updateTableInteractionAnimation,
} from './table-actions.js'
import {
  setupMeldBoard,
  updateMeldBoardAnimation,
  getOpeningBoardFocusPoint,
  getOpeningBoardVisualBounds,
} from './meld-board.js'
import {
  setupTeaInteractions,
  updateTeaAnimation,
} from './tea-actions.js'
import {
  isTouchLayout,
  isTouchPointerEvent,
  setupMobileUi,
  updateMobileUi,
} from './mobile.js'

const PLAYER_NAME_STORAGE_KEY = 'okey101-player-name'

let playerName = ''

try {
  playerName = String(window.localStorage.getItem(PLAYER_NAME_STORAGE_KEY) || '').trim()
}
catch {
  playerName = ''
}

if (!playerName) {
  playerName = window.prompt(
    'Oyuncu adını gir:',
    'Oyuncu'
  )?.trim() || 'Oyuncu'
}

playerName = playerName.slice(0, 20) || 'Oyuncu'

try {
  window.localStorage.setItem(PLAYER_NAME_STORAGE_KEY, playerName)
}
catch {
  // localStorage kapalıysa oyun isim sormaya devam edebilir; bağlantıyı bozma.
}

const socket = createSocket(playerName)
setupMatchmaking(socket, setMessage)
setupBotControls(socket)
setupSeatSwapEyeInteractions(socket, setMessage)

const meldBoard = setupMeldBoard(
  socket,
  setMessage,
  {
    getHandMap,
    renderOwnHand,
    validateMeld: visualValidateMeld,
    validatePair: visualValidatePair,
    validateOpeningPair: visualValidateOpeningPair,
    openBoardInspector,
    getBoardInspectorProjection,
  }
)

setupRackDragging(
  socket,
  setMessage,
  meldBoard
)
setupTableInteractions(socket, setMessage)
setupTeaInteractions(socket, setMessage)
setupMobileUi()

// Tarayıcılar güvenlik nedeniyle özel metni her zaman göstermese de, aktif
// oyun sırasında sekme kapatma / yenileme / sayfadan ayrılma için native
// onay penceresini tetikler.
window.addEventListener('beforeunload', event => {
  if (state.publicGameState?.phase !== 'playing') return

  event.preventDefault()
  event.returnValue = 'Oyundan çıkmak istediğinize emin misiniz?'
})

// =====================================================
// POINTER / REMOTE AVATAR LOOK + OPENING-AREA CAMERA
// =====================================================

// Eski mouse-kamera eşikleri bilinçli olarak korunuyor; artık kamera geçişini
// tetiklemiyorlar. W yalnız kendi açma alanına çıkar, S ıstakaya döner.
// Diğer oyuncuların açılmış taşları rack kamerasında tıklanarak ayrı inset
// kamerada incelenir. Böylece daha önce elle ayarlanan 0.20 / 0.88 değerleri
// kaybolmadan kalır fakat mouse-look / edge kamera navigasyonu devre dışıdır.
const OVERVIEW_ENTER_RATIO = 0.20
const OVERVIEW_EXIT_RATIO = 0.88

// Eski edge değerleri de mevcut koordinat/ayar geçmişini bozmamak için tutulur;
// aktif kamera navigasyonu bunları çağırmaz.
const OVERVIEW_EDGE_TOUCH_PX = 10
const OVERVIEW_EDGE_RELEASE_PX = 42
const OVERVIEW_TOP_OPPOSITE_RATIO = 0.12
const OVERVIEW_FOCUS_SWITCH_MIN_PROGRESS = 0.72

// 13x6 acma alaninin tamamini kadraja sigdirirken olabildigince yakin kalir.
// Mesafe hedefe giden 70 derecelik gorus vektorunun uzunlugudur.
const OVERVIEW_VIEW_ANGLE = THREE.MathUtils.degToRad(70)
const OVERVIEW_FOCUS_DISTANCE = 2.62
const OVERVIEW_TRANSITION_SPEED = 1.75
const OVERVIEW_FOCUS_DAMPING = 6.5
const OVERVIEW_POSITION_DAMPING = 5.5
const OVERVIEW_ARC_LIFT = 0.34

const TABLE_LOOK_TARGET = new THREE.Vector3(0, 1.16, 0)
// Telefon landscape'te kamera masa merkezine değil rack'in hemen arkasına
// bakar. Y hedefi taş merkezinden biraz yukarıda tutulur; böylece iki sıra
// ıstaka ekranın alt yarısını doldurur ve üst bölüm açma/işleme alanına kalır.
const MOBILE_RACK_LOOK_TARGETS = {
  'player-bottom': new THREE.Vector3(0, 2.12, 2.96),
  'player-top': new THREE.Vector3(0, 2.12, -2.96),
  'player-left': new THREE.Vector3(-2.96, 2.12, 0),
  'player-right': new THREE.Vector3(2.96, 2.12, 0),
}

function getSeatedLookTarget() {
  if (!isTouchLayout()) return TABLE_LOOK_TARGET
  return MOBILE_RACK_LOOK_TARGETS[state.localSeat] || TABLE_LOOK_TARGET
}

const SEAT_ORDER = [
  'player-bottom',
  'player-right',
  'player-top',
  'player-left',
]

let overviewRequested = false
let overviewProgress = 0
let overviewFocusSeat = null
let overviewFocusCurrent = new THREE.Vector3()
let overviewPositionCurrent = new THREE.Vector3()
let overviewVectorsInitialized = false
let overviewEdgeDirection = 0
let overviewTopJumpRequested = false
let lastAnimationTime = performance.now()
let lastRenderGateTime = lastAnimationTime
const MAX_RENDER_FPS = 60
const MIN_RENDER_FRAME_MS = 1000 / MAX_RENDER_FPS

// Ust kamerada hangi oyuncunun perlerine bakildigini gosteren kucuk isim.
// HUD'dan bagimsiz tutuluyor; kamera oturumu kapaninca tamamen kaybolur.
const overviewPlayerLabel = document.createElement('div')
overviewPlayerLabel.id = 'overview-player-name'
overviewPlayerLabel.style.cssText = `
  position: fixed;
  top: 12px;
  left: 50%;
  z-index: 58;
  transform: translate(-50%, -5px);
  padding: 4px 9px;
  border: 1px solid rgba(255,255,255,0.16);
  border-radius: 999px;
  background: rgba(18, 22, 20, 0.62);
  color: rgba(255,255,255,0.92);
  box-shadow: 0 3px 10px rgba(0,0,0,0.18);
  font: 700 12px/1.1 "Segoe UI", sans-serif;
  letter-spacing: 0.01em;
  pointer-events: none;
  user-select: none;
  opacity: 0;
  transition: opacity 120ms ease, transform 120ms ease;
`
document.body.appendChild(overviewPlayerLabel)

// =====================================================
// OPENED-BOARD MULTI INSPECTOR
// =====================================================
// Üstteki küçük butonla, şu anda resmi olarak açmış oyuncuların açma
// alanlarını yan yana
// gösterir. Her panel kendi kamerasından render edilir ve rack'ten sürüklenen
// taş, hangi panelin içine bırakıldıysa o oyuncunun board'una projekte edilir.
const BOARD_INSPECTOR_CAMERA_FOV = 58
// Açılan taşlar paneli tam tepeden bakar. Base zoom (0) bütün taşları
// kadraja sığdıran mümkün olan en yakın mesafedir. Mouse tekerleği yalnız
// inceleme zoom'u yapar; işleme ray'i her zoom seviyesinde gerçek kameradan üretilir.
const BOARD_INSPECTOR_MIN_DISTANCE = 0.46
const BOARD_INSPECTOR_MAX_DISTANCE = 3.20
const BOARD_INSPECTOR_FIT_MARGIN = 1.018
const BOARD_INSPECTOR_DISTANCE_PADDING = 0.018
const BOARD_INSPECTOR_MAX_ZOOM_LEVEL = 8
const BOARD_INSPECTOR_ZOOM_FACTOR = 0.90
// Zoomlu panelde pan yalnız açılmış taşların yakın çevresinde kalsın.
// Büyük değerler kamera odağını masadan fazla uzaklaştırdığı için dar tutulur.
const BOARD_INSPECTOR_PAN_EDGE_MARGIN = 0.04
const BOARD_INSPECTOR_PAN_MIN_AXIS = 0.04
const BOARD_INSPECTOR_PAN_MAX_AXIS = 0.36
const BOARD_INSPECTOR_MAX_PANEL_WIDTH = 980
const BOARD_INSPECTOR_PANEL_VIEWPORT_RATIO = 0.72
const BOARD_INSPECTOR_FRAME_MIN_WIDTH = 245

const boardInspectorPointer = new THREE.Vector2()
const boardInspectorRaycaster = new THREE.Raycaster()
const boardInspectorPlane = new THREE.Plane(
  new THREE.Vector3(0, 1, 0),
  -1.235
)
const boardInspectorHit = new THREE.Vector3()
const boardInspectorFocus = new THREE.Vector3()
const boardInspectorBoundsCenter = new THREE.Vector3()
const boardInspectorBoundsSize = new THREE.Vector3()
const boardInspectorCorner = new THREE.Vector3()
const boardInspectorRelative = new THREE.Vector3()
const boardInspectorForward = new THREE.Vector3()
const boardInspectorRight = new THREE.Vector3()
const boardInspectorUp = new THREE.Vector3()
const boardInspectorZoomBefore = new THREE.Vector3()
const boardInspectorZoomAfter = new THREE.Vector3()

let boardInspectorPanelOpen = false
let boardInspectorRound = null
let boardInspectorPanState = null
// Her raundda hangi rakiplerin acma alaninin gorundugunu hatirlar. Boylece
// rakip ilk kez acmaya basladiginda panel otomatik acilir; kullanici X ile
// kapattiktan sonra ayni oyuncu icin tekrar tekrar zorla acilmaz.
let boardInspectorObservedRound = null
const boardInspectorObservedSeats = new Set()
const boardInspectorEntries = new Map()
let boardInspectorMobileSeat = null
let boardInspectorMobileTabsSignature = ''

const boardInspectorToggleButton = document.createElement('button')
boardInspectorToggleButton.id = 'opened-board-inspector-toggle'
boardInspectorToggleButton.type = 'button'
boardInspectorToggleButton.textContent = 'AÇILAN TAŞLAR'
boardInspectorToggleButton.setAttribute('aria-label', 'Açılan taşları göster veya gizle')
boardInspectorToggleButton.style.cssText = `
  position: fixed;
  top: 10px;
  left: 50%;
  z-index: 70;
  transform: translateX(-50%);
  padding: 6px 11px;
  border: 1px solid rgba(255,255,255,0.28);
  border-radius: 8px;
  background: rgba(13,17,15,0.86);
  color: #f6f1df;
  box-shadow: 0 5px 16px rgba(0,0,0,0.28);
  font: 800 10px/1 "Segoe UI", sans-serif;
  letter-spacing: 0.055em;
  cursor: pointer;
  user-select: none;
`
document.body.appendChild(boardInspectorToggleButton)

const boardInspectorPanel = document.createElement('div')
boardInspectorPanel.id = 'opened-board-inspector-panel'
boardInspectorPanel.style.cssText = `
  position: fixed;
  top: 45px;
  left: 50%;
  z-index: 57;
  transform: translateX(-50%);
  height: min(25vh, 270px);
  min-height: 185px;
  display: none;
  gap: 5px;
  padding: 5px;
  box-sizing: border-box;
  border: 1px solid rgba(255,255,255,0.22);
  border-radius: 12px;
  background: rgba(8,11,9,0.14);
  box-shadow: 0 10px 30px rgba(0,0,0,0.32);
  pointer-events: none;
  overflow: hidden;
`

document.body.appendChild(boardInspectorPanel)

const boardInspectorMobileTabs = document.createElement('div')
boardInspectorMobileTabs.id = 'opened-board-mobile-tabs'
boardInspectorMobileTabs.style.cssText = `
  position: absolute;
  left: 7px;
  right: 50px;
  top: 6px;
  z-index: 5;
  display: none;
  gap: 5px;
  pointer-events: auto;
  overflow: hidden;
`
boardInspectorPanel.appendChild(boardInspectorMobileTabs)

const boardInspectorMobileZoom = document.createElement('div')
boardInspectorMobileZoom.id = 'opened-board-mobile-zoom'
boardInspectorMobileZoom.style.cssText = `
  position: absolute;
  right: 7px;
  bottom: 7px;
  z-index: 5;
  display: none;
  gap: 4px;
  pointer-events: auto;
`
boardInspectorPanel.appendChild(boardInspectorMobileZoom)

function makeBoardInspectorMobileZoomButton(label, action, ariaLabel) {
  const button = document.createElement('button')
  button.type = 'button'
  button.textContent = label
  button.dataset.inspectorZoomAction = action
  button.setAttribute('aria-label', ariaLabel)
  button.style.cssText = `
    width: 34px;
    height: 34px;
    padding: 0;
    border: 1px solid rgba(255,255,255,.22);
    border-radius: 8px;
    background: rgba(12,16,14,.88);
    color: #fff;
    font: 900 17px/1 "Segoe UI", sans-serif;
    pointer-events: auto;
    touch-action: manipulation;
  `
  return button
}

boardInspectorMobileZoom.append(
  makeBoardInspectorMobileZoomButton('−', 'out', 'Uzaklaştır'),
  makeBoardInspectorMobileZoomButton('+', 'in', 'Yakınlaştır')
)

const boardInspectorCloseButton = document.createElement('button')
boardInspectorCloseButton.type = 'button'
boardInspectorCloseButton.textContent = '×'
boardInspectorCloseButton.setAttribute('aria-label', 'Açılan taşlar panelini kapat')
boardInspectorCloseButton.style.cssText = `
  position: absolute;
  top: 7px;
  right: 7px;
  width: 27px;
  height: 27px;
  z-index: 4;
  display: grid;
  place-items: center;
  padding: 0;
  border: 1px solid rgba(255,255,255,0.36);
  border-radius: 7px;
  background: rgba(12,16,14,0.86);
  color: #fff;
  cursor: pointer;
  pointer-events: auto;
  font: 800 20px/1 "Segoe UI", sans-serif;
`
boardInspectorCloseButton.addEventListener('pointerdown', event => {
  // Kapatmayı click'e bırakma: inspector paneli pointer/rack etkileşimleriyle aynı
  // katmanda çalıştığı için pointerdown anında state'i kapatmak, X'in her durumda
  // güvenilir biçimde kameraları da durdurmasını sağlar.
  event.preventDefault()
  event.stopPropagation()
  closeBoardInspector()
})
boardInspectorCloseButton.addEventListener('click', event => {
  // pointerdown zaten kapattı; sonradan üretilen click'in alttaki canvas'a
  // taşınmasını/başka bir etkileşimi tetiklemesini engelle.
  event.preventDefault()
  event.stopPropagation()
})
boardInspectorPanel.appendChild(boardInspectorCloseButton)

function getInspectableOpenedSeats() {
  const gameState = state.publicGameState || {}
  const seats = new Set()

  for (const player of gameState.players || []) {
    if (player?.opened && SEAT_ORDER.includes(player.seat)) {
      seats.add(player.seat)
    }
  }

  // Panel açıkken biri ilk açılışını masaya sürüklemeye başlarsa kapat/aç
  // gerektirmeden anında yeni kamera ekle. Taslak zaten public render edildiği
  // için inspector aynı visible bounds üzerinden onu da fit edebilir.
  for (const draft of gameState.openingDrafts || []) {
    const seat = draft?.ownerSeat
    if (SEAT_ORDER.includes(seat)) {
      seats.add(seat)
    }
  }

  return [...seats]
    .sort((a, b) => SEAT_ORDER.indexOf(a) - SEAT_ORDER.indexOf(b))
}

function updateBoardInspectorButton() {
  const count = getInspectableOpenedSeats().length
  boardInspectorToggleButton.disabled = count === 0
  boardInspectorToggleButton.style.opacity = count === 0 ? '0.46' : '1'
  boardInspectorToggleButton.style.cursor = count === 0 ? 'default' : 'pointer'
  boardInspectorToggleButton.textContent = boardInspectorPanelOpen
    ? 'AÇILAN TAŞLARI KAPAT'
    : 'AÇILAN TAŞLAR'
}

function closeBoardInspector() {
  boardInspectorPanState = null
  boardInspectorPanelOpen = false
  boardInspectorRound = null
  boardInspectorEntries.clear()
  for (const child of [...boardInspectorPanel.children]) {
    if (
      child !== boardInspectorCloseButton &&
      child !== boardInspectorMobileTabs &&
      child !== boardInspectorMobileZoom
    ) {
      child.remove()
    }
  }
  boardInspectorMobileSeat = null
  boardInspectorMobileTabsSignature = ''
  boardInspectorMobileTabs.replaceChildren()
  boardInspectorPanel.style.display = 'none'
  updateBoardInspectorButton()

  // Inspector kameraları renderer'ın scissor/viewport alanlarını kullanıyor.
  // Panel kapanırken ana animasyon frame'ini beklemeden bu render state'ini de
  // sıfırla ve ana kamerayı tam canvas'a bir kez çiz. Böylece X'e basıldığı anda
  // inset kameraların son karesi ekranda kalmaz.
  renderer.setScissorTest(false)
  const rendererSize = new THREE.Vector2()
  renderer.getSize(rendererSize)
  renderer.setViewport(0, 0, rendererSize.x, rendererSize.y)
  renderer.render(scene, camera)
}

function getBoardInspectorPlayerName(seat) {
  return state.publicGameState?.players?.find(player => player?.seat === seat)?.name || 'Oyuncu'
}

function createBoardInspectorEntry(seat) {
  const camera = new THREE.PerspectiveCamera(
    BOARD_INSPECTOR_CAMERA_FOV,
    1,
    0.1,
    100
  )
  camera.rotation.order = 'YXZ'

  const wrapper = document.createElement('div')
  wrapper.dataset.seat = seat
  wrapper.style.cssText = `
    position: relative;
    flex: 1 1 0;
    min-width: 0;
    height: 100%;
    display: flex;
    flex-direction: column;
    gap: 3px;
    pointer-events: none;
  `

  const frame = document.createElement('div')
  frame.style.cssText = `
    position: relative;
    flex: 1 1 auto;
    min-height: 0;
    overflow: hidden;
    border: 1px solid rgba(255,255,255,0.30);
    border-radius: 9px;
    box-shadow: inset 0 0 0 1px rgba(0,0,0,0.24);
    pointer-events: none;
  `

  const label = document.createElement('div')
  label.textContent = getBoardInspectorPlayerName(seat)
  label.style.cssText = `
    flex: 0 0 auto;
    min-height: 17px;
    padding: 1px 6px 0;
    overflow: hidden;
    color: rgba(246,241,223,0.92);
    text-align: center;
    text-overflow: ellipsis;
    white-space: nowrap;
    font: 700 10px/1.35 "Segoe UI", sans-serif;
    letter-spacing: 0.025em;
    text-shadow: 0 1px 3px rgba(0,0,0,0.75);
    pointer-events: none;
    user-select: none;
  `

  wrapper.append(frame, label)
  boardInspectorPanel.appendChild(wrapper)

  return {
    seat,
    camera,
    frame,
    wrapper,
    label,
    zoomLevel: 0,
    panOffset: new THREE.Vector3(),
  }
}

function syncBoardInspectorMobileChrome(seats) {
  const mobile = isTouchLayout()

  if (!mobile) {
    boardInspectorMobileTabs.style.display = 'none'
    boardInspectorMobileZoom.style.display = 'none'
    boardInspectorPanel.style.top = '45px'
    boardInspectorPanel.style.height = 'min(25vh, 270px)'
    boardInspectorPanel.style.minHeight = '185px'
    boardInspectorCloseButton.style.width = '27px'
    boardInspectorCloseButton.style.height = '27px'

    for (const entry of boardInspectorEntries.values()) {
      entry.wrapper.style.display = 'flex'
    }
    return
  }

  if (!seats.includes(boardInspectorMobileSeat)) {
    boardInspectorMobileSeat =
      seats.find(seat => seat !== state.localSeat) ||
      seats[0] ||
      null
  }

  const signature = seats.join('|')
  if (signature !== boardInspectorMobileTabsSignature) {
    boardInspectorMobileTabsSignature = signature
    boardInspectorMobileTabs.replaceChildren()

    for (const seat of seats) {
      const button = document.createElement('button')
      button.type = 'button'
      button.dataset.inspectorSeat = seat
      button.textContent = getBoardInspectorPlayerName(seat)
      button.style.cssText = `
        flex: 1 1 0;
        min-width: 0;
        height: 34px;
        padding: 0 8px;
        overflow: hidden;
        border: 1px solid rgba(255,255,255,.15);
        border-radius: 8px;
        background: rgba(12,16,14,.82);
        color: rgba(246,241,223,.9);
        text-overflow: ellipsis;
        white-space: nowrap;
        font: 800 9px/1 "Segoe UI", sans-serif;
        pointer-events: auto;
        touch-action: manipulation;
      `
      button.addEventListener('pointerdown', event => {
        event.preventDefault()
        event.stopImmediatePropagation()
      })
      button.addEventListener('click', event => {
        event.preventDefault()
        event.stopPropagation()
        boardInspectorMobileSeat = seat
      })
      boardInspectorMobileTabs.appendChild(button)
    }
  }

  for (const button of boardInspectorMobileTabs.querySelectorAll('button')) {
    button.textContent = getBoardInspectorPlayerName(button.dataset.inspectorSeat)
    const active = button.dataset.inspectorSeat === boardInspectorMobileSeat
    button.style.borderColor = active
      ? 'rgba(255,222,132,.58)'
      : 'rgba(255,255,255,.15)'
    button.style.color = active ? '#ffe096' : 'rgba(246,241,223,.9)'
  }

  for (const [seat, entry] of boardInspectorEntries) {
    entry.wrapper.style.display = seat === boardInspectorMobileSeat ? 'flex' : 'none'
  }

  boardInspectorMobileTabs.style.display = seats.length > 1 ? 'flex' : 'none'
  boardInspectorMobileZoom.style.display = 'flex'

  const mobileLandscape = window.innerWidth >= window.innerHeight
  boardInspectorPanel.style.top = mobileLandscape
    ? 'calc(50px + env(safe-area-inset-top, 0px))'
    : 'calc(54px + env(safe-area-inset-top, 0px))'
  boardInspectorPanel.style.height = mobileLandscape
    ? `${Math.round(THREE.MathUtils.clamp(window.innerHeight * 0.28, 96, 128))}px`
    : `${Math.round(THREE.MathUtils.clamp(window.innerHeight * 0.35, 176, 286))}px`
  boardInspectorPanel.style.minHeight = '0'
  boardInspectorCloseButton.style.width = mobileLandscape ? '32px' : '36px'
  boardInspectorCloseButton.style.height = mobileLandscape ? '32px' : '36px'
}

boardInspectorMobileZoom.addEventListener('pointerdown', event => {
  event.preventDefault()
  event.stopImmediatePropagation()
}, true)

boardInspectorMobileZoom.addEventListener('click', event => {
  const action = event.target?.dataset?.inspectorZoomAction
  if (!action || !isTouchLayout()) return

  event.preventDefault()
  event.stopPropagation()

  const entry = boardInspectorEntries.get(boardInspectorMobileSeat)
  if (!entry) return

  if (action === 'in') {
    entry.zoomLevel = Math.min(BOARD_INSPECTOR_MAX_ZOOM_LEVEL, entry.zoomLevel + 1)
  }
  else if (action === 'out') {
    entry.zoomLevel = Math.max(0, entry.zoomLevel - 1)
  }

  if (entry.zoomLevel === 0) {
    entry.panOffset.set(0, 0, 0)
  }
  else {
    clampBoardInspectorPan(entry)
  }
})

function syncBoardInspectorEntries() {
  if (!boardInspectorPanelOpen) return

  const seats = getInspectableOpenedSeats()
  if (seats.length === 0) {
    closeBoardInspector()
    return
  }

  const seatSet = new Set(seats)
  for (const [seat, entry] of boardInspectorEntries) {
    if (!seatSet.has(seat)) {
      entry.wrapper.remove()
      boardInspectorEntries.delete(seat)
    }
  }

  for (const seat of seats) {
    if (!boardInspectorEntries.has(seat)) {
      boardInspectorEntries.set(seat, createBoardInspectorEntry(seat))
    }
  }

  // DOM sırasını koltuk sırasıyla aynı tut.
  for (const seat of seats) {
    const entry = boardInspectorEntries.get(seat)
    if (entry) {
      entry.label.textContent = getBoardInspectorPlayerName(seat)
      boardInspectorPanel.appendChild(entry.wrapper)
    }
  }
  boardInspectorPanel.append(
    boardInspectorMobileTabs,
    boardInspectorMobileZoom,
    boardInspectorCloseButton
  )

  const count = seats.length
  if (isTouchLayout()) {
    const landscape = window.innerWidth >= window.innerHeight
    boardInspectorPanel.style.width = landscape
      ? `${Math.round(THREE.MathUtils.clamp(window.innerWidth * 0.46, 300, 520))}px`
      : `${Math.max(280, window.innerWidth - 16)}px`
  }
  else {
    const viewportLimit = window.innerWidth * BOARD_INSPECTOR_PANEL_VIEWPORT_RATIO
    const desiredWidth = Math.max(
      300,
      Math.min(
        BOARD_INSPECTOR_MAX_PANEL_WIDTH,
        viewportLimit,
        Math.max(BOARD_INSPECTOR_FRAME_MIN_WIDTH * count, 360)
      )
    )
    boardInspectorPanel.style.width = `${Math.round(desiredWidth)}px`
  }

  syncBoardInspectorMobileChrome(seats)
}

function openBoardInspector() {
  if (getInspectableOpenedSeats().length === 0) return false
  boardInspectorPanelOpen = true
  boardInspectorRound = state.publicGameState?.round ?? null
  boardInspectorPanel.style.display = 'flex'
  syncBoardInspectorEntries()
  updateBoardInspectorButton()
  return true
}

function syncBoardInspectorAutoOpen() {
  const round = state.publicGameState?.round ?? null

  if (boardInspectorObservedRound !== round) {
    boardInspectorObservedRound = round
    boardInspectorObservedSeats.clear()
  }

  let opponentStartedOpening = false

  for (const seat of getInspectableOpenedSeats()) {
    if (boardInspectorObservedSeats.has(seat)) continue

    boardInspectorObservedSeats.add(seat)

    // Kendi acilisimizda ust panelin drag sirasinda onumuze firlamasina gerek
    // yok. Otomatik acilis yalniz baska bir oyuncu acmaya basladiginda olur.
    if (seat !== state.localSeat) {
      opponentStartedOpening = true
    }
  }

  if (opponentStartedOpening && !boardInspectorPanelOpen) {
    openBoardInspector()
  }
}

boardInspectorToggleButton.addEventListener('click', () => {
  if (boardInspectorPanelOpen) closeBoardInspector()
  else openBoardInspector()
})

function getBoardInspectorEntryAt(clientX, clientY) {
  if (!boardInspectorPanelOpen) return null

  for (const entry of boardInspectorEntries.values()) {
    const rect = entry.frame.getBoundingClientRect()
    if (rect.width <= 1 || rect.height <= 1) continue
    if (
      clientX >= rect.left && clientX <= rect.right &&
      clientY >= rect.top && clientY <= rect.bottom
    ) {
      return { entry, rect }
    }
  }

  return null
}

function clampBoardInspectorPan(entry) {
  if (!entry?.panOffset) return

  entry.panOffset.y = 0

  const bounds = getOpeningBoardVisualBounds(entry.seat)
  if (!bounds || bounds.isEmpty()) {
    entry.panOffset.x = THREE.MathUtils.clamp(entry.panOffset.x, -0.16, 0.16)
    entry.panOffset.z = THREE.MathUtils.clamp(entry.panOffset.z, -0.16, 0.16)
    return
  }

  // Pan artık masanın genelinde dolaşmaz; yalnız bu oyuncunun gerçekten açtığı
  // taşların çevresinde gezinir. Zoom arttıkça kadraj daraldığı için izin verilen
  // pan miktarı taş alanının görünmeyen kısmı kadar artar. Böylece kenardaki bir
  // pere ulaşılabilir ama kamera board'dan metrelerce uzağa sürüklenemez.
  bounds.getSize(boardInspectorBoundsSize)
  const zoomMultiplier = Math.pow(
    BOARD_INSPECTOR_ZOOM_FACTOR,
    THREE.MathUtils.clamp(
      entry.zoomLevel || 0,
      0,
      BOARD_INSPECTOR_MAX_ZOOM_LEVEL
    )
  )
  const hiddenRatio = THREE.MathUtils.clamp(1 - zoomMultiplier, 0, 1)

  const maxPanX = THREE.MathUtils.clamp(
    boardInspectorBoundsSize.x * 0.5 * hiddenRatio + BOARD_INSPECTOR_PAN_EDGE_MARGIN,
    BOARD_INSPECTOR_PAN_MIN_AXIS,
    BOARD_INSPECTOR_PAN_MAX_AXIS
  )
  const maxPanZ = THREE.MathUtils.clamp(
    boardInspectorBoundsSize.z * 0.5 * hiddenRatio + BOARD_INSPECTOR_PAN_EDGE_MARGIN,
    BOARD_INSPECTOR_PAN_MIN_AXIS,
    BOARD_INSPECTOR_PAN_MAX_AXIS
  )

  entry.panOffset.x = THREE.MathUtils.clamp(entry.panOffset.x, -maxPanX, maxPanX)
  entry.panOffset.z = THREE.MathUtils.clamp(entry.panOffset.z, -maxPanZ, maxPanZ)
}

// Tekerlek yalnız pointer'ın üzerindeki paneli zoomlar. Zoom yapılırken önce
// mouse altındaki gerçek masa noktası bulunur, zoom sonrası aynı nokta tekrar
// hesaplanıp kamera odağı fark kadar kaydırılır. Böylece kullanıcı sağ üstteki
// bir taşa bakıyorsa zoom doğrudan o noktaya doğru gider.
window.addEventListener('wheel', event => {
  const hit = getBoardInspectorEntryAt(event.clientX, event.clientY)
  if (!hit) return

  const { entry, rect } = hit
  event.preventDefault()

  const before = projectBoardInspectorWorldPoint(
    entry,
    event.clientX,
    event.clientY,
    rect,
    boardInspectorZoomBefore
  )

  if (event.deltaY < 0) {
    entry.zoomLevel = Math.min(
      BOARD_INSPECTOR_MAX_ZOOM_LEVEL,
      entry.zoomLevel + 1
    )
  } else if (event.deltaY > 0) {
    entry.zoomLevel = Math.max(0, entry.zoomLevel - 1)
  }

  if (entry.zoomLevel === 0) {
    // İşleme seviyesi her zaman deterministik merkez/kadrajdır. Pan bu
    // seviyede sıfırlanır; böylece raycast ile görüntü birebir eşleşir.
    entry.panOffset.set(0, 0, 0)
  } else if (before) {
    const after = projectBoardInspectorWorldPoint(
      entry,
      event.clientX,
      event.clientY,
      rect,
      boardInspectorZoomAfter
    )

    if (after) {
      entry.panOffset.x += before.x - after.x
      entry.panOffset.z += before.z - after.z
      clampBoardInspectorPan(entry)
    }
  }

}, { passive: false })

// Zoomlu görünümde sol tuşa basılı tutup sürükleyerek görüntü gezdirilir.
// Ancak rack'ten bir taş/grup zaten taşınıyorsa pointer panelde pan'e dönüşmez;
// aynı zoomlu kamera doğrudan işleme/drop hedefi olarak kalır.
window.addEventListener('pointerdown', event => {
  if (event.button !== 0 || boardInspectorPanState) return

  // Inspector üzerinde başlayan normal pan'i yalnız gerçekten elde/rackte aktif
  // bir taş taşınıyorsa engelle. activeRackDragMode/boardInspectorDragActive gibi
  // frame-sonu bayrakları burada kullanılmaz; onlar bir frame geç temizlenirse
  // panel pan'i yanlışlıkla tamamen kilitleyebiliyordu.
  if (state.isDraggingTile || state.isStickyPickup || state.stickyPickupTileId) return
  if (
    event.target === boardInspectorCloseButton ||
    event.target === boardInspectorToggleButton ||
    event.target?.closest?.('#opened-board-mobile-tabs') ||
    event.target?.closest?.('#opened-board-mobile-zoom')
  ) return

  const hit = getBoardInspectorEntryAt(event.clientX, event.clientY)
  if (!hit || (hit.entry.zoomLevel || 0) === 0) return

  const startPan = hit.entry.panOffset.clone()
  const anchor = projectBoardInspectorWorldPoint(
    hit.entry,
    event.clientX,
    event.clientY,
    hit.rect,
    new THREE.Vector3()
  )
  if (!anchor) return

  const captureTarget = event.target?.setPointerCapture ? event.target : null
  try {
    captureTarget?.setPointerCapture?.(event.pointerId)
  } catch {}

  boardInspectorPanState = {
    pointerId: event.pointerId,
    entry: hit.entry,
    anchor,
    startPan,
    captureTarget,
  }

  event.preventDefault()
  event.stopImmediatePropagation()
}, true)

window.addEventListener('pointermove', event => {
  const pan = boardInspectorPanState
  if (!pan || pan.pointerId !== event.pointerId) return

  const rect = pan.entry.frame.getBoundingClientRect()

  // Her move hesabını pan'in başladığı sabit kamera odağından yap. Önceki
  // sürüm her eventte yeni pan'lenmiş kamerayı tekrar referans aldığı için
  // hareket bazı tarayıcılarda sönümleniyor veya hiç başlamıyormuş gibi
  // hissedilebiliyordu.
  pan.entry.panOffset.copy(pan.startPan)
  const current = projectBoardInspectorWorldPoint(
    pan.entry,
    event.clientX,
    event.clientY,
    rect,
    new THREE.Vector3()
  )
  pan.entry.panOffset.copy(pan.startPan)

  if (current) {
    pan.entry.panOffset.x += pan.anchor.x - current.x
    pan.entry.panOffset.z += pan.anchor.z - current.z
    clampBoardInspectorPan(pan.entry)
  }

  event.preventDefault()
  event.stopImmediatePropagation()
}, true)

function finishBoardInspectorPan(event) {
  const pan = boardInspectorPanState
  if (!pan) return
  if (event?.pointerId != null && event.pointerId !== pan.pointerId) return

  try {
    if (pan.captureTarget?.hasPointerCapture?.(pan.pointerId)) {
      pan.captureTarget.releasePointerCapture(pan.pointerId)
    }
  } catch {}

  boardInspectorPanState = null
  event?.preventDefault?.()
  event?.stopImmediatePropagation?.()
}

window.addEventListener('pointerup', finishBoardInspectorPan, true)
window.addEventListener('pointercancel', finishBoardInspectorPan, true)

function getBoardInspectorSeatRadial(seat) {
  switch (seat) {
    case 'player-top': return new THREE.Vector2(0, -1)
    case 'player-left': return new THREE.Vector2(-1, 0)
    case 'player-right': return new THREE.Vector2(1, 0)
    default: return new THREE.Vector2(0, 1)
  }
}

function getBoardInspectorBoundsCorners(bounds) {
  const { min, max } = bounds
  return [
    [min.x, min.y, min.z], [min.x, min.y, max.z],
    [min.x, max.y, min.z], [min.x, max.y, max.z],
    [max.x, min.y, min.z], [max.x, min.y, max.z],
    [max.x, max.y, min.z], [max.x, max.y, max.z],
  ]
}

function getClosestBoardInspectorDistance(bounds, radial, inspectorCamera) {
  if (!bounds || bounds.isEmpty()) return 0.92

  // Tam tepeden bakışta kamera yönü dünya -Y'dir. Ekranın üst tarafını
  // oyuncudan masa merkezine doğru çevirerek her koltukta perler doğal okunur.
  boardInspectorForward.set(0, -1, 0)
  boardInspectorUp.set(-radial.x, 0, -radial.y).normalize()
  boardInspectorRight
    .crossVectors(boardInspectorForward, boardInspectorUp)
    .normalize()

  const tanVertical = Math.tan(THREE.MathUtils.degToRad(inspectorCamera.fov) / 2)
  const tanHorizontal = tanVertical * Math.max(inspectorCamera.aspect, 0.1)
  let requiredDistance = BOARD_INSPECTOR_MIN_DISTANCE

  for (const [x, y, z] of getBoardInspectorBoundsCorners(bounds)) {
    boardInspectorCorner.set(x, y, z)
    boardInspectorRelative.copy(boardInspectorCorner).sub(boardInspectorFocus)

    const cameraX = boardInspectorRelative.dot(boardInspectorRight)
    const cameraY = boardInspectorRelative.dot(boardInspectorUp)
    const forwardOffset = boardInspectorRelative.dot(boardInspectorForward)

    requiredDistance = Math.max(
      requiredDistance,
      Math.abs(cameraX) / Math.max(tanHorizontal, 0.001) - forwardOffset,
      Math.abs(cameraY) / Math.max(tanVertical, 0.001) - forwardOffset
    )
  }

  return THREE.MathUtils.clamp(
    requiredDistance * BOARD_INSPECTOR_FIT_MARGIN + BOARD_INSPECTOR_DISTANCE_PADDING,
    BOARD_INSPECTOR_MIN_DISTANCE,
    BOARD_INSPECTOR_MAX_DISTANCE
  )
}

function updateBoardInspectorCamera(entry) {
  const { seat, camera: inspectorCamera } = entry
  const baseFocus = getOpeningBoardFocusPoint(seat)
  const visibleBounds = getOpeningBoardVisualBounds(seat)

  if (visibleBounds && !visibleBounds.isEmpty()) {
    visibleBounds.getCenter(boardInspectorBoundsCenter)
    boardInspectorFocus.set(
      boardInspectorBoundsCenter.x,
      baseFocus.y,
      boardInspectorBoundsCenter.z
    )
  } else {
    boardInspectorFocus.copy(baseFocus)
  }

  const radial = getBoardInspectorSeatRadial(seat)
  // Fit hesabı her zaman taşların gerçek merkezinde yapılır. Pan yalnız zoomlu
  // inceleme kamerasının odağını taşır; bütün board'u yeniden kadraja sokmaya
  // çalışmaz, aksi halde sürükleyerek gezme etkisi kaybolurdu.
  const fitDistance = getClosestBoardInspectorDistance(
    visibleBounds,
    radial,
    inspectorCamera
  )

  if (entry.panOffset && (entry.zoomLevel || 0) > 0) {
    boardInspectorFocus.add(entry.panOffset)
  }

  const zoomMultiplier = Math.pow(
    BOARD_INSPECTOR_ZOOM_FACTOR,
    THREE.MathUtils.clamp(
      entry.zoomLevel || 0,
      0,
      BOARD_INSPECTOR_MAX_ZOOM_LEVEL
    )
  )
  const distance = Math.max(0.22, fitDistance * zoomMultiplier)

  // Kamera X/Z olarak taşların tam merkezindedir; yalnız Y ekseninden yukarı
  // çıkar. camera.up koltuğa göre döndürülür, böylece tam tepeden bakarken
  // lookAt'in up vektörüyle çakışması ve görüntünün dönmesi engellenir.
  inspectorCamera.up.set(-radial.x, 0, -radial.y).normalize()
  inspectorCamera.position.set(
    boardInspectorFocus.x,
    boardInspectorFocus.y + distance,
    boardInspectorFocus.z
  )
  inspectorCamera.lookAt(boardInspectorFocus)
}

function projectBoardInspectorWorldPoint(entry, clientX, clientY, rect, target) {
  if (!entry || !rect || rect.width <= 1 || rect.height <= 1) return null

  entry.camera.aspect = rect.width / Math.max(rect.height, 1)
  entry.camera.updateProjectionMatrix()
  updateBoardInspectorCamera(entry)
  // Event aynı render frame'i içinde kamera konumunu değiştirebilir. Raycaster
  // eski matrixWorld'ü kullanmasın; cursor-odaklı zoom/pan noktasını hemen
  // yeni kameradan üret.
  entry.camera.updateMatrixWorld(true)

  boardInspectorPointer.x = ((clientX - rect.left) / rect.width) * 2 - 1
  boardInspectorPointer.y = -(((clientY - rect.top) / rect.height) * 2 - 1)
  boardInspectorRaycaster.setFromCamera(boardInspectorPointer, entry.camera)

  const hit = boardInspectorRaycaster.ray.intersectPlane(
    boardInspectorPlane,
    target
  )

  return hit ? target : null
}

function getBoardInspectorProjection(clientX, clientY) {
  if (!boardInspectorPanelOpen) return null

  for (const entry of boardInspectorEntries.values()) {
    const rect = entry.frame.getBoundingClientRect()
    if (rect.width <= 1 || rect.height <= 1) continue
    if (
      clientX < rect.left || clientX > rect.right ||
      clientY < rect.top || clientY > rect.bottom
    ) continue

    // Zoom ve pan dahil, işleme ray'i daima kullanıcının o anda gördüğü
    // inspector kamerasından üretilir. Böylece yakınlaştırılmış görüntüde
    // görülen taş ile server'a gönderilen gerçek masa hedefi birebir kalır.
    const point = projectBoardInspectorWorldPoint(
      entry,
      clientX,
      clientY,
      rect,
      boardInspectorHit
    )
    if (!point) return null

    return { point: point.clone(), seat: entry.seat }
  }

  return null
}

function renderBoardInspector() {
  updateBoardInspectorButton()

  if (
    boardInspectorPanelOpen &&
    boardInspectorRound != null &&
    state.publicGameState?.round != null &&
    boardInspectorRound !== state.publicGameState.round
  ) {
    closeBoardInspector()
  }

  // Kamera konumunu degistirmez; yalnız rakip ilk kez acmaya basladiginda
  // yukaridaki coklu acilan-taslar panelini gorunur hale getirir.
  syncBoardInspectorAutoOpen()
  if (!boardInspectorPanelOpen) return

  syncBoardInspectorEntries()
  if (!boardInspectorPanelOpen) return

  const canvasRect = renderer.domElement.getBoundingClientRect()
  const rendererSize = new THREE.Vector2()
  renderer.getSize(rendererSize)
  const scaleX = rendererSize.x / Math.max(canvasRect.width, 1)
  const scaleY = rendererSize.y / Math.max(canvasRect.height, 1)

  renderer.setScissorTest(true)

  for (const entry of boardInspectorEntries.values()) {
    const rect = entry.frame.getBoundingClientRect()
    if (rect.width <= 1 || rect.height <= 1) continue

    entry.camera.aspect = rect.width / Math.max(rect.height, 1)
    entry.camera.updateProjectionMatrix()
    updateBoardInspectorCamera(entry)

    const x = Math.round((rect.left - canvasRect.left) * scaleX)
    const y = Math.round((canvasRect.bottom - rect.bottom) * scaleY)
    const width = Math.max(1, Math.round(rect.width * scaleX))
    const height = Math.max(1, Math.round(rect.height * scaleY))

    renderer.setScissor(x, y, width, height)
    renderer.setViewport(x, y, width, height)
    renderer.render(scene, entry.camera)
  }

  renderer.setScissorTest(false)
  renderer.setViewport(0, 0, rendererSize.x, rendererSize.y)
}

function isCameraTransitionLocked() {
  // Normal tas/per surukleme kilit degildir; oyuncu peri yukariya tasiyarak
  // kendi acma alanina cikabilmeli. Deste/atik ve sticky pickup kilitlidir.
  return Boolean(
    state.isTableInteracting ||
    state.isStickyPickup
  )
}

function getSeatOffset(seat, offset) {
  const index = SEAT_ORDER.indexOf(seat)

  if (index < 0) return seat

  return SEAT_ORDER[
    (index + offset + SEAT_ORDER.length) % SEAT_ORDER.length
  ]
}

function resetOverviewEdgeTrigger() {
  overviewEdgeDirection = 0
}

function syncOverviewFocusState() {
  state.overviewFocusSeat =
    overviewFocusSeat ||
    state.localSeat ||
    'player-bottom'
}

function resetOverviewFocusToLocal() {
  overviewFocusSeat = state.localSeat || 'player-bottom'
  overviewVectorsInitialized = false
  overviewTopJumpRequested = false
  syncOverviewFocusState()
  resetOverviewEdgeTrigger()
}

function isOverviewNavigationAllowed() {
  if (
    !overviewRequested ||
    overviewProgress < OVERVIEW_FOCUS_SWITCH_MIN_PROGRESS ||
    isCameraTransitionLocked()
  ) {
    return false
  }

  if (!state.isDraggingTile) {
    return true
  }

  // Açmadan önce taş/per başka oyuncunun alanına taşınamaz.
  if (!state.privateHandState?.opened) {
    return false
  }

  // Açtıktan sonra tek taş işleme ve çift işleme sırasında kamera hedefi
  // değişebilir. Yeni normal per açarken odağı kendi board'unda tutuyoruz.
  return (
    state.activeRackDragKind === 'single' ||
    state.activeRackDragKind === 'pair'
  )
}

function getOverviewEdgeDirection() {
  if (!isOverviewNavigationAllowed()) {
    return 0
  }

  const width = Math.max(window.innerWidth, 1)
  const x = THREE.MathUtils.clamp(
    Number.isFinite(state.pointerClientX)
      ? state.pointerClientX
      : width / 2,
    0,
    width
  )

  // Oyuncu degisimi ancak imlec gercek ekran cercevesine dokundugunda olur.
  if (x <= OVERVIEW_EDGE_TOUCH_PX) return -1
  if (x >= width - OVERVIEW_EDGE_TOUCH_PX) return 1
  return 0
}

function hasOverviewEdgeBeenReleased() {
  const width = Math.max(window.innerWidth, 1)
  const x = THREE.MathUtils.clamp(
    Number.isFinite(state.pointerClientX)
      ? state.pointerClientX
      : width / 2,
    0,
    width
  )

  return (
    x >= OVERVIEW_EDGE_RELEASE_PX &&
    x <= width - OVERVIEW_EDGE_RELEASE_PX
  )
}

function stepOverviewFocus(direction) {
  const fromSeat =
    overviewFocusSeat ||
    state.localSeat ||
    'player-bottom'

  overviewFocusSeat = getSeatOffset(fromSeat, direction)
  syncOverviewFocusState()
}

function tryJumpToOppositeFromTop() {
  if (
    !overviewTopJumpRequested ||
    !isOverviewNavigationAllowed() ||
    overviewFocusSeat !== state.localSeat
  ) {
    return false
  }

  overviewFocusSeat = getSeatOffset(state.localSeat, 2)
  overviewTopJumpRequested = false
  syncOverviewFocusState()
  resetOverviewEdgeTrigger()
  return true
}

function updateOverviewFocusFromHeldPointer() {
  if (tryJumpToOppositeFromTop()) {
    return
  }

  // Bir kenar temasi yalniz bir kez oyuncu degistirir. Ayni kenarin tekrar
  // calismasi icin imlec once cerceveden belirgin sekilde ayrilmalidir.
  if (overviewEdgeDirection !== 0) {
    if (hasOverviewEdgeBeenReleased()) {
      resetOverviewEdgeTrigger()
    }
    return
  }

  const direction = getOverviewEdgeDirection()

  if (!direction) return

  overviewEdgeDirection = direction
  stepOverviewFocus(direction)
}

function updateOverviewPlayerLabel() {
  const visible = overviewProgress >= 0.52

  if (!visible) {
    overviewPlayerLabel.style.opacity = '0'
    overviewPlayerLabel.style.transform =
      'translate(-50%, -5px)'
    return
  }

  const seat = overviewFocusSeat || state.localSeat
  const player = state.publicGameState?.players?.find(
    item => item.seat === seat
  )

  overviewPlayerLabel.textContent =
    player?.name ||
    (seat === state.localSeat ? playerName : 'Oyuncu')

  overviewPlayerLabel.style.opacity = '1'
  overviewPlayerLabel.style.transform =
    'translate(-50%, 0)'
}

function canCurrentDragEnterOverview() {
  if (!state.isDraggingTile) {
    return true
  }

  const kind = state.activeRackDragKind

  // Açmadan önce üst masaya yalnız gerçekten açılabilir bir per/çift taşınır.
  // Tek taş veya yarım-per yukarı sürüklenirse kamera rack'i terk etmez.
  if (!state.privateHandState?.opened) {
    return kind === 'meld' || kind === 'pair'
  }

  // Açtıktan sonra yeni per/çift ve tek-taş işleme üst kameraya çıkabilir.
  return kind === 'single' || kind === 'meld' || kind === 'pair'
}

function updateOverviewRequest(pointerY, touchMode = false) {
  if (isCameraTransitionLocked()) {
    overviewRequested = false
    resetOverviewEdgeTrigger()
    return
  }

  const enterRatio = touchMode ? 0.30 : OVERVIEW_ENTER_RATIO
  const exitRatio = touchMode ? 0.82 : OVERVIEW_EXIT_RATIO
  const enterY = window.innerHeight * enterRatio
  const exitY = window.innerHeight * exitRatio

  if (overviewRequested) {
    // Üst kamera aktifken dikey konum kamera yüksekliğini oynatmaz. Yukarı
    // hareket yalnız local board'dan karşı oyuncuya odak isteği üretir;
    // alt 0.88 çıkış eşiği ise ıstakaya dönüşü başlatır.
    if (pointerY >= exitY) {
      overviewRequested = false
      resetOverviewEdgeTrigger()
    }
    return
  }

  // Donus animasyonu devam ederken tekrar ust kamerayi tetiklemiyoruz.
  // Bu, ust tarafta mouse hareketinde gorulen kisa gidip-gelme/bounce'i keser.
  if (
    pointerY <= enterY &&
    overviewProgress <= 0.02 &&
    canCurrentDragEnterOverview()
  ) {
    resetOverviewFocusToLocal()
    overviewRequested = true
  }
}

document.addEventListener('pointermove', event => {
  if (isTouchPointerEvent(event) && !event.isPrimary) return

  state.pointerClientX = event.clientX
  state.pointerClientY = event.clientY

  // Desktop'taki manuel W/S kamera davranışına dokunma. Telefonda ise aktif
  // taş/per parmakla ekranın üstüne taşındığında açma kamerasını otomatik aç;
  // aksi halde kullanıcı sürüklerken ikinci parmakla kamera düğmesine basmak
  // zorunda kalır.
  if (isTouchPointerEvent(event) && state.isDraggingTile) {
    updateOverviewRequest(event.clientY, true)
  }

  // Parmak hareketi uzaktaki avatar gözlerini sürmek için kullanılmıyor.
  // Özellikle taş drag sırasında 20 Hz player-look yayını + DOM/network işi
  // mobilde gereksiz gecikme yaratıyordu. Oyun etkileşimleri canvas handler'ında
  // zaten işlendiği için touch burada güvenle sonlanabilir.
  if (isTouchPointerEvent(event)) {
    return
  }

  // Kamera artık mouse ile kontrol edilmiyor. Pointer yalnız taş etkileşimleri
  // ve diğer oyuncuların göz yönü için kullanılmaya devam eder.
  if (
    state.isTableInteracting ||
    state.isStickyPickup
  ) {
    return
  }

  state.mouseX =
    event.clientX / window.innerWidth - 0.5

  state.mouseY =
    event.clientY / window.innerHeight - 0.5

  const networkX = THREE.MathUtils.clamp(
    state.mouseX * 2,
    -1,
    1
  )

  const networkY = THREE.MathUtils.clamp(
    state.mouseY * 2,
    -1,
    1
  )

  const now = performance.now()

  if (now - state.lastSentLook > 50) {
    state.lastSentLook = now

    socket.emit('player-look', {
      x: networkX,
      y: networkY,
    })
  }
})

function isTypingTarget(target) {
  const tag = target?.tagName?.toLowerCase?.()
  return tag === 'input' || tag === 'textarea' || target?.isContentEditable
}

function getWatchableOpeningSeat() {
  const activeOpeningSeat = state.publicGameState?.activeOpeningSeat || null

  // Açan oyuncuya bakmak tamamen manuel: yalnız D'ye basıldığı anda server'ın
  // aktif açılış koltuğu hedeflenir. Açılış state'i hiçbir zaman kamerayı kendi
  // başına hareket ettirmez.
  if (activeOpeningSeat && activeOpeningSeat !== state.localSeat) {
    return activeOpeningSeat
  }

  return null
}

window.addEventListener('keydown', event => {
  if (isTypingTarget(event.target)) return

  const key = String(event.key || '').toLowerCase()

  if (key === 'escape') {
    closeBoardInspector()
    return
  }

  // W: kendi açma alanın, S: ıstaka, D: yalnız o anda İLK açılışını yapan
  // oyuncunun alanına gider. Açılış başlayınca/bitince otomatik kamera yoktur.
  if (!['w', 's', 'd'].includes(key)) return
  if (isCameraTransitionLocked()) return

  if (key === 's') {
    event.preventDefault()
    overviewRequested = false
    overviewTopJumpRequested = false
    resetOverviewEdgeTrigger()
    return
  }

  if (key === 'd') {
    const activeOpeningSeat = getWatchableOpeningSeat()
    if (!activeOpeningSeat) return
    event.preventDefault()
    overviewFocusSeat = activeOpeningSeat
    overviewRequested = true
    overviewVectorsInitialized = false
    overviewTopJumpRequested = false
    syncOverviewFocusState()
    resetOverviewEdgeTrigger()
    return
  }

  event.preventDefault()
  overviewFocusSeat = state.localSeat || 'player-bottom'
  overviewRequested = true
  overviewVectorsInitialized = false
  overviewTopJumpRequested = false
  syncOverviewFocusState()
  resetOverviewEdgeTrigger()
})

window.addEventListener('okey:mobile-camera', event => {
  if (!isTouchLayout() || isCameraTransitionLocked()) return

  const action = event.detail?.action

  if (action === 'rack') {
    overviewRequested = false
    overviewTopJumpRequested = false
    resetOverviewEdgeTrigger()
    return
  }

  if (action === 'opening') {
    const activeOpeningSeat = getWatchableOpeningSeat()
    if (!activeOpeningSeat) return
    overviewFocusSeat = activeOpeningSeat
  }
  else if (action === 'board') {
    overviewFocusSeat = state.localSeat || 'player-bottom'
  }
  else {
    return
  }

  overviewRequested = true
  overviewVectorsInitialized = false
  overviewTopJumpRequested = false
  syncOverviewFocusState()
  resetOverviewEdgeTrigger()
})

window.addEventListener('blur', () => {
  // Kamera seçimi manuel kalır. Pencere focus kaybı D ile seçilmiş açan oyuncu
  // görünümünü bozmaz; ıstakaya dönüş yalnız kullanıcı S'ye bastığında olur.
  resetOverviewEdgeTrigger()
})

// =====================================================
// OPENING-AREA CAMERA
// =====================================================

function smoothStep01(value) {
  const t = THREE.MathUtils.clamp(value, 0, 1)
  return t * t * (3 - 2 * t)
}

function moveTowards(current, target, maxDelta) {
  if (Math.abs(target - current) <= maxDelta) {
    return target
  }

  return current + Math.sign(target - current) * maxDelta
}

function getOverviewCameraPosition(seat, focusPoint) {
  // Kamera her oyuncunun board'una o oyuncunun dis kenarindan bakar.
  // Bu hem perlerin yazilarini okunur tutar hem de 6 satirin tamamini gosterir.
  const radial = new THREE.Vector2(
    focusPoint.x,
    focusPoint.z
  )

  if (radial.lengthSq() < 0.0001) {
    switch (seat) {
      case 'player-top': radial.set(0, -1); break
      case 'player-left': radial.set(-1, 0); break
      case 'player-right': radial.set(1, 0); break
      default: radial.set(0, 1)
    }
  } else {
    radial.normalize()
  }

  const horizontalDistance =
    Math.cos(OVERVIEW_VIEW_ANGLE) * OVERVIEW_FOCUS_DISTANCE
  const verticalDistance =
    Math.sin(OVERVIEW_VIEW_ANGLE) * OVERVIEW_FOCUS_DISTANCE

  return new THREE.Vector3(
    focusPoint.x + radial.x * horizontalDistance,
    focusPoint.y + verticalDistance,
    focusPoint.z + radial.y * horizontalDistance
  )
}

function ensureOverviewVectors(settings) {
  if (overviewVectorsInitialized) return

  const seat = overviewFocusSeat || state.localSeat
  const focus = getOpeningBoardFocusPoint(seat)
  const position = getOverviewCameraPosition(seat, focus)

  overviewFocusCurrent.copy(focus)
  overviewPositionCurrent.copy(position)
  overviewVectorsInitialized = true
}

function updateCameraOverview(deltaSeconds) {
  const settings = seatCameraSettings[state.localSeat]

  if (!settings) {
    return
  }

  if (isCameraTransitionLocked()) {
    overviewRequested = false
  }

  if (!overviewFocusSeat) {
    overviewFocusSeat = state.localSeat
    syncOverviewFocusState()
  }

  ensureOverviewVectors(settings)

  const targetProgress = overviewRequested ? 1 : 0

  overviewProgress = moveTowards(
    overviewProgress,
    targetProgress,
    deltaSeconds * OVERVIEW_TRANSITION_SPEED
  )

  // Rack -> acma alani drag sistemi bu progress'i kullaniyor.
  state.overviewProgress = overviewProgress

  const eased = smoothStep01(overviewProgress)
  const desiredFocus = getOpeningBoardFocusPoint(
    overviewFocusSeat
  )
  const desiredOverviewPosition = getOverviewCameraPosition(
    overviewFocusSeat,
    desiredFocus
  )

  // Sag/sol oyuncuya geciste hem bakis hedefi hem kamera konumu kayarak gider;
  // orta bolge bunlari degistirmedigi icin secilen oyuncuda kalir.
  const focusAlpha =
    1 - Math.exp(-deltaSeconds * OVERVIEW_FOCUS_DAMPING)
  const positionAlpha =
    1 - Math.exp(-deltaSeconds * OVERVIEW_POSITION_DAMPING)

  overviewFocusCurrent.lerp(desiredFocus, focusAlpha)
  overviewPositionCurrent.lerp(
    desiredOverviewPosition,
    positionAlpha
  )

  const seatedPosition = settings.position

  // Eski "yukariya yay" hissini koruyoruz. Son noktada extra lift sifir,
  // dolayisiyla gercek 70 derece ve yakin framing bozulmuyor.
  camera.position.lerpVectors(
    seatedPosition,
    overviewPositionCurrent,
    eased
  )
  camera.position.y +=
    Math.sin(Math.PI * eased) * OVERVIEW_ARC_LIFT

  // Normal ıstaka konumunda eski masa merkezine bak; ust moda cikarken hedef
  // kendi/sol/sag oyuncunun gercek 78-slot merkezine dogru kayar.
  const lookTarget = new THREE.Vector3().lerpVectors(
    getSeatedLookTarget(),
    overviewFocusCurrent,
    eased
  )

  camera.lookAt(lookTarget)

  state.currentYaw = camera.rotation.y
  state.currentPitch = camera.rotation.x

  // Tam ıstakaya donuldugunde bir sonraki ust cikis yeniden kendi board'undan
  // baslar. Sag/sol odak sadece o ust kamera oturumu boyunca yapiskandir.
  if (!overviewRequested && overviewProgress <= 0.001) {
    overviewFocusSeat = state.localSeat
    overviewVectorsInitialized = false
    overviewTopJumpRequested = false
    syncOverviewFocusState()
  }
}

window.addEventListener('okey:transient-visual-reset', () => {
  // Yeni raund / yeni maç / roster resetinde eski overview veya inset kamera
  // görünümü kalmasın. Render bir sonraki frame'de normal yerel rack kamerasına
  // döner; oyun state'ine veya kullanıcı ayarlarına dokunulmaz.
  overviewRequested = false
  overviewProgress = 0
  state.overviewProgress = 0
  resetOverviewFocusToLocal()
  closeBoardInspector()
})

// =====================================================
// RESIZE
// =====================================================

window.addEventListener(
  'resize',
  resizeScene
)

// =====================================================
// ANIMATE
// =====================================================

function animate(now = performance.now()) {
  requestAnimationFrame(animate)

  const gateElapsedMs = now - lastRenderGateTime

  // rAF ekranın VSync ritminde kalır; yalnız render/update işi 60 FPS ile
  // sınırlandırılır. Sabit zaman kovası 60 Hz ekranlarda floating-point
  // yuvarlaması yüzünden frame atlamaz, daha yüksek Hz ekranlarda ise ortalama
  // 60 FPS'i korur. Uzun tab/background duraklamasında birikmiş frame kovası
  // tek seferde tüketilmez.
  if (gateElapsedMs + 0.01 < MIN_RENDER_FRAME_MS) {
    return
  }

  lastRenderGateTime += MIN_RENDER_FRAME_MS
  if (now - lastRenderGateTime > MIN_RENDER_FRAME_MS * 4) {
    lastRenderGateTime = now
  }

  const deltaSeconds = Math.min(
    Math.max((now - lastAnimationTime) / 1000, 0),
    0.05
  )

  lastAnimationTime = now

  updateCameraOverview(deltaSeconds)
  updateOverviewPlayerLabel()
  updateMeldBoardAnimation()

  updateRackInteractionAnimation()
  updateTableInteractionAnimation()
  updateTeaAnimation(now)
  updateMobileUi()

  for (const [id, avatar] of playerAvatars) {
    if (id === state.localPlayerId) {
      avatar.visible = false
      continue
    }

    avatar.visible = true
    updateAvatarEyes(avatar)
  }

  renderer.setScissorTest(false)
  const rendererSize = new THREE.Vector2()
  renderer.getSize(rendererSize)
  renderer.setViewport(0, 0, rendererSize.x, rendererSize.y)

  renderer.render(
    scene,
    camera
  )

  renderBoardInspector()
}

animate()
