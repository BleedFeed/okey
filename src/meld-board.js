import * as THREE from 'three'

import { state } from './state.js'
import { isTouchPointerEvent } from './mobile.js'
import {
  scene,
  camera,
  renderer,
} from './scene.js'
import {
  createTile,
  clearGroup,
} from './tiles.js'
import {
  TILE_WIDTH,
  TILE_HEIGHT,
  TILE_DEPTH,
  TABLE_W,
  TABLE_D,
} from './config.js'

// =====================================================
// TABLE MELD / OPENING BOARD
// =====================================================
//
// Her oyuncunun kendi ıstakası ile ortadaki çekme kulesi arasında
// bağımsız 13 x 7 = 91 slotluk açma alanı vardır.
// 4 oyuncu x 91 = 364 fiziksel slot.
//
// Slotlar koltuğa göre döner; hiçbir oyuncunun occupancy hesabı diğer
// oyuncunun alanıyla paylaşılmaz. Böylece iki oyuncunun açtığı perler
// birbirine karışmaz.
//
// Rack ile board arasındaki bağımlılığı gevşek tutmak için validator/render
// fonksiyonları setup sırasında dışarıdan verilir.

const TABLE_TOP_Y = 1.225
const BOARD_TILE_Y = TABLE_TOP_Y + TILE_DEPTH / 2 + 0.010

export const OPEN_BOARD_COLUMNS = 13
export const OPEN_BOARD_ROWS = 7
export const OPEN_BOARD_SLOTS_PER_PLAYER =
  OPEN_BOARD_COLUMNS * OPEN_BOARD_ROWS

const BOARD_SEATS = [
  'player-bottom',
  'player-right',
  'player-top',
  'player-left',
]

// Masa üzerindeki taşları ıstakadakilerden bağımsız küçültüyoruz.
// Böylece her oyuncunun 91 slotu kendi çeyreğine sığar.
// Açılmış taşlar biraz büyütüldü. 0.63, mevcut 0.145 X slot aralığında
// yan yana taşları çakıştırmadan kullanılabilecek güvenli yakın sınırdır.
const TABLE_TILE_SCALE = 0.63
const PREVIEW_TILE_SCALE = 0.655

const SLOT_STEP_X = 0.145
const SLOT_STEP_Z = 0.250
const SLOT_WIDTH = TILE_WIDTH * TABLE_TILE_SCALE + 0.012
const SLOT_DEPTH = TILE_HEIGHT * TABLE_TILE_SCALE + 0.018

const SLOT_START_X =
  -((OPEN_BOARD_COLUMNS - 1) * SLOT_STEP_X) / 2

// Her board merkezden oyuncunun ıstakasına doğru uzanır.
// İç kenarda çekme kulesi için geniş boşluk, dış kenarda ıstaka için boşluk var.
const BOARD_INNER_Z = 1.16
const BOARD_OUTER_Z =
  BOARD_INNER_Z + (OPEN_BOARD_ROWS - 1) * SLOT_STEP_Z

// Dört board'un köşeleri birbirine değmesin diye hit alanını slotlardan
// çok az büyük tutuyoruz; komşu board'a taşma yok.
const BOARD_HALF_X =
  Math.abs(SLOT_START_X) + SLOT_WIDTH * 0.58
const BOARD_MIN_LOCAL_Z =
  BOARD_INNER_Z - SLOT_DEPTH * 0.58
const BOARD_MAX_LOCAL_Z =
  BOARD_OUTER_Z + SLOT_DEPTH * 0.58

const BOARD_TARGET_MIN_PROGRESS = 0.34

// Rack kamerasinda W'ye basmadan per acarken kullanicinin tam 13x7 board
// dikdortgenini hedeflemesi gerekmez. Pointer istakanin ustunden belirgin
// bicimde yukariya ciktiysa ve ray gercek masa tablasinin icine dusuyorsa,
// bu genel masa bolgesi acma niyeti sayilir. Kenarlara cok yakin raycast
// hatalarini engellemek icin yalnizca ince bir fiziksel masa payi birakilir.
const DIRECT_RACK_TABLE_EDGE_MARGIN = 0.24
// Istakanin ust sirasinda tas dizerken genis merkez-drop alaninin yanlislikla
// acma niyeti sayilmamasi icin ekran-yuksekligi esigi. Pointer ancak ekranin
// ust %57'lik bolgesine ciktiginda merkezden direkt acma devreye girer.
// Daha yukari cikmasi icin bu degeri kucult; daha erken acilmasi icin buyut.
const DIRECT_RACK_OPEN_MAX_SCREEN_Y_RATIO = 0.57

// Çift açma / çift işleme alanında çiftleri 13 sütuna kompakt ama okunaklı
// biçimde dizeriz. Normal perler hâlâ satır başına tek grup olarak ALT ALTA.
const PAIR_START_COLUMNS = [1, 4, 7, 10]

const boardRoot = new THREE.Group()
boardRoot.name = 'openingMeldBoard'
scene.add(boardRoot)

const slotGroup = new THREE.Group()
slotGroup.name = 'openingMeldSlots'
boardRoot.add(slotGroup)

const publicMeldGroup = new THREE.Group()
publicMeldGroup.name = 'publicOpenedMelds'
boardRoot.add(publicMeldGroup)

const localFallbackGroup = new THREE.Group()
localFallbackGroup.name = 'localOpenedMeldFallback'
boardRoot.add(localFallbackGroup)

const stagedMeldGroup = new THREE.Group()
stagedMeldGroup.name = 'stagedOpeningMelds'
boardRoot.add(stagedMeldGroup)

const previewGroup = new THREE.Group()
previewGroup.name = 'openingMeldPreview'
boardRoot.add(previewGroup)

// Per üst kamera moduna taşınırken rack uzayında kaybolmasın.
// Bu iki grup yalnız sürükleme anında masa üstünde yaşayan görsel katmandır:
// - dragGhostGroup: mouse altında gezen gerçek taş görünümü
// - dropHighlightGroup: bırakılacak slotları yumuşak biçimde vurgular
const dragGhostGroup = new THREE.Group()
dragGhostGroup.name = 'openingMeldDragGhost'
boardRoot.add(dragGhostGroup)

const dropHighlightGroup = new THREE.Group()
dropHighlightGroup.name = 'openingMeldDropHighlight'
boardRoot.add(dropHighlightGroup)


// =====================================================
// COORDINATES / ORIENTATION
// =====================================================

function getSeatYaw(seat = state.localSeat) {
  switch (seat) {
    case 'player-top': return Math.PI
    case 'player-left': return -Math.PI / 2
    case 'player-right': return Math.PI / 2
    default: return 0
  }
}

function isBoardSeat(seat) {
  return BOARD_SEATS.includes(seat)
}

function normalizeBoardSeat(seat, fallback = null) {
  return isBoardSeat(seat)
    ? seat
    : (
        isBoardSeat(fallback)
          ? fallback
          : null
      )
}

function localBoardPointToWorld(seat, localX, localZ) {
  const yaw = getSeatYaw(seat)
  const cos = Math.cos(yaw)
  const sin = Math.sin(yaw)

  return {
    x: localX * cos + localZ * sin,
    z: -localX * sin + localZ * cos,
  }
}

// Ust kamera bir oyuncunun acma alanina odaklanirken ayni geometriyi
// kullanabilsin. Board koordinatlarini main.js icinde tekrar etmiyoruz;
// boylece slot araliklari ileride degisse bile kamera gercek 91-slot alaninin
// merkezini takip eder.
export function getOpeningBoardFocusPoint(seat) {
  const normalizedSeat = normalizeBoardSeat(
    seat,
    state.localSeat
  )

  if (!normalizedSeat) {
    return new THREE.Vector3(0, TABLE_TOP_Y, 0)
  }

  const center = localBoardPointToWorld(
    normalizedSeat,
    0,
    (BOARD_INNER_Z + BOARD_OUTER_Z) / 2
  )

  return new THREE.Vector3(
    center.x,
    TABLE_TOP_Y + 0.025,
    center.z
  )
}

// Inspector kamerası boş 13x7 alanı değil, oyuncunun gerçekten masada duran
// açılmış taşlarını kadraja alır. Böylece az per varken kamera gereksiz yere
// uzakta kalmaz; yeni satırlar eklendikçe yalnız gerektiği kadar geri çıkar.
// Dönen Box3 world-space'tedir ve caller tarafından güvenle değiştirilebilir.
export function getOpeningBoardVisualBounds(seat) {
  const normalizedSeat = normalizeBoardSeat(seat)
  if (!normalizedSeat) return null

  boardRoot.updateMatrixWorld(true)

  const bounds = new THREE.Box3()
  const tileBounds = new THREE.Box3()
  let hasVisibleTile = false

  const visibleLayers = [
    publicMeldGroup,
    localFallbackGroup,
    stagedMeldGroup,
  ]

  for (const layer of visibleLayers) {
    for (const holder of layer.children) {
      if (!holder?.userData?.flatTileHolder) continue
      if (normalizeBoardSeat(holder.userData.openBoardOwnerSeat) !== normalizedSeat) {
        continue
      }

      tileBounds.setFromObject(holder)
      if (tileBounds.isEmpty()) continue

      if (!hasVisibleTile) {
        bounds.copy(tileBounds)
        hasVisibleTile = true
      } else {
        bounds.union(tileBounds)
      }
    }
  }

  return hasVisibleTile ? bounds.clone() : null
}

function worldPointToLocalBoard(seat, point) {
  if (!point) return null

  const yaw = getSeatYaw(seat)
  const cos = Math.cos(yaw)
  const sin = Math.sin(yaw)

  return {
    x: point.x * cos - point.z * sin,
    z: point.x * sin + point.z * cos,
  }
}

function getSlotPosition(seat, row, col) {
  const localX = SLOT_START_X + col * SLOT_STEP_X
  const localZ = BOARD_INNER_Z + row * SLOT_STEP_Z

  return localBoardPointToWorld(
    seat,
    localX,
    localZ
  )
}

function isRealJokerTile(tileData) {
  const joker = state.publicGameState?.joker

  return Boolean(
    tileData &&
    joker &&
    tileData.type === 'normal' &&
    tileData.color === joker.color &&
    Number(tileData.number) === Number(joker.number)
  )
}

function createFlatTileHolder(
  tileData,
  x,
  z,
  options = {}
) {
  const ownerSeat = normalizeBoardSeat(
    options.ownerSeat,
    state.localSeat
  )

  const holder = new THREE.Group()
  holder.position.set(
    x,
    options.y ?? BOARD_TILE_Y,
    z
  )
  holder.rotation.y = getSeatYaw(ownerSeat)
  holder.userData.openBoardOwnerSeat = ownerSeat

  const tile = createTile(tileData)
  tile.rotation.x = -Math.PI / 2

  // Gerçek okey masaya açılmış bir per/çift içinde de rack'teki gibi
  // ters dursun; kimliği değişmez, yalnız beyaz arka yüzü görünür.
  if (isRealJokerTile(tileData)) {
    tile.rotation.y = Math.PI
  }

  tile.scale.setScalar(options.scale ?? TABLE_TILE_SCALE)

  holder.add(tile)
  return holder
}

function updateWorldOrientation(group) {
  for (const holder of group.children) {
    if (!holder.userData?.flatTileHolder) continue

    const ownerSeat = normalizeBoardSeat(
      holder.userData.openBoardOwnerSeat,
      state.localSeat
    )

    holder.rotation.y = getSeatYaw(ownerSeat)
  }
}

// =====================================================
// SLOT GRID
// =====================================================

const slotGeometry = new THREE.EdgesGeometry(
  new THREE.PlaneGeometry(SLOT_WIDTH, SLOT_DEPTH)
)

const slotMaterialsBySeat = new Map()

for (const seat of BOARD_SEATS) {
  const seatRoot = new THREE.Group()
  seatRoot.name = `openingSlots-${seat}`
  seatRoot.rotation.y = getSeatYaw(seat)
  slotGroup.add(seatRoot)

  const material = new THREE.LineBasicMaterial({
    color: 0xa8dfc5,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    depthTest: true,
  })

  slotMaterialsBySeat.set(seat, material)

  for (let row = 0; row < OPEN_BOARD_ROWS; row++) {
    for (let col = 0; col < OPEN_BOARD_COLUMNS; col++) {
      const slot = new THREE.LineSegments(
        slotGeometry,
        material
      )

      slot.rotation.x = -Math.PI / 2
      slot.position.set(
        SLOT_START_X + col * SLOT_STEP_X,
        TABLE_TOP_Y + 0.006,
        BOARD_INNER_Z + row * SLOT_STEP_Z
      )

      slot.userData.openBoardSeat = seat
      seatRoot.add(slot)
    }
  }
}

// =====================================================
// PHYSICAL BUTTONS
// =====================================================

const buttonTargets = []

function createButtonTexture(label, fill, textColor = '#ffffff') {
  const canvas = document.createElement('canvas')
  canvas.width = 384
  canvas.height = 192

  const ctx = canvas.getContext('2d')
  ctx.fillStyle = fill
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.strokeStyle = 'rgba(255,255,255,0.55)'
  ctx.lineWidth = 10
  ctx.strokeRect(8, 8, canvas.width - 16, canvas.height - 16)

  ctx.fillStyle = textColor
  ctx.font = 'bold 92px Arial'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(label, canvas.width / 2, canvas.height / 2 + 4)

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

function createPhysicalButton(action, label, fill) {
  const root = new THREE.Group()
  root.position.y = TABLE_TOP_Y + 0.014
  root.userData.openBoardButton = action
  boardRoot.add(root)

  const material = new THREE.MeshBasicMaterial({
    map: createButtonTexture(label, fill),
    transparent: true,
    opacity: 0,
    depthWrite: false,
    side: THREE.DoubleSide,
  })

  const face = new THREE.Mesh(
    new THREE.PlaneGeometry(0.54, 0.27),
    material
  )
  face.rotation.x = -Math.PI / 2
  face.userData.openBoardButton = action
  root.add(face)

  const hitbox = new THREE.Mesh(
    new THREE.BoxGeometry(0.62, 0.16, 0.34),
    new THREE.MeshBasicMaterial({
      transparent: true,
      opacity: 0,
      depthWrite: false,
      depthTest: false,
    })
  )
  hitbox.position.y = 0.06
  hitbox.userData.openBoardButton = action
  root.add(hitbox)

  buttonTargets.push(hitbox)

  return {
    root,
    face,
    material,
  }
}

const openButton = createPhysicalButton(
  'open',
  'AÇ',
  '#176e49'
)

const returnButton = createPhysicalButton(
  'return',
  'GERİ',
  '#8a6024'
)

function positionLocalButtons() {
  const seat = normalizeBoardSeat(state.localSeat)

  if (!seat) {
    openButton.root.visible = false
    returnButton.root.visible = false
    return
  }

  // Son slot sırasından sonra, ıstakadan önce kalan şeride yerleşir.
  const buttonZ = BOARD_OUTER_Z + 0.38
  const openPos = localBoardPointToWorld(seat, 0.42, buttonZ)
  const returnPos = localBoardPointToWorld(seat, -0.42, buttonZ)
  const yaw = getSeatYaw(seat)

  openButton.root.position.set(
    openPos.x,
    TABLE_TOP_Y + 0.014,
    openPos.z
  )
  returnButton.root.position.set(
    returnPos.x,
    TABLE_TOP_Y + 0.014,
    returnPos.z
  )

  openButton.root.rotation.y = yaw
  returnButton.root.rotation.y = yaw
}

// =====================================================
// LOCAL MODULE STATE
// =====================================================

let socketRef = null
let setMessageRef = () => {}
let getHandMapRef = () => new Map()
let validateMeldRef = () => false
let validatePairRef = () => false
let validateOpeningPairRef = () => false
let renderOwnHandRef = () => {}
let openBoardInspectorRef = () => false
let getBoardInspectorProjectionRef = () => null

let currentPreview = null
let previewSignature = ''
let lastGameStateRef = null
let lastHandStateRef = null
let lastRound = null
let lastSeat = null
let publicGroups = []
let publicPlacements = []
const publicOwnerBySignature = new Map()
let openingTimeout = null
let localDraftWasPublished = false
let draftSyncSerial = 0
let pendingRackReturnSlots = []

// Pointer eventleri arasında kamera yayı hareket etmeye devam eder.
// Son mouse koordinatını burada saklayıp ghost'u her frame yeniden hesaplarız;
// böylece kamera yükselirken per ekrandan kaybolmaz veya eski yerde takılı kalmaz.
let activeRackDragVisual = null
let activeSingleLayoffVisual = null
let currentLayoffPreview = null
let layoffRequestInFlight = false
let pairLayoffRequestInFlight = false
let dragGhostSignature = ''
let dropHighlightSignature = ''
let directRackLockedPlacement = null
let directRackLockedDragSignature = ''

function ensureStateContainers() {
  if (!(state.stagedOpenTileIds instanceof Set)) {
    state.stagedOpenTileIds = new Set()
  }

  if (!Array.isArray(state.stagedOpenGroups)) {
    state.stagedOpenGroups = []
  }

  if (!Array.isArray(state.localOpenedFallbackGroups)) {
    state.localOpenedFallbackGroups = []
  }

  if (typeof state.openingInFlight !== 'boolean') {
    state.openingInFlight = false
  }
}

ensureStateContainers()

// =====================================================
// OCCUPANCY / PLACEMENT
// =====================================================

function createEmptyOccupancy() {
  return Array.from(
    { length: OPEN_BOARD_ROWS },
    () => Array(OPEN_BOARD_COLUMNS).fill(false)
  )
}

function markPlacement(occupancy, placement, length, value = true) {
  if (!placement) return

  for (let i = 0; i < length; i++) {
    const col = placement.startCol + i
    if (
      placement.row >= 0 &&
      placement.row < OPEN_BOARD_ROWS &&
      col >= 0 &&
      col < OPEN_BOARD_COLUMNS
    ) {
      occupancy[placement.row][col] = value
    }
  }
}

function isPlacementFree(occupancy, row, startCol, length) {
  if (
    row < 0 ||
    row >= OPEN_BOARD_ROWS ||
    startCol < 0 ||
    startCol + length > OPEN_BOARD_COLUMNS
  ) {
    return false
  }

  for (let i = 0; i < length; i++) {
    if (occupancy[row][startCol + i]) {
      return false
    }
  }

  return true
}

function isRowEmpty(occupancy, row) {
  return Boolean(
    occupancy?.[row] &&
    occupancy[row].every(cell => !cell)
  )
}

function getCenteredStartCol(length) {
  return Math.max(
    0,
    Math.floor((OPEN_BOARD_COLUMNS - length) / 2)
  )
}

function getRowKinds(occupancy, row) {
  return new Set(
    (occupancy?.[row] || []).filter(Boolean)
  )
}

function isPairRowCompatible(occupancy, row) {
  const kinds = getRowKinds(occupancy, row)

  return (
    kinds.size === 0 ||
    (kinds.size === 1 && kinds.has('pair'))
  )
}

function findFirstFreePlacement(length, occupancy, kind = 'meld') {
  if (length <= 0 || length > OPEN_BOARD_COLUMNS) return null

  if (kind === 'pair' && length === 2) {
    for (let row = 0; row < OPEN_BOARD_ROWS; row++) {
      if (!isPairRowCompatible(occupancy, row)) continue

      for (const startCol of PAIR_START_COLUMNS) {
        if (isPlacementFree(occupancy, row, startCol, 2)) {
          return {
            row,
            startCol,
            kind: 'pair',
          }
        }
      }
    }

    return null
  }

  // Normal perler yan yana sıkışmaz: her per kendi yatay satırını kullanır.
  for (let row = 0; row < OPEN_BOARD_ROWS; row++) {
    if (!isRowEmpty(occupancy, row)) continue

    return {
      row,
      startCol: getCenteredStartCol(length),
      kind: 'meld',
    }
  }

  return null
}

function getPublicOccupancy(seat) {
  const ownerSeat = normalizeBoardSeat(seat)
  const occupancy = createEmptyOccupancy()

  if (!ownerSeat) return occupancy

  const localSeat = normalizeBoardSeat(state.localSeat)

  for (let i = 0; i < publicGroups.length; i++) {
    const group = publicGroups[i]
    const placement = publicPlacements[i]

    if (
      normalizeBoardSeat(group.ownerSeat) !== ownerSeat ||
      normalizeBoardSeat(placement?.seat) !== ownerSeat
    ) {
      continue
    }

    // Kendi canlı açılış taslağımız server echo'su ile publicGroups içine de
    // gelir; aynı grup state.stagedOpenGroups içinde zaten yer kaplıyor.
    // İkisini birden occupancy'ye yazarsak her per iki satır tüketir ve
    // açma alanı olduğundan erken dolmuş görünür. Ayrıca
    // normalizeStagedPlacements mevcut perleri gereksiz yere başka satırlara
    // taşır. Yerel pending kopyayı burada tek kez (staged katmanda) sayıyoruz.
    if (
      group.pendingOpening &&
      ownerSeat === localSeat &&
      state.stagedOpenGroups.some(local =>
        local.stageId === group.serverDraftStageId
      )
    ) {
      continue
    }

    markPlacement(occupancy, placement, group.tiles.length, group.kind || 'meld')
  }

  // Sunucu public meld bilgisini henüz yayınlamıyorsa, açılan yerel perleri
  // sadece yerel oyuncunun kendi board'unda geçici olarak tutuyoruz.
  const publicIds = getPublicTileIdSet()

  for (const group of state.localOpenedFallbackGroups) {
    if (group.tileIds.every(id => publicIds.has(id))) continue

    const groupSeat = normalizeBoardSeat(
      group.ownerSeat,
      state.localSeat
    )

    if (groupSeat !== ownerSeat) continue

    markPlacement(
      occupancy,
      group.placement,
      group.tiles.length,
      group.kind || 'meld'
    )
  }

  return occupancy
}

function getFullOccupancy(seat, excludedStageId = null) {
  const ownerSeat = normalizeBoardSeat(seat)
  const occupancy = getPublicOccupancy(ownerSeat)

  if (!ownerSeat) return occupancy

  for (const group of state.stagedOpenGroups) {
    if (group.stageId === excludedStageId) continue

    const groupSeat = normalizeBoardSeat(
      group.ownerSeat,
      state.localSeat
    )

    if (groupSeat !== ownerSeat) continue

    markPlacement(
      occupancy,
      group.placement,
      group.tileIds.length,
      group.kind || 'meld'
    )
  }

  return occupancy
}

function isPointNearBoard(point, seat) {
  const ownerSeat = normalizeBoardSeat(seat)
  if (!point || !ownerSeat) return false

  const local = worldPointToLocalBoard(ownerSeat, point)

  return Boolean(
    local &&
    Math.abs(local.x) <= BOARD_HALF_X &&
    local.z >= BOARD_MIN_LOCAL_Z &&
    local.z <= BOARD_MAX_LOCAL_Z
  )
}

function isPointOnDirectRackOpenTable(point) {
  if (!point) return false

  return Boolean(
    Math.abs(point.x) <= TABLE_W / 2 - DIRECT_RACK_TABLE_EDGE_MARGIN &&
    Math.abs(point.z) <= TABLE_D / 2 - DIRECT_RACK_TABLE_EDGE_MARGIN
  )
}

function isPointerHighEnoughForDirectRackOpen(clientY) {
  const viewportHeight = Math.max(window.innerHeight || 0, 1)
  return clientY <= viewportHeight * DIRECT_RACK_OPEN_MAX_SCREEN_Y_RATIO
}

function findNearestFreePlacement(
  point,
  length,
  seat,
  kind = 'meld'
) {
  const ownerSeat = normalizeBoardSeat(seat)

  if (
    !point ||
    !ownerSeat ||
    length <= 0 ||
    length > OPEN_BOARD_COLUMNS
  ) {
    return null
  }

  const occupancy = getFullOccupancy(ownerSeat)
  const localPoint = worldPointToLocalBoard(ownerSeat, point)

  if (kind === 'pair' && length === 2) {
    let best = null

    for (let row = 0; row < OPEN_BOARD_ROWS; row++) {
      if (!isPairRowCompatible(occupancy, row)) continue

      for (const startCol of PAIR_START_COLUMNS) {
        if (!isPlacementFree(occupancy, row, startCol, 2)) continue

        const first = getSlotPosition(ownerSeat, row, startCol)
        const second = getSlotPosition(ownerSeat, row, startCol + 1)
        const centerX = (first.x + second.x) / 2
        const centerZ = (first.z + second.z) / 2
        const distance =
          (point.x - centerX) ** 2 +
          (point.z - centerZ) ** 2

        if (!best || distance < best.distance) {
          best = {
            seat: ownerSeat,
            row,
            startCol,
            kind: 'pair',
            distance,
          }
        }
      }
    }

    return best
      ? {
          seat: best.seat,
          row: best.row,
          startCol: best.startCol,
          kind: 'pair',
        }
      : null
  }

  const maxStartCol = OPEN_BOARD_COLUMNS - length

  const desiredCenterCol = THREE.MathUtils.clamp(
    Math.round(
      (
        (localPoint?.x ?? 0) -
        SLOT_START_X
      ) /
      SLOT_STEP_X
    ),
    0,
    OPEN_BOARD_COLUMNS - 1
  )

  const desiredStartCol = THREE.MathUtils.clamp(
    Math.round(
      desiredCenterCol -
      (length - 1) / 2
    ),
    0,
    maxStartCol
  )

  let best = null

  for (let row = 0; row < OPEN_BOARD_ROWS; row++) {
    if (!isRowEmpty(occupancy, row)) continue

    const startCol = desiredStartCol
    const first = getSlotPosition(ownerSeat, row, startCol)
    const last = getSlotPosition(
      ownerSeat,
      row,
      startCol + length - 1
    )

    const centerX = (first.x + last.x) / 2
    const centerZ = (first.z + last.z) / 2
    const distance =
      (point.x - centerX) ** 2 +
      (point.z - centerZ) ** 2

    if (!best || distance < best.distance) {
      best = {
        seat: ownerSeat,
        row,
        startCol,
        kind: 'meld',
        distance,
      }
    }
  }

  return best
    ? {
        seat: best.seat,
        row: best.row,
        startCol: best.startCol,
        kind: 'meld',
      }
    : null
}


// Yeni bir per/çift açılırken mouse'un sağ-sol konumu yerleşimi etkilemez.
// Grup her zaman kendi 13 sütunluk açma alanının yatay merkezine yakın,
// uygun ilk boş satıra yerleşir. Böylece masanın sağından/solundan sürüklemek
// yalnızca "açma niyeti"dir; gerçek açma konumunu değiştirmez.
function findCenteredFreePlacement(length, seat, kind = 'meld') {
  const ownerSeat = normalizeBoardSeat(seat)

  if (
    !ownerSeat ||
    length <= 0 ||
    length > OPEN_BOARD_COLUMNS
  ) {
    return null
  }

  const occupancy = getFullOccupancy(ownerSeat)

  if (kind === 'pair' && length === 2) {
    const boardCenterCol = (OPEN_BOARD_COLUMNS - 1) / 2
    const centeredPairStarts = [...PAIR_START_COLUMNS].sort((a, b) => {
      const aCenter = a + 0.5
      const bCenter = b + 0.5
      return (
        Math.abs(aCenter - boardCenterCol) -
        Math.abs(bCenter - boardCenterCol)
      )
    })

    for (let row = 0; row < OPEN_BOARD_ROWS; row++) {
      if (!isPairRowCompatible(occupancy, row)) continue

      for (const startCol of centeredPairStarts) {
        if (!isPlacementFree(occupancy, row, startCol, 2)) continue

        return {
          seat: ownerSeat,
          row,
          startCol,
          kind: 'pair',
        }
      }
    }

    return null
  }

  const maxStartCol = OPEN_BOARD_COLUMNS - length
  const centeredStartCol = THREE.MathUtils.clamp(
    Math.round((OPEN_BOARD_COLUMNS - length) / 2),
    0,
    maxStartCol
  )

  for (let row = 0; row < OPEN_BOARD_ROWS; row++) {
    if (!isRowEmpty(occupancy, row)) continue
    if (!isPlacementFree(occupancy, row, centeredStartCol, length)) continue

    return {
      seat: ownerSeat,
      row,
      startCol: centeredStartCol,
      kind: 'meld',
    }
  }

  return null
}

// =====================================================
// RAYCAST
// =====================================================

const raycaster = new THREE.Raycaster()
const pointer = new THREE.Vector2()
const tablePlane = new THREE.Plane(
  new THREE.Vector3(0, 1, 0),
  -(TABLE_TOP_Y + 0.01)
)
const tableIntersection = new THREE.Vector3()

function updatePointerFromClient(clientX, clientY) {
  const rect = renderer.domElement.getBoundingClientRect()

  pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1
  pointer.y = -(((clientY - rect.top) / rect.height) * 2 - 1)
}

function getTablePointFromClient(clientX, clientY) {
  updatePointerFromClient(clientX, clientY)
  raycaster.setFromCamera(pointer, camera)

  const hit = raycaster.ray.intersectPlane(
    tablePlane,
    tableIntersection
  )

  return hit ? tableIntersection.clone() : null
}

function getBoardInteractionProjection(clientX, clientY) {
  const inspector = getBoardInspectorProjectionRef?.(clientX, clientY)

  // Inspector zoom 0 dışında sadece inceleme modundadır. Bu durumda ana
  // kameranın masa raycast'ine düşmek, kullanıcının zoomlu panelin altındaki
  // yanlış yere taş işlemesine yol açardı; projection burada kesin kesilir.
  if (inspector?.blocked) {
    return {
      point: null,
      forcedSeat: normalizeBoardSeat(inspector.seat),
      viaInspector: true,
      blocked: true,
    }
  }

  if (inspector?.point && normalizeBoardSeat(inspector.seat)) {
    return {
      point: inspector.point,
      forcedSeat: normalizeBoardSeat(inspector.seat),
      viaInspector: true,
    }
  }

  const point = getTablePointFromClient(clientX, clientY)
  return point
    ? { point, forcedSeat: null, viaInspector: false }
    : null
}

// =====================================================
// TILE / GROUP NORMALIZATION
// =====================================================

function tileIdentity(tile) {
  if (!tile) return null
  return tile.id ?? tile.tileId ?? null
}

function looksLikeTile(value) {
  return Boolean(
    value &&
    typeof value === 'object' &&
    (
      value.id != null ||
      value.tileId != null
    ) &&
    (
      value.number != null ||
      value.type === 'fake-joker' ||
      value.color != null
    )
  )
}

function buildPublicTileLookup(gameState) {
  const lookup = new Map()
  const visited = new Set()

  function walk(value, depth = 0) {
    if (!value || depth > 7) return

    if (typeof value === 'object') {
      if (visited.has(value)) return
      visited.add(value)
    }

    if (Array.isArray(value)) {
      for (const item of value) walk(item, depth + 1)
      return
    }

    if (typeof value !== 'object') return

    if (looksLikeTile(value)) {
      const id = tileIdentity(value)
      if (id != null) lookup.set(id, value)
    }

    for (const child of Object.values(value)) {
      if (child && typeof child === 'object') {
        walk(child, depth + 1)
      }
    }
  }

  walk(gameState)
  return lookup
}

function resolveTile(value, lookup) {
  if (looksLikeTile(value)) return value

  const id =
    typeof value === 'string' || typeof value === 'number'
      ? value
      : value?.id ?? value?.tileId

  return id != null ? lookup.get(id) || null : null
}

function getGroupTileSource(value) {
  if (Array.isArray(value)) return value
  if (!value || typeof value !== 'object') return null

  return (
    value.tiles ||
    value.meld ||
    value.group ||
    value.pair ||
    value.tileIds ||
    null
  )
}

function appendGroupsFromValue(target, value, ownerSeat, lookup) {
  if (!value) return

  if (Array.isArray(value)) {
    if (value.length === 0) return

    // Doğrudan taş listesi ise tek bir grup.
    const directTiles = value
      .map(item => resolveTile(item, lookup))
      .filter(Boolean)

    if (directTiles.length === value.length && directTiles.length >= 2) {
      target.push({
        tiles: directTiles,
        ownerSeat,
      })
      return
    }

    // Aksi halde grup listesi.
    for (const item of value) {
      appendGroupsFromValue(target, item, ownerSeat, lookup)
    }

    return
  }

  if (typeof value !== 'object') return

  const nestedOwner =
    value.ownerSeat ||
    value.seat ||
    value.playerSeat ||
    ownerSeat ||
    null

  const tileSource = getGroupTileSource(value)

  if (tileSource) {
    const tiles = tileSource
      .map(item => resolveTile(item, lookup))
      .filter(Boolean)

    if (tiles.length === tileSource.length && tiles.length >= 2) {
      target.push({
        tiles,
        ownerSeat: nestedOwner,
      })
    }

    return
  }

  // seat -> groups gibi map formatlarını da destekle.
  for (const [key, child] of Object.entries(value)) {
    const seat = key.startsWith('player-') ? key : nestedOwner
    appendGroupsFromValue(target, child, seat, lookup)
  }
}

function extractPublicGroups(gameState) {
  if (!gameState) return []

  const lookup = buildPublicTileLookup(gameState)
  const result = []

  // Layoff event'i server tarafında tableMelds index'i ile çalışıyor.
  // Ayrıca server'ın type/meta bilgisini de taşıyoruz; client böylece jokerli
  // perlerde "işler" önizlemesini server ile aynı sabit joker atamasıyla yapar.
  const serverMeldInfoBySignature = new Map()

  ;(gameState.tableMelds || []).forEach((meld, index) => {
    const source = getGroupTileSource(meld)
    if (!Array.isArray(source)) return

    const ids = source
      .map(item => resolveTile(item, lookup))
      .filter(Boolean)
      .map(tile => tileIdentity(tile))
      .filter(id => id != null)

    if (ids.length !== source.length) return

    serverMeldInfoBySignature.set(
      [...ids].sort().join('|'),
      {
        index,
        type: meld.type || null,
        meta: meld.meta || null,
      }
    )
  })

  const serverPairInfoBySignature = new Map()

  ;(gameState.pairOpens || []).forEach((pairOpen, pairOpenIndex) => {
    ;(pairOpen?.pairs || []).forEach((pair, pairIndex) => {
      const tiles = (pair || [])
        .map(item => resolveTile(item, lookup))
        .filter(Boolean)

      if (tiles.length !== 2) return

      const key = tiles
        .map(tile => tileIdentity(tile))
        .filter(id => id != null)
        .sort()
        .join('|')

      if (!key) return

      serverPairInfoBySignature.set(key, {
        pairOpenIndex,
        pairIndex,
        ownerSeat: pairOpen.ownerSeat || null,
      })
    })
  })

  // Discard anına kadar commit edilmemiş ama artık herkese açık olan taşlar.
  // Placement server tarafından yalnız görsel bilgi olarak echo edilir.
  for (const draft of gameState.openingDrafts || []) {
    const tiles = (draft?.tiles || [])
      .map(item => resolveTile(item, lookup))
      .filter(Boolean)

    if (tiles.length !== (draft?.tiles || []).length || tiles.length < 2) {
      continue
    }

    result.push({
      tiles,
      ownerSeat: draft.ownerSeat || null,
      kind: draft.kind || (tiles.length === 2 ? 'pair' : 'meld'),
      pendingOpening: true,
      publicPlacement: draft.placement || null,
      serverDraftStageId: draft.stageId || null,
      meldType: draft.meldType || null,
      meldMeta: draft.meldMeta || null,
    })
  }

  const globalCandidates = [
    gameState.openedMelds,
    gameState.openMelds,
    gameState.tableMelds,
    gameState.melds,
    gameState.pairOpens,
    gameState.openedPairs,
    gameState.tablePairs,
  ]

  for (const candidate of globalCandidates) {
    appendGroupsFromValue(result, candidate, null, lookup)
  }

  for (const player of gameState.players || []) {
    const candidates = [
      player.openedMelds,
      player.openMelds,
      player.tableMelds,
      player.melds,
      player.openedPairs,
      player.pairs,
    ]

    for (const candidate of candidates) {
      appendGroupsFromValue(result, candidate, player.seat, lookup)
    }
  }

  // Aynı grup hem global hem player altında yayınlanıyorsa iki kez çizme.
  // Global kopyada ownerSeat olmayabilir; player altındaki kopya koltuğu
  // biliyorsa onu tercih et. Dört ayrı board için owner bilgisi kritik.
  const dedupedByKey = new Map()

  for (const group of result) {
    const ids = group.tiles
      .map(tile => tileIdentity(tile))
      .filter(id => id != null)

    if (ids.length !== group.tiles.length) continue

    const key = [...ids].sort().join('|')
    if (!key) continue

    const explicitOwner = normalizeBoardSeat(group.ownerSeat)
    const rememberedOwner = publicOwnerBySignature.get(key) || null
    const ownerSeat = explicitOwner || rememberedOwner

    if (explicitOwner) {
      publicOwnerBySignature.set(key, explicitOwner)
    }

    const serverMeldInfo =
      serverMeldInfoBySignature.get(key) || null
    const serverMeldIndex =
      Number.isInteger(serverMeldInfo?.index)
        ? serverMeldInfo.index
        : null

    const pairInfo = serverPairInfoBySignature.get(key) || null

    const normalized = {
      ...group,
      ownerSeat: ownerSeat || pairInfo?.ownerSeat || null,
      tileIds: ids,
      serverMeldIndex,
      serverPairOpenIndex: Number.isInteger(pairInfo?.pairOpenIndex)
        ? pairInfo.pairOpenIndex
        : null,
      serverPairIndex: Number.isInteger(pairInfo?.pairIndex)
        ? pairInfo.pairIndex
        : null,
      meldType: group.meldType || serverMeldInfo?.type || null,
      meldMeta: group.meldMeta || serverMeldInfo?.meta || null,
      kind:
        group.kind ||
        (Number.isInteger(serverMeldIndex)
          ? 'meld'
          : (ids.length === 2 ? 'pair' : 'meld')),
      pendingOpening: Boolean(group.pendingOpening),
      publicPlacement: group.publicPlacement || null,
    }

    const previous = dedupedByKey.get(key)

    if (
      !previous ||
      (
        !normalizeBoardSeat(previous.ownerSeat) &&
        normalizeBoardSeat(normalized.ownerSeat)
      )
    ) {
      dedupedByKey.set(key, normalized)
    }
  }

  return [...dedupedByKey.values()]
}

function getPublicTileIdSet(options = {}) {
  const ids = new Set()
  const excludeLocalPending = Boolean(options.excludeLocalPending)

  for (const group of publicGroups) {
    // Yerel oyuncunun canlı taslağını kendi staged katmanında bırakıyoruz;
    // böylece AÇ/GERİ butonu olmadan gruba tıklayıp ıstakaya geri alabilir.
    if (
      excludeLocalPending &&
      group.pendingOpening &&
      normalizeBoardSeat(group.ownerSeat) === normalizeBoardSeat(state.localSeat)
    ) {
      continue
    }

    // Owner bilinmeyen global grup dört ayrı board'dan hiçbirine güvenle
    // yerleştirilemez; bu yüzden local fallback/staging kopyasını da gizlemesin.
    if (!normalizeBoardSeat(group.ownerSeat)) continue

    for (const tile of group.tiles) {
      const id = tileIdentity(tile)
      if (id != null) ids.add(id)
    }
  }

  return ids
}

// =====================================================
// RENDER GROUPS
// =====================================================

function addGroupTiles(
  target,
  tiles,
  placement,
  options = {}
) {
  const ownerSeat = normalizeBoardSeat(
    options.ownerSeat || placement?.seat,
    state.localSeat
  )

  if (!placement || !ownerSeat) return

  tiles.forEach((tileData, index) => {
    const slot = getSlotPosition(
      ownerSeat,
      placement.row,
      placement.startCol + index
    )

    const holder = createFlatTileHolder(
      tileData,
      slot.x,
      slot.z,
      {
        ...options,
        ownerSeat,
      }
    )

    holder.userData.flatTileHolder = true

    if (options.stageId) {
      holder.userData.openStageGroupId = options.stageId
      holder.traverse(child => {
        child.userData.openStageGroupId = options.stageId
      })
    }

    target.add(holder)
  })
}

function layoutPublicGroups() {
  const occupancyBySeat = new Map(
    BOARD_SEATS.map(seat => [seat, createEmptyOccupancy()])
  )

  publicPlacements = []

  for (const group of publicGroups) {
    const ownerSeat = normalizeBoardSeat(group.ownerSeat)

    // Owner bilgisi olmayan global bir grubu rastgele bir oyuncunun alanına
    // koymak iki oyuncunun perlerini karıştırmaktan daha kötüdür. Sunucu
    // ownerSeat/player.seat yayınladığında otomatik olarak doğru alana gelir.
    if (!ownerSeat) {
      publicPlacements.push(null)
      continue
    }

    const occupancy = occupancyBySeat.get(ownerSeat)
    const requested = group.publicPlacement
    const requestedKind = group.kind || 'meld'
    const requestedValid = Boolean(
      requested &&
      Number.isInteger(Number(requested.row)) &&
      Number.isInteger(Number(requested.startCol)) &&
      isPlacementFree(
        occupancy,
        Number(requested.row),
        Number(requested.startCol),
        group.tiles.length
      ) &&
      (
        requestedKind !== 'pair' ||
        isPairRowCompatible(occupancy, Number(requested.row))
      )
    )

    const placement = requestedValid
      ? {
          row: Number(requested.row),
          startCol: Number(requested.startCol),
          kind: requestedKind,
        }
      : findFirstFreePlacement(
          group.tiles.length,
          occupancy,
          requestedKind
        )

    const seatedPlacement = placement
      ? {
          ...placement,
          seat: ownerSeat,
        }
      : null

    publicPlacements.push(seatedPlacement)

    if (seatedPlacement) {
      markPlacement(
        occupancy,
        seatedPlacement,
        group.tiles.length,
        group.kind || 'meld'
      )
    }
  }
}

function renderPublicGroups() {
  clearGroup(publicMeldGroup)
  layoutPublicGroups()

  publicGroups.forEach((group, index) => {
    const ownerSeat = normalizeBoardSeat(group.ownerSeat)
    const placement = publicPlacements[index]

    if (!ownerSeat || !placement) return

    // Kendi canlı taslağımız local staged katmanında kalır (geri alma için
    // tıklanabilir). Diğer üç client aynı grubu public katmanda görür.
    if (
      group.pendingOpening &&
      ownerSeat === normalizeBoardSeat(state.localSeat) &&
      state.stagedOpenGroups.some(local =>
        local.stageId === group.serverDraftStageId
      )
    ) {
      return
    }

    addGroupTiles(
      publicMeldGroup,
      group.tiles,
      placement,
      {
        ownerSeat,
      }
    )
  })
}

function renderFallbackGroups() {
  clearGroup(localFallbackGroup)

  const publicIds = getPublicTileIdSet()

  for (const group of state.localOpenedFallbackGroups) {
    if (group.tileIds.every(id => publicIds.has(id))) continue

    const ownerSeat = normalizeBoardSeat(
      group.ownerSeat,
      state.localSeat
    )

    if (!ownerSeat) continue

    addGroupTiles(
      localFallbackGroup,
      group.tiles,
      group.placement,
      {
        ownerSeat,
      }
    )
  }
}

function renderStagedGroups() {
  clearGroup(stagedMeldGroup)

  const publicIds = getPublicTileIdSet({
    excludeLocalPending: true,
  })

  for (const group of state.stagedOpenGroups) {
    // Commit edilmiş public kopya varsa staging'i gizle; fakat server'a canlı
    // yayınlanan kendi pending taslağımız tıklanabilir staged katmanda kalır.
    if (group.tileIds.every(id => publicIds.has(id))) continue

    const ownerSeat = normalizeBoardSeat(
      group.ownerSeat,
      state.localSeat
    )

    if (!ownerSeat) continue

    addGroupTiles(
      stagedMeldGroup,
      group.tiles,
      group.placement,
      {
        stageId: group.stageId,
        ownerSeat,
        scale: TABLE_TILE_SCALE,
      }
    )
  }
}

function renderAllBoardGroups() {
  renderPublicGroups()
  renderFallbackGroups()
  renderStagedGroups()
}

// =====================================================
// PREVIEW / DRAG GHOST
// =====================================================

function clearDropHighlights() {
  dropHighlightSignature = ''
  clearGroup(dropHighlightGroup)
}

function clearDragGhost() {
  dragGhostSignature = ''
  clearGroup(dragGhostGroup)
}

function clearPreview({ keepDragSource = false } = {}) {
  currentPreview = null
  directRackLockedPlacement = null
  directRackLockedDragSignature = ''
  previewSignature = ''
  clearGroup(previewGroup)
  clearDropHighlights()

  clearDragGhost()

  if (!keepDragSource) {
    activeRackDragVisual = null
  }
}

function renderPlacementHighlights(
  placement,
  length,
  options = {}
) {
  if (!placement || length <= 0) {
    clearDropHighlights()
    return
  }

  const color = options.color ?? 0x78f0bd
  const opacity = options.opacity ?? 0.28
  const signature = [
    placement.seat || '',
    placement.row,
    placement.startCol,
    length,
    color,
  ].join(':')

  if (signature === dropHighlightSignature) {
    return
  }

  clearDropHighlights()
  dropHighlightSignature = signature

  for (let index = 0; index < length; index++) {
    const slot = getSlotPosition(
      placement.seat,
      placement.row,
      placement.startCol + index
    )

    const marker = new THREE.Mesh(
      new THREE.PlaneGeometry(
        SLOT_WIDTH * 0.94,
        SLOT_DEPTH * 0.94
      ),
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity,
        depthWrite: false,
        depthTest: true,
        side: THREE.DoubleSide,
      })
    )

    marker.rotation.x = -Math.PI / 2
    marker.rotation.z = -getSeatYaw(placement.seat)
    marker.position.set(
      slot.x,
      TABLE_TOP_Y + 0.018,
      slot.z
    )
    marker.renderOrder = 71
    dropHighlightGroup.add(marker)
  }
}

function renderPreview(
  tiles,
  placement,
  kind,
  options = {}
) {
  const signature = [
    kind,
    options.intent || 'stage',
    placement.seat || '',
    placement.row,
    placement.startCol,
    ...tiles.map(tile => tileIdentity(tile)),
  ].join(':')

  renderPlacementHighlights(
    placement,
    tiles.length,
    {
      color:
        options.intent === 'pair-layoff'
          ? 0xf2d27a
          : 0x78f0bd,
      opacity:
        options.intent === 'pair-layoff'
          ? 0.34
          : 0.28,
    }
  )

  if (signature === previewSignature) {
    return
  }

  previewSignature = signature
  clearGroup(previewGroup)
  clearDragGhost()

  addGroupTiles(
    previewGroup,
    tiles,
    placement,
    {
      y: BOARD_TILE_Y + 0.052,
      scale: PREVIEW_TILE_SCALE,
    }
  )

  // Snap olduğunda taşlar tam opak kalsın; hafifçe yukarı kaldırılmış gerçek
  // taş görüntüsü, tel-kafes/şeffaf hayaletten daha okunaklıdır.
  previewGroup.traverse(child => {
    child.renderOrder = Math.max(child.renderOrder || 0, 72)
  })
}

function getWorldOffsetForSeat(seat, localX, localZ = 0) {
  return localBoardPointToWorld(seat, localX, localZ)
}

function renderFreeDragGhost(tiles, point, ownerSeat, kind) {
  if (!point || !ownerSeat || tiles.length === 0) {
    clearDragGhost()
    return
  }

  const signature = [
    kind,
    ownerSeat,
    ...tiles.map(tile => tileIdentity(tile)),
  ].join(':')

  // Kamera hareket ederken yalnız holder pozisyonlarını güncellemek yeterli;
  // tile geometrisini her frame yeniden üretmeyiz.
  if (signature !== dragGhostSignature) {
    dragGhostSignature = signature
    clearGroup(dragGhostGroup)

    const totalWidth = (tiles.length - 1) * SLOT_STEP_X
    const startOffset = -totalWidth / 2

    tiles.forEach((tileData, index) => {
      const holder = createFlatTileHolder(
        tileData,
        0,
        0,
        {
          ownerSeat,
          y: BOARD_TILE_Y + 0.085,
          scale: PREVIEW_TILE_SCALE * 1.04,
        }
      )

      holder.userData.dragGhostOffsetX =
        startOffset + index * SLOT_STEP_X
      holder.userData.flatTileHolder = true
      holder.renderOrder = 74
      dragGhostGroup.add(holder)
    })
  }

  for (const holder of dragGhostGroup.children) {
    if (!holder.userData?.flatTileHolder) continue

    const offset = getWorldOffsetForSeat(
      ownerSeat,
      holder.userData.dragGhostOffsetX || 0,
      0
    )

    holder.position.set(
      point.x + offset.x,
      BOARD_TILE_Y + 0.085,
      point.z + offset.z
    )
    holder.rotation.y = getSeatYaw(ownerSeat)
  }

  // Taşların altında tek parça, çok hafif bir gölge pedi. Üst kamerada grubun
  // mouse ile ilişkisini netleştirir ama masayı kapatmaz.
  let shadow = dragGhostGroup.getObjectByName('dragGhostShadow')
  if (!shadow) {
    shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(
        Math.max(SLOT_WIDTH, (tiles.length - 1) * SLOT_STEP_X + SLOT_WIDTH) * 1.05,
        SLOT_DEPTH * 1.12
      ),
      new THREE.MeshBasicMaterial({
        color: 0x081713,
        transparent: true,
        opacity: 0.22,
        depthWrite: false,
        depthTest: true,
        side: THREE.DoubleSide,
      })
    )
    shadow.name = 'dragGhostShadow'
    shadow.rotation.x = -Math.PI / 2
    shadow.renderOrder = 70
    dragGhostGroup.add(shadow)
  }

  shadow.position.set(
    point.x,
    TABLE_TOP_Y + 0.020,
    point.z
  )
  shadow.rotation.z = -getSeatYaw(ownerSeat)
}

function setBoardDragResult(captured, ready) {
  state.openBoardDragCaptured = Boolean(captured)
  state.openBoardDragReady = Boolean(ready)

  return {
    captured: Boolean(captured),
    ready: Boolean(ready),
  }
}

function getFocusedBoardSeat() {
  return normalizeBoardSeat(
    state.overviewFocusSeat,
    state.localSeat
  )
}

function getPairOpenedSeats() {
  return (state.publicGameState?.players || [])
    .filter(
      player =>
        player?.opened &&
        player?.openType === 'pairs' &&
        normalizeBoardSeat(player.seat)
    )
    .map(player => player.seat)
}

function getPlacementCenter(placement, length) {
  if (!placement || length <= 0) return null

  const first = getSlotPosition(
    placement.seat,
    placement.row,
    placement.startCol
  )
  const last = getSlotPosition(
    placement.seat,
    placement.row,
    placement.startCol + length - 1
  )

  return {
    x: (first.x + last.x) / 2,
    z: (first.z + last.z) / 2,
  }
}

function canLocalUseTableThisTurn() {
  const gameState = state.publicGameState
  const handState = state.privateHandState

  return Boolean(
    gameState?.phase === 'playing' &&
    gameState?.currentSeat === state.localSeat &&
    handState?.turnHasAcquiredTile
  )
}

function canLocalProcessTable() {
  const handState = state.privateHandState
  return Boolean(
    canLocalUseTableThisTurn() &&
    (handState?.opened || handState?.openingDraftReady)
  )
}

function findPairLayoffTarget(point, tiles, forcedSeat = null) {
  if (
    !point ||
    pairLayoffRequestInFlight ||
    !canLocalProcessTable() ||
    !validatePairRef(tiles)
  ) {
    return null
  }

  let best = null

  for (const seat of getPairOpenedSeats()) {
    if (forcedSeat && seat !== forcedSeat) continue
    if (!isPointNearBoard(point, seat)) continue

    const placement = findNearestFreePlacement(
      point,
      2,
      seat,
      'pair'
    )

    if (!placement) continue

    const center = getPlacementCenter(placement, 2)
    if (!center) continue

    const distance = Math.hypot(
      point.x - center.x,
      point.z - center.z
    )

    if (!best || distance < best.distance) {
      best = {
        targetSeat: seat,
        placement,
        distance,
      }
    }
  }

  return best
}

function canStageGroupOnOwnBoard(kind) {
  const handState = state.privateHandState

  if (!handState?.opened) {
    if (!handState?.turnHasAcquiredTile) return false
    return kind === 'meld' || kind === 'pair'
  }

  if (handState.openType === 'normal') {
    return kind === 'meld'
  }

  // Çifte açmış oyuncunun sonraki çiftleri "çift işleme" yolundan direkt
  // kendi/başka çift açan oyuncunun alanına bırakılır.
  return false
}

function refreshActiveRackDragVisual() {
  if (!activeRackDragVisual) {
    return setBoardDragResult(false, false)
  }

  const progress = THREE.MathUtils.clamp(
    state.overviewProgress || 0,
    0,
    1
  )

  const {
    tileIds,
    clientX,
    clientY,
  } = activeRackDragVisual

  const inspectorProjection = getBoardInspectorProjectionRef?.(clientX, clientY)
  const usingInspector = Boolean(
    inspectorProjection?.point &&
    normalizeBoardSeat(inspectorProjection.seat)
  )

  const ghostThreshold = 0.10
  const directRackView = !usingInspector && progress < ghostThreshold

  const ids = [...new Set(tileIds)]
  const handMap = getHandMapRef()
  const tiles = ids.map(id => handMap.get(id)).filter(Boolean)
  const ownerSeat = normalizeBoardSeat(state.localSeat)

  if (
    !ownerSeat ||
    ids.length < 2 ||
    ids.length > OPEN_BOARD_COLUMNS ||
    tiles.length !== ids.length ||
    ids.some(id => state.stagedOpenTileIds.has(id))
  ) {
    clearPreview({ keepDragSource: true })
    return setBoardDragResult(false, false)
  }

  const kind = getGroupKind(tiles)

  if (!kind) {
    clearPreview({ keepDragSource: true })
    return setBoardDragResult(false, false)
  }

  // Sıra bizde değilse veya bu tur henüz taş çekip/yandan alıp gerçek masa
  // aksiyonu hakkı kazanmadıysak board drag sistemi hiç devreye girmez.
  // Böylece geçerli bir per masanın üzerinde gezdirilse bile ghost/slot
  // önizlemesi oluşmaz; taşlar normal ıstaka sürüklemesi olarak kalır.
  if (!canLocalUseTableThisTurn()) {
    clearPreview({ keepDragSource: true })
    state.boardInspectorDragActive = false
    return setBoardDragResult(false, false)
  }

  const projection = getBoardInteractionProjection(clientX, clientY)
  const point = projection?.point || null
  const inspectorSeat = projection?.viaInspector
    ? projection.forcedSeat
    : null

  if (!point) {
    clearPreview({ keepDragSource: true })
    state.boardInspectorDragActive = false
    return setBoardDragResult(false, false)
  }

  state.boardInspectorDragActive = Boolean(projection?.viaInspector)

  // Rack kamerasında W'ye basmadan açma:
  // Pointer ıstakanın üstünden yeterince yukarı çıkıp gerçek masa tablasına
  // girdiğinde açma niyeti kabul edilir. Sağ/sol konum yalnız niyeti belirler;
  // perin gerçek yerleşimi aşağıda kendi board'unun merkezine sabitlenir.
  const directRackTableOpenTarget = Boolean(
    directRackView &&
    !projection?.viaInspector &&
    isPointerHighEnoughForDirectRackOpen(clientY) &&
    isPointOnDirectRackOpenTable(point)
  )

  const directRackOpenTarget = directRackTableOpenTarget

  if (directRackView && !directRackOpenTarget) {
    currentPreview = null
    directRackLockedPlacement = null
    directRackLockedDragSignature = ''
    previewSignature = ''
    clearGroup(previewGroup)
    clearDropHighlights()
    clearDragGhost()
    state.boardInspectorDragActive = false
    return setBoardDragResult(false, false)
  }

  // Elini açmış oyuncu geçerli bir çifti, çift açmış herhangi bir oyuncunun
  // alanına işleyebilir. Bu hedef normal "kendi board'una yeni grup açma"
  // hedefinden önce değerlendirilir.
  if (
    kind === 'pair' &&
    (projection?.viaInspector || progress >= BOARD_TARGET_MIN_PROGRESS)
  ) {
    const pairTarget = findPairLayoffTarget(point, tiles, inspectorSeat)

    if (pairTarget) {
      currentPreview = {
        action: 'pair-layoff',
        tileIds: ids,
        tiles,
        kind,
        targetSeat: pairTarget.targetSeat,
        placement: pairTarget.placement,
      }

      renderPreview(
        tiles,
        pairTarget.placement,
        kind,
        {
          intent: 'pair-layoff',
        }
      )

      return setBoardDragResult(true, true)
    }
  }

  // Küçük yakın-kamera yalnız mevcut masaya işleme içindir. Yeni normal per
  // başka oyuncunun inset görünümünde açılamaz; geçersiz grubu mouse altında
  // gösterip bırakıldığında ıstakaya geri göndeririz.
  if (projection?.viaInspector) {
    currentPreview = null
    previewSignature = ''
    clearGroup(previewGroup)
    clearDropHighlights()
    renderFreeDragGhost(tiles, point, inspectorSeat, 'inspector-group')
    return setBoardDragResult(true, false)
  }

  // Yeni per/ilk çift açma her zaman oyuncunun KENDİ alanına yapılır.
  const canStage =
    canStageGroupOnOwnBoard(kind) &&
    (progress >= BOARD_TARGET_MIN_PROGRESS || directRackOpenTarget) &&
    (
      isPointNearBoard(point, ownerSeat) ||
      directRackTableOpenTarget
    )

  const dragSignature = [kind, ...ids].join(':')

  let placement = null

  if (canStage) {
    if (
      directRackLockedPlacement &&
      directRackLockedDragSignature === dragSignature
    ) {
      placement = directRackLockedPlacement
    }
    else {
      placement = findCenteredFreePlacement(
        ids.length,
        ownerSeat,
        kind
      )

      if (placement) {
        directRackLockedPlacement = { ...placement }
        directRackLockedDragSignature = dragSignature
      }
    }
  }
  else {
    directRackLockedPlacement = null
    directRackLockedDragSignature = ''
  }

  if (placement) {
    currentPreview = {
      action: 'stage',
      tileIds: ids,
      tiles,
      kind,
      placement,
    }

    renderPreview(
      tiles,
      placement,
      kind,
      {
        intent: 'stage',
      }
    )

    return setBoardDragResult(true, true)
  }

  currentPreview = null
  previewSignature = ''
  clearGroup(previewGroup)
  clearDropHighlights()

  // Kamera başka oyuncunun board'una kaymışsa serbest ghost da o oyuncunun
  // okuma yönünde döner; mouse ile taş arasında kopukluk hissi oluşmaz.
  renderFreeDragGhost(
    tiles,
    point,
    getFocusedBoardSeat() || ownerSeat,
    kind
  )

  return setBoardDragResult(true, false)
}

// =====================================================
// TEK TAŞI AÇILMIŞ PERE İŞLEME DRAG'I
// =====================================================

const LAYOFF_TARGET_RADIUS = 0.40

function getClientEffectiveTile(tile) {
  if (!tile) return null

  const joker = state.publicGameState?.joker

  if (tile.type === 'fake-joker' && joker) {
    return {
      ...tile,
      color: joker.color,
      number: joker.number,
      wildcard: false,
    }
  }

  if (
    joker &&
    tile.type !== 'fake-joker' &&
    tile.color === joker.color &&
    Number(tile.number) === Number(joker.number)
  ) {
    return {
      ...tile,
      wildcard: true,
    }
  }

  return {
    ...tile,
    wildcard: false,
  }
}

function canLayoffToPublicGroup(group, tile) {
  if (!group || !tile) return false

  const effective = getClientEffectiveTile(tile)
  const type = group.meldType
  const meta = group.meldMeta

  // Eski/eksik public state için fallback. Güncel server normal perlerde her
  // zaman meldType/meldMeta yayınlar.
  if (!type || !meta) {
    return validateMeldRef([...group.tiles, tile])
  }

  if (type === 'group') {
    // Setlerde okeyin renk ataması yeni doğal taş geldiğinde değişebilir.
    // Örn. 13-13-Okey + üçüncü farklı renk 13 => 13-13-13-Okey.
    // Tam oluşacak seti yeniden doğrulamak bu davranışı server ile eşler.
    return validateMeldRef([...group.tiles, tile])
  }

  if (type === 'run') {
    const sequence = Array.isArray(meta.sequence)
      ? [...meta.sequence].map(Number)
      : []

    if (sequence.length === 0) return false

    const left = sequence[0] - 1
    const right = sequence[sequence.length - 1] + 1

    if (effective.wildcard) {
      return right <= 13 || left >= 1
    }

    if (effective.color !== meta.color) {
      return false
    }

    return (
      (left >= 1 && Number(effective.number) === left) ||
      (right <= 13 && Number(effective.number) === right)
    )
  }

  return false
}

function getLayoffDockPlacement(target, tile, point = null) {
  const placement = target?.placement
  const group = target?.group

  if (!placement || !group || !tile) return null

  const length = group.tiles.length
  const effective = getClientEffectiveTile(tile)
  let dockCol = placement.startCol + length
  let layoffSide = null

  if (group.meldType === 'run' && group.meldMeta) {
    const sequence = Array.isArray(group.meldMeta.sequence)
      ? group.meldMeta.sequence.map(Number)
      : []

    if (sequence.length > 0) {
      const left = sequence[0] - 1
      const right = sequence[sequence.length - 1] + 1
      const leftCol = placement.startCol - 1
      const rightCol = placement.startCol + length
      let useLeft = false

      if (effective?.wildcard) {
        // Gerçek okey iki uca da legal olabiliyorsa fare hangi boş uca daha
        // yakınsa o tarafı seç. Böylece sol boşluğa sürüklenen okey client'ta
        // sağa snap olmaz; aynı tercih server'a da gönderilir.
        const canLeft = left >= 1 && leftCol >= 0
        const canRight = right <= 13 && rightCol < OPEN_BOARD_COLUMNS

        if (!canLeft && !canRight) return null

        if (canLeft && canRight && point) {
          const leftSlot = getSlotPosition(
            placement.seat,
            placement.row,
            leftCol
          )
          const rightSlot = getSlotPosition(
            placement.seat,
            placement.row,
            rightCol
          )
          const leftDistance = Math.hypot(
            point.x - leftSlot.x,
            point.z - leftSlot.z
          )
          const rightDistance = Math.hypot(
            point.x - rightSlot.x,
            point.z - rightSlot.z
          )
          useLeft = leftDistance <= rightDistance
        }
        else {
          useLeft = canLeft && !canRight
        }
      }
      else if (effective) {
        useLeft = Number(effective.number) === left && left >= 1
      }

      dockCol = useLeft ? leftCol : rightCol
      layoffSide = useLeft ? 'left' : 'right'
    }
  }

  // Aynı sayı grubunda taşlar renk sırasına göre yeniden dizilecek olsa da
  // sürükleme sırasında önce sağdaki, yer yoksa soldaki boş hücre dock olur.
  if (dockCol < 0 || dockCol >= OPEN_BOARD_COLUMNS) {
    if (group.meldType === 'run') return null
    dockCol = placement.startCol - 1
  }

  if (dockCol < 0 || dockCol >= OPEN_BOARD_COLUMNS) {
    return null
  }

  return {
    seat: placement.seat,
    row: placement.row,
    startCol: dockCol,
    kind: 'layoff',
    layoffSide,
  }
}

function isClientRealJoker(tile) {
  if (!tile || tile.type === 'fake-joker') return false

  const joker = state.publicGameState?.joker
  return Boolean(
    joker &&
    tile.color === joker.color &&
    Number(tile.number) === Number(joker.number)
  )
}

function getPublicGroupJokerReplacement(group, tile) {
  if (!group || !tile || group.pendingOpening) return null

  const effective = getClientEffectiveTile(tile)
  if (!effective || effective.wildcard) return null

  const jokerEntries = group.tiles
    .map((item, index) => ({ item, index }))
    .filter(entry => isClientRealJoker(entry.item))

  if (jokerEntries.length === 0) return null

  if (Number.isInteger(group.serverMeldIndex)) {
    if (group.meldType === 'group' && group.tiles.length !== 4) {
      // 3 taşlık sette hangi eksik rengin okey olduğu belirsiz kalabilir.
      return null
    }

    for (const entry of jokerEntries) {
      const assigned = group.meldMeta?.assignments?.[entry.item.id]
      if (!assigned) continue

      if (
        effective.color !== assigned.color ||
        Number(effective.number) !== Number(assigned.number)
      ) {
        continue
      }

      return {
        action: 'replace-joker',
        serverMeldIndex: group.serverMeldIndex,
        jokerIndex: entry.index,
        jokerTile: entry.item,
      }
    }

    return null
  }

  if (
    Number.isInteger(group.serverPairOpenIndex) &&
    Number.isInteger(group.serverPairIndex) &&
    group.tiles.length === 2
  ) {
    const indicatorId = state.publicGameState?.indicator?.id
    if (indicatorId && group.tiles.some(item => item?.id === indicatorId)) {
      return null
    }

    // Çiftte iki okey varsa doğal kimlik belirsizdir; mevcut kural gereği
    // yalnız tek okey + tek doğal taştan oluşan çiftte okey alınabilir.
    if (jokerEntries.length !== 1) return null

    const jokerTile = jokerEntries[0].item
    const jokerIndex = jokerEntries[0].index
    const mate = group.tiles.find(item => item.id !== jokerTile.id)
    const mateEffective = getClientEffectiveTile(mate)

    if (
      !mateEffective ||
      mateEffective.wildcard ||
      effective.color !== mateEffective.color ||
      Number(effective.number) !== Number(mateEffective.number)
    ) {
      return null
    }

    return {
      action: 'replace-joker-pair',
      serverPairOpenIndex: group.serverPairOpenIndex,
      serverPairIndex: group.serverPairIndex,
      jokerIndex,
      jokerTile,
    }
  }

  return null
}

function findNearestJokerReplacementTarget(point, tile, forcedSeat = null) {
  if (!point || !tile || !canLocalProcessTable()) return null

  let best = null

  publicGroups.forEach((group, groupIndex) => {
    const replacement = getPublicGroupJokerReplacement(group, tile)
    if (!replacement) return

    const placement = publicPlacements[groupIndex]
    const ownerSeat = normalizeBoardSeat(group.ownerSeat)
    if (!placement || !ownerSeat) return
    if (forcedSeat && ownerSeat !== forcedSeat) return

    const slot = getSlotPosition(
      ownerSeat,
      placement.row,
      placement.startCol + replacement.jokerIndex
    )
    const distance = Math.hypot(point.x - slot.x, point.z - slot.z)
    if (distance > LAYOFF_TARGET_RADIUS) return

    if (!best || distance < best.distance) {
      best = {
        ...replacement,
        groupIndex,
        ownerSeat,
        placement,
        group,
        distance,
        dockPlacement: {
          seat: ownerSeat,
          row: placement.row,
          startCol: placement.startCol + replacement.jokerIndex,
          kind: 'joker-replace',
        },
      }
    }
  })

  return best
}

function findNearestLayoffTarget(point, tile, forcedSeat = null) {
  if (!point || !tile || !canLocalProcessTable()) {
    return null
  }

  let best = null

  publicGroups.forEach((group, groupIndex) => {
    const isOwnReadyDraft = Boolean(
      group.pendingOpening &&
      normalizeBoardSeat(group.ownerSeat) === normalizeBoardSeat(state.localSeat) &&
      group.serverDraftStageId &&
      state.privateHandState?.openingDraftReady
    )

    if (!Number.isInteger(group.serverMeldIndex) && !isOwnReadyDraft) return

    const placement = publicPlacements[groupIndex]
    const ownerSeat = normalizeBoardSeat(group.ownerSeat)

    if (!placement || !ownerSeat) return
    if (forcedSeat && ownerSeat !== forcedSeat) return

    // Server'ın sabit joker atamasını taşıyan meta ile aynı kurala göre
    // ön kontrol yap. Son karar yine server'dadır.
    if (!canLayoffToPublicGroup(group, tile)) return

    let minimumDistance = Infinity

    for (let index = 0; index < group.tiles.length; index++) {
      const slot = getSlotPosition(
        ownerSeat,
        placement.row,
        placement.startCol + index
      )

      const distance = Math.hypot(
        point.x - slot.x,
        point.z - slot.z
      )

      minimumDistance = Math.min(minimumDistance, distance)
    }

    if (minimumDistance > LAYOFF_TARGET_RADIUS) return

    if (!best || minimumDistance < best.distance) {
      best = {
        groupIndex,
        serverMeldIndex: group.serverMeldIndex,
        serverDraftStageId: isOwnReadyDraft
          ? group.serverDraftStageId
          : null,
        action: isOwnReadyDraft
          ? 'layoff-opening-draft'
          : 'layoff',
        ownerSeat,
        placement,
        group,
        distance: minimumDistance,
      }
    }
  })

  return best
}

function refreshActiveSingleLayoffVisual() {
  if (!activeSingleLayoffVisual) {
    return setBoardDragResult(false, false)
  }

  const progress = THREE.MathUtils.clamp(
    state.overviewProgress || 0,
    0,
    1
  )

  const inspectorProjection = getBoardInspectorProjectionRef?.(
    activeSingleLayoffVisual.clientX,
    activeSingleLayoffVisual.clientY
  )
  const usingInspector = Boolean(
    inspectorProjection?.point &&
    normalizeBoardSeat(inspectorProjection.seat)
  )

  state.boardInspectorDragActive = usingInspector

  if (
    (!usingInspector && progress < 0.10) ||
    !canLocalProcessTable() ||
    layoffRequestInFlight
  ) {
    currentLayoffPreview = null
    previewSignature = ''
    clearGroup(previewGroup)
    clearDropHighlights()
    clearDragGhost()

    return setBoardDragResult(false, false)
  }

  const {
    tileId,
    clientX,
    clientY,
  } = activeSingleLayoffVisual

  const tile = getHandMapRef().get(tileId)
  const projection = getBoardInteractionProjection(clientX, clientY)
  const point = projection?.point || null
  const forcedSeat = projection?.viaInspector
    ? projection.forcedSeat
    : null

  state.boardInspectorDragActive = Boolean(projection?.viaInspector)

  if (!tile || !point) {
    currentLayoffPreview = null
    previewSignature = ''
    clearGroup(previewGroup)
    clearDropHighlights()
    clearDragGhost()

    return setBoardDragResult(false, false)
  }

  const replacementTarget = findNearestJokerReplacementTarget(
    point,
    tile,
    forcedSeat
  )
  const layoffTarget = findNearestLayoffTarget(point, tile, forcedSeat)
  const target =
    replacementTarget &&
    (!layoffTarget || replacementTarget.distance <= layoffTarget.distance)
      ? replacementTarget
      : layoffTarget

  if (target) {
    const dockPlacement =
      target.action === 'replace-joker' || target.action === 'replace-joker-pair'
        ? target.dockPlacement
        : getLayoffDockPlacement(target, tile, point)

    currentLayoffPreview = {
      tileId,
      action: target.action || 'layoff',
      ...target,
      dockPlacement,
    }

    if (dockPlacement) {
      // Geçerli işleme hedefinde taş mouse altında yüzmek yerine tam gireceği
      // uç hücreye zarifçe snap olur. Server reddederse state değişmez.
      renderPreview(
        [tile],
        dockPlacement,
        'single',
        { intent: 'layoff' }
      )
    }
    else {
      renderFreeDragGhost(
        [tile],
        point,
        target.ownerSeat,
        'layoff-ready'
      )
    }

    return setBoardDragResult(true, true)
  }

  currentLayoffPreview = null
  previewSignature = ''
  clearGroup(previewGroup)
  clearDropHighlights()

  // Hedef değişirken taş mouse altında kalır ve bakılan oyuncunun yönüne döner.
  renderFreeDragGhost(
    [tile],
    point,
    forcedSeat ||
      getFocusedBoardSeat() ||
      normalizeBoardSeat(state.localSeat),
    projection?.viaInspector ? 'inspector-layoff-free' : 'layoff-free'
  )

  return setBoardDragResult(true, false)
}

function updateSingleLayoffDrag({ tileId, clientX, clientY }) {
  if (!tileId) {
    return setBoardDragResult(false, false)
  }

  // Tek-taş işleme ile per açma ghost'u aynı preview katmanlarını paylaşır.
  // Bir drag türünden diğerine geçerken eski ghost/slot vurgusu kalmasın.
  if (activeRackDragVisual) {
    activeRackDragVisual = null
    currentPreview = null
    previewSignature = ''
    clearGroup(previewGroup)
    clearDropHighlights()
    clearDragGhost()
  }

  activeSingleLayoffVisual = {
    tileId,
    clientX,
    clientY,
  }

  return refreshActiveSingleLayoffVisual()
}

function commitSingleLayoffDrag(tileId) {
  if (
    !activeSingleLayoffVisual ||
    activeSingleLayoffVisual.tileId !== tileId ||
    layoffRequestInFlight ||
    !socketRef?.emit
  ) {
    return false
  }

  refreshActiveSingleLayoffVisual()

  const target = currentLayoffPreview

  if (!target || target.tileId !== tileId) {
    return false
  }

  layoffRequestInFlight = true
  activeSingleLayoffVisual = null
  currentLayoffPreview = null
  previewSignature = ''
  clearGroup(previewGroup)
  clearDropHighlights()
  clearDragGhost()
  setBoardDragResult(false, false)

  const action = target.action || 'layoff'
  let eventName = 'layoff'
  let payload = {
    tileId,
    meldIndex: target.serverMeldIndex,
    side: target.dockPlacement?.layoffSide || null,
  }

  if (action === 'replace-joker') {
    eventName = 'replace-joker'
    payload = {
      tileId,
      meldIndex: target.serverMeldIndex,
    }
  }
  else if (action === 'replace-joker-pair') {
    eventName = 'replace-joker-pair'
    payload = {
      tileId,
      pairOpenIndex: target.serverPairOpenIndex,
      pairIndex: target.serverPairIndex,
    }
  }
  else if (action === 'layoff-opening-draft') {
    eventName = 'layoff-opening-draft'
    payload = {
      tileId,
      stageId: target.serverDraftStageId,
      side: target.dockPlacement?.layoffSide || null,
    }
  }

  socketRef.emit(
    eventName,
    payload,
    result => {
      layoffRequestInFlight = false

      if (!result?.ok) {
        setMessageRef(
          result?.message ||
          (action.startsWith('replace-joker')
            ? 'Bu taşla okey alınamadı.'
            : 'Bu taş seçilen pere işlenemedi.')
        )
        renderOwnHandRef()
        return
      }

      if (action === 'layoff-opening-draft') {
        const stagedGroup = state.stagedOpenGroups.find(
          group => String(group?.stageId || '') === String(target.serverDraftStageId || '')
        )
        const tile = getHandMapRef().get(tileId)

        if (stagedGroup && tile && !stagedGroup.tileIds.includes(tileId)) {
          stagedGroup.tileIds.push(tileId)
          stagedGroup.tiles.push({ ...tile })
          state.stagedOpenTileIds.add(tileId)
          localDraftWasPublished = true
          renderStagedGroups()
          renderOwnHandRef()
        }
      }

      setMessageRef(
        action.startsWith('replace-joker')
          ? 'Doğal taş yerleştirildi; okey eline alındı.'
          : 'Taş açılmış pere işlendi.'
      )
    }
  )

  return true
}

function cancelSingleLayoffDrag() {
  activeSingleLayoffVisual = null
  currentLayoffPreview = null
  previewSignature = ''
  clearGroup(previewGroup)
  clearDropHighlights()
  clearDragGhost()
  setBoardDragResult(false, false)
}

// =====================================================
// CANLI TASLAK SENKRONU
// =====================================================

function serializeStagedGroups() {
  return state.stagedOpenGroups.map(group => ({
    stageId: group.stageId,
    tileIds: [...group.tileIds],
    kind: group.kind,
    placement: group.placement
      ? {
          row: group.placement.row,
          startCol: group.placement.startCol,
          kind: group.kind,
          seat: normalizeBoardSeat(state.localSeat),
        }
      : null,
  }))
}

function syncStagedGroupsToServer() {
  if (!socketRef?.emit) return

  const serial = ++draftSyncSerial
  const payload = serializeStagedGroups()

  socketRef.emit('opening-draft', payload, result => {
    if (serial !== draftSyncSerial) return

    if (!result?.ok) {
      setMessageRef(result?.message || 'Açılış taslağı sunucuya gönderilemedi.')
      return
    }

    localDraftWasPublished = payload.length > 0
  })
}

// =====================================================
// STAGING
// =====================================================

let stageCounter = 0

function getGroupKind(tiles) {
  if (tiles.length >= 3 && validateMeldRef(tiles)) {
    return 'meld'
  }

  if (
    tiles.length === 2 &&
    (validatePairRef(tiles) || validateOpeningPairRef(tiles))
  ) {
    return 'pair'
  }

  return null
}

function normalizeStagedPlacements() {
  const ownerSeat = normalizeBoardSeat(state.localSeat)
  if (!ownerSeat) return

  const occupancy = getPublicOccupancy(ownerSeat)

  for (const group of state.stagedOpenGroups) {
    const groupSeat = normalizeBoardSeat(
      group.ownerSeat,
      ownerSeat
    )

    if (groupSeat !== ownerSeat) continue

    const length = group.tileIds.length
    const current = group.placement

    const kind = group.kind || 'meld'
    const rowCompatible =
      kind === 'pair'
        ? isPairRowCompatible(occupancy, current?.row)
        : isRowEmpty(occupancy, current?.row)

    if (
      current &&
      normalizeBoardSeat(current.seat, ownerSeat) === ownerSeat &&
      rowCompatible &&
      isPlacementFree(
        occupancy,
        current.row,
        current.startCol,
        length
      )
    ) {
      current.seat = ownerSeat
      current.kind = kind
      markPlacement(occupancy, current, length, kind)
      continue
    }

    const replacement = findFirstFreePlacement(
      length,
      occupancy,
      kind
    )
    group.placement = replacement
      ? {
          ...replacement,
          seat: ownerSeat,
        }
      : null

    if (group.placement) {
      markPlacement(
        occupancy,
        group.placement,
        length,
        group.kind || 'meld'
      )
    }
  }
}

function captureRackReturnSlots(tileIds) {
  const wanted = new Set(tileIds)
  const slots = []

  for (let row = 0; row < 2; row++) {
    const rowIds = Array.isArray(state.rackRows?.[row])
      ? state.rackRows[row]
      : []

    rowIds.forEach((id, index) => {
      if (!wanted.has(id)) return

      const saved = state.manualTilePositions?.get?.(id)
      slots.push({
        id,
        row,
        index,
        x: Number.isFinite(Number(saved?.x))
          ? Number(saved.x)
          : null,
      })
    })
  }

  return slots
}

function queueRackReturnSlots(groups) {
  const byId = new Map(
    pendingRackReturnSlots.map(slot => [slot.id, slot])
  )

  for (const group of groups || []) {
    for (const slot of group?.rackReturnSlots || []) {
      if (!slot?.id) continue
      byId.set(slot.id, { ...slot })
    }
  }

  pendingRackReturnSlots = [...byId.values()]
}

function restoreRackReturnSlots(slots, handIds = null) {
  const usable = (slots || []).filter(slot =>
    slot?.id && (!handIds || handIds.has(slot.id))
  )

  if (usable.length === 0) return false

  const returningIds = new Set(usable.map(slot => slot.id))

  for (let row = 0; row < 2; row++) {
    state.rackRows[row] = (state.rackRows[row] || []).filter(
      id => !returningIds.has(id)
    )
  }

  for (const slot of usable) {
    const row = slot.row === 1 ? 1 : 0
    state.rackRows[row].push(slot.id)

    if (Number.isFinite(Number(slot.x))) {
      state.manualTilePositions.set(slot.id, {
        x: Number(slot.x),
        row,
      })
    }
  }

  for (let row = 0; row < 2; row++) {
    const fallbackIndex = new Map(
      usable
        .filter(slot => (slot.row === 1 ? 1 : 0) === row)
        .map(slot => [slot.id, Number(slot.index) || 0])
    )

    state.rackRows[row].sort((a, b) => {
      const posA = state.manualTilePositions.get(a)
      const posB = state.manualTilePositions.get(b)
      const ax = Number(posA?.x)
      const bx = Number(posB?.x)

      if (Number.isFinite(ax) && Number.isFinite(bx) && ax !== bx) {
        return ax - bx
      }

      if (Number.isFinite(ax) !== Number.isFinite(bx)) {
        return Number.isFinite(ax) ? -1 : 1
      }

      return (fallbackIndex.get(a) ?? 999) - (fallbackIndex.get(b) ?? 999)
    })
  }

  return true
}

function restorePendingRackReturns(handState) {
  if (pendingRackReturnSlots.length === 0) return false

  const handIds = new Set(
    (handState?.hand || []).map(tile => tile.id)
  )

  const queued = pendingRackReturnSlots
  pendingRackReturnSlots = []
  return restoreRackReturnSlots(queued, handIds)
}

function stageCurrentPreview(tileIds) {
  if (
    !currentPreview ||
    currentPreview.action === 'pair-layoff'
  ) {
    return false
  }

  const normalizedIds = [...new Set(tileIds)]

  if (
    normalizedIds.length !== currentPreview.tileIds.length ||
    normalizedIds.some((id, index) => id !== currentPreview.tileIds[index])
  ) {
    return false
  }

  if (
    normalizedIds.some(id => state.stagedOpenTileIds.has(id))
  ) {
    return false
  }

  const handMap = getHandMapRef()
  const tiles = normalizedIds
    .map(id => handMap.get(id))
    .filter(Boolean)

  if (tiles.length !== normalizedIds.length) {
    return false
  }

  const kind = getGroupKind(tiles)
  if (!kind) {
    setMessageRef('Buraya yalnız geçerli bir per veya gerçek çift bırakabilirsin.')
    return false
  }

  const stageId = `stage-${++stageCounter}`

  const group = {
    stageId,
    tileIds: normalizedIds,
    tiles: tiles.map(tile => ({ ...tile })),
    kind,
    ownerSeat: normalizeBoardSeat(state.localSeat),
    placement: {
      ...currentPreview.placement,
      kind,
    },
    pendingServerOpen: false,
    // Açılış geçersiz olup taşlar geri dönerse server hand sırasına göre
    // yeniden eklemek yerine sürüklemeden ÖNCEKİ rack konumlarını geri yükle.
    rackReturnSlots: captureRackReturnSlots(normalizedIds),
  }

  state.stagedOpenGroups.push(group)

  for (const id of normalizedIds) {
    state.stagedOpenTileIds.add(id)
  }

  clearPreview()
  renderStagedGroups()
  renderOwnHandRef()
  syncStagedGroupsToServer()

  setMessageRef(
    kind === 'pair'
      ? 'Çift masaya bırakıldı. Taş atınca açılış otomatik kontrol edilecek.'
      : 'Per masaya bırakıldı. Taş atınca açılış otomatik kontrol edilecek.'
  )

  return true
}

function returnStageGroup(stageId) {
  const index = state.stagedOpenGroups.findIndex(
    group => group.stageId === stageId
  )

  if (index < 0) return false

  if (state.openingInFlight) {
    setMessageRef('Açma sonucu bekleniyor.')
    return false
  }

  const [group] = state.stagedOpenGroups.splice(index, 1)

  for (const id of group.tileIds) {
    state.stagedOpenTileIds.delete(id)
  }

  restoreRackReturnSlots(
    group.rackReturnSlots,
    new Set((state.privateHandState?.hand || []).map(tile => tile.id))
  )

  renderStagedGroups()
  renderOwnHandRef()
  syncStagedGroupsToServer()
  setMessageRef('Hazırlanan grup ıstakaya geri alındı.')
  return true
}

function returnAllStagedGroups() {
  if (state.openingInFlight) {
    setMessageRef('Açma sonucu bekleniyor.')
    return
  }

  if (state.stagedOpenGroups.length === 0) {
    setMessageRef('Geri alınacak hazırlanmış per yok.')
    return
  }

  const returningGroups = [...state.stagedOpenGroups]

  for (const group of returningGroups) {
    for (const id of group.tileIds) {
      state.stagedOpenTileIds.delete(id)
    }
  }

  restoreRackReturnSlots(
    returningGroups.flatMap(group => group.rackReturnSlots || []),
    new Set((state.privateHandState?.hand || []).map(tile => tile.id))
  )

  state.stagedOpenGroups.length = 0
  clearPreview()
  renderStagedGroups()
  renderOwnHandRef()
  syncStagedGroupsToServer()
  setMessageRef('Hazırlanan taşlar ıstakaya geri alındı.')
}

// =====================================================
// OPEN / SERVER SUBMIT
// =====================================================

function finishOpenRequest(result, eventName) {
  state.openingInFlight = false

  if (openingTimeout) {
    clearTimeout(openingTimeout)
    openingTimeout = null
  }

  const success =
    result === true ||
    result?.ok === true

  if (!success) {
    setMessageRef(
      result?.message ||
      (
        eventName === 'open-pairs'
          ? 'Çiftler açılamadı.'
          : 'Perler açılamadı. 101 ve per kurallarını kontrol et.'
      )
    )
    return
  }

  for (const group of state.stagedOpenGroups) {
    group.pendingServerOpen = true
  }

  renderStagedGroups()

  setMessageRef(
    eventName === 'open-pairs'
      ? 'Çiftler açıldı.'
      : 'Perler açıldı.'
  )
}

function submitStagedGroups() {
  ensureStateContainers()

  if (state.openingInFlight) {
    setMessageRef('Açma sonucu bekleniyor.')
    return
  }

  if (state.stagedOpenGroups.length === 0) {
    setMessageRef('Önce ıstakadan perleri masadaki slotlara sürükle.')
    return
  }

  const handMap = getHandMapRef()

  const resolved = state.stagedOpenGroups.map(group => ({
    group,
    tiles: group.tileIds.map(id => handMap.get(id)).filter(Boolean),
  }))

  if (
    resolved.some(item => item.tiles.length !== item.group.tileIds.length)
  ) {
    setMessageRef('Hazırlanan taşlardan biri artık elde değil.')
    return
  }

  const allMelds = resolved.every(
    item => item.tiles.length >= 3 && validateMeldRef(item.tiles)
  )

  // İlk çift açılışında 5 çift gerekir. Oyuncu zaten çifte açtıysa
  // sonraki turlarda tek bir yeni gerçek çifti bile ayrıca yere indirebilir.
  const requiredPairCount =
    state.privateHandState?.openType === 'pairs'
      ? 1
      : 5

  const allPairs =
    resolved.length >= requiredPairCount &&
    resolved.every(
      item => item.tiles.length === 2 && validatePairRef(item.tiles)
    )

  let eventName

  if (allMelds) {
    eventName = 'open-melds'
  } else if (allPairs) {
    eventName = 'open-pairs'
  } else {
    setMessageRef(
      'Açma alanında ya yalnız geçerli perler ya da açmaya yetecek gerçek çiftler olmalı.'
    )
    return
  }

  const payload = state.stagedOpenGroups.map(
    group => [...group.tileIds]
  )

  state.openingInFlight = true
  setMessageRef(
    eventName === 'open-pairs'
      ? 'Çiftler açılıyor…'
      : 'Perler açılıyor…'
  )

  let settled = false

  socketRef?.emit?.(
    eventName,
    payload,
    result => {
      if (settled) return
      settled = true
      finishOpenRequest(result, eventName)
    }
  )

  openingTimeout = setTimeout(() => {
    if (settled) return
    settled = true
    state.openingInFlight = false
    openingTimeout = null
    setMessageRef(
      'Sunucudan açma yanıtı gelmedi. Hazırlanan taşlar masada kaldı.'
    )
  }, 6000)
}

// =====================================================
// GAME / HAND RECONCILIATION
// =====================================================

function resetBoardForNewRound(round) {
  state.stagedOpenGroups.length = 0
  state.stagedOpenTileIds.clear()
  state.localOpenedFallbackGroups.length = 0
  publicOwnerBySignature.clear()
  state.openingInFlight = false
  localDraftWasPublished = false
  pendingRackReturnSlots = []
  clearPreview()
  lastRound = round
  renderOwnHandRef()
}

function reconcileWithGameState(gameState) {
  const round = gameState?.round ?? null

  if (lastRound !== null && round !== lastRound) {
    resetBoardForNewRound(round)
  } else if (lastRound === null) {
    lastRound = round
  }

  const serverLocalDrafts = (gameState?.openingDrafts || []).filter(
    draft => normalizeBoardSeat(draft?.ownerSeat) === normalizeBoardSeat(state.localSeat)
  )

  // Yayınlanmış yerel taslak server'da kaybolduysa discard ile ya commit
  // edilmiştir ya da yanlış/eksik açılış olarak geri dönmüştür. İki durumda da
  // local staging kopyasını temizle; hand-state kalan taşları rack'e geri çizer.
  if (
    localDraftWasPublished &&
    serverLocalDrafts.length === 0 &&
    state.stagedOpenGroups.length > 0
  ) {
    // game-state her zaman hand-state'ten önce gelir. Taslak kaybolduğunda
    // bunun başarılı açılış mı yoksa yanlış açılış rollback'i mi olduğunu
    // eski private hand ile ayırt edemeyiz. Orijinal rack slotlarını kuyrukta
    // tutup hemen ardından gelen güncel hand-state'te yalnız elde kalan
    // taşlara uygularız. Böylece başarılı açılışta hayalet taş oluşmaz.
    queueRackReturnSlots(state.stagedOpenGroups)
    state.stagedOpenGroups.length = 0
    state.stagedOpenTileIds.clear()
    localDraftWasPublished = false
  }
  else if (serverLocalDrafts.length > 0) {
    localDraftWasPublished = true
  }

  publicGroups = extractPublicGroups(gameState)
  layoutPublicGroups()
  normalizeStagedPlacements()
  renderAllBoardGroups()
}

function reconcileWithHandState(handState) {
  const handIds = new Set(
    (handState?.hand || []).map(tile => tile.id)
  )

  const rackRestored = restorePendingRackReturns(handState)
  let changed = false

  for (let i = state.stagedOpenGroups.length - 1; i >= 0; i--) {
    const group = state.stagedOpenGroups[i]

    // Staged taşlar rack'te görünmediği için elde kaybolmaları yalnızca
    // başarılı açma / raund değişimi gibi sunucu kaynaklı bir işlem olabilir.
    if (!group.tileIds.every(id => !handIds.has(id))) {
      continue
    }

    state.localOpenedFallbackGroups.push({
      tileIds: [...group.tileIds],
      tiles: group.tiles.map(tile => ({ ...tile })),
      ownerSeat: normalizeBoardSeat(
        group.ownerSeat,
        state.localSeat
      ),
      kind: group.kind || getGroupKind(group.tiles),
      placement: group.placement ? { ...group.placement } : null,
      round: state.publicGameState?.round ?? null,
    })

    for (const id of group.tileIds) {
      state.stagedOpenTileIds.delete(id)
    }

    state.stagedOpenGroups.splice(i, 1)
    changed = true
  }

  if (changed) {
    state.openingInFlight = false
    renderAllBoardGroups()
  }

  if (rackRestored) {
    renderOwnHandRef()
  }
}

// =====================================================
// BOARD POINTER ACTIONS
// =====================================================

function findStageIdFromObject(object) {
  let current = object

  while (current) {
    if (current.userData?.openStageGroupId) {
      return current.userData.openStageGroupId
    }

    current = current.parent
  }

  return null
}

function findOpenBoardSeatFromObject(object) {
  let current = object

  while (current) {
    const seat = normalizeBoardSeat(current.userData?.openBoardOwnerSeat)
    if (seat) return seat
    current = current.parent
  }

  return null
}

function onBoardPointerDown(event) {
  if (event.button !== 0) return
  if (isTouchPointerEvent(event) && !event.isPrimary) return
  if (state.isDraggingTile || state.isStickyPickup || state.isTableInteracting) return

  updatePointerFromClient(event.clientX, event.clientY)
  raycaster.setFromCamera(pointer, camera)

  // Istaka kamerasında açılmış taşların kendisi artık inspector açmaz.
  // Yakın kamera yalnız oyuncunun kafa üstündeki adına tıklanarak açılır.
  if ((state.overviewProgress || 0) < 0.12) {
    return
  }

  let stagedHits = raycaster.intersectObjects(
    stagedMeldGroup.children,
    true
  )

  if (stagedHits.length === 0 && isTouchPointerEvent(event)) {
    // Staged grubu geri alma hedefi telefonda küçük kalabilir. Sadece touch'ta
    // yakın çevrede birkaç ray dene; masaüstü hit-test tamamen aynı kalır.
    for (const [dx, dy] of [[0,-18], [0,18], [-18,0], [18,0], [-13,-13], [13,-13], [-13,13], [13,13]]) {
      updatePointerFromClient(event.clientX + dx, event.clientY + dy)
      raycaster.setFromCamera(pointer, camera)
      stagedHits = raycaster.intersectObjects(stagedMeldGroup.children, true)
      if (stagedHits.length > 0) break
    }
    updatePointerFromClient(event.clientX, event.clientY)
  }

  if (stagedHits.length > 0) {
    const stageId = findStageIdFromObject(stagedHits[0].object)

    if (stageId) {
      event.preventDefault()
      event.stopImmediatePropagation()
      returnStageGroup(stageId)
      if (isTouchPointerEvent(event)) {
        window.dispatchEvent(new CustomEvent('okey:mobile-camera', {
          detail: { action: 'rack' },
        }))
      }
    }
  }
}

// =====================================================
// PUBLIC CONTROLLER USED BY rack.js
// =====================================================

function updateRackGroupDrag({ tileIds, clientX, clientY }) {
  ensureStateContainers()

  // Per açma sürüklemesi başlarken eski tek-taş işleme ghost'u kalmasın.
  if (activeSingleLayoffVisual) {
    activeSingleLayoffVisual = null
    currentLayoffPreview = null
    clearDropHighlights()
    clearDragGhost()
  }

  activeRackDragVisual = {
    tileIds: [...tileIds],
    clientX,
    clientY,
  }

  return refreshActiveRackDragVisual()
}

function getPlayerNameBySeat(seat) {
  return state.publicGameState?.players?.find(
    player => player.seat === seat
  )?.name || 'Oyuncu'
}

function commitPairLayoffPreview(tileIds) {
  const preview = currentPreview

  if (
    !preview ||
    preview.action !== 'pair-layoff' ||
    pairLayoffRequestInFlight ||
    !socketRef?.emit
  ) {
    return false
  }

  const normalizedIds = [...new Set(tileIds)]

  if (
    normalizedIds.length !== 2 ||
    normalizedIds.length !== preview.tileIds.length ||
    normalizedIds.some(
      (id, index) => id !== preview.tileIds[index]
    )
  ) {
    return false
  }

  pairLayoffRequestInFlight = true
  const targetSeat = preview.targetSeat
  const targetName = getPlayerNameBySeat(targetSeat)

  activeRackDragVisual = null
  currentPreview = null
  previewSignature = ''
  clearGroup(previewGroup)
  clearDropHighlights()
  clearDragGhost()
  setBoardDragResult(false, false)

  setMessageRef(`${targetName} tarafına çift işleniyor…`)

  socketRef.emit(
    'layoff-pair',
    {
      tileIds: normalizedIds,
      targetSeat,
    },
    result => {
      pairLayoffRequestInFlight = false

      if (!result?.ok) {
        setMessageRef(
          result?.message ||
          'Bu çift seçilen çift alanına işlenemedi.'
        )
        renderOwnHandRef()
        return
      }

      setMessageRef(`${targetName} tarafına çift işlendi.`)
    }
  )

  return true
}

function commitRackGroupDrag(tileIds) {
  // Pointer son hareketinden sonra kamera odağı/yayı ilerlemiş olabilir.
  // Mouse-up'ta hedefi yeniden hesaplayıp görünen preview ile server aksiyonunu
  // birebir eşitliyoruz.
  refreshActiveRackDragVisual()

  if (
    !state.privateHandState?.opened &&
    !state.privateHandState?.turnHasAcquiredTile
  ) {
    setMessageRef('Elini açmadan önce bu tur bir taş çekmeli veya yandan taş almalısın.')
    clearPreview()
    return false
  }

  if (currentPreview?.action === 'pair-layoff') {
    return commitPairLayoffPreview(tileIds)
  }

  const committed = stageCurrentPreview(tileIds)

  if (!committed) {
    clearPreview()
  } else {
    activeRackDragVisual = null
    directRackLockedPlacement = null
    directRackLockedDragSignature = ''
    clearDragGhost()
    clearDropHighlights()
    setBoardDragResult(false, false)
  }

  return committed
}

function cancelRackGroupDrag() {
  clearPreview()
  setBoardDragResult(false, false)
}

export function resetMeldBoardVisualState(round = null) {
  if (openingTimeout) {
    clearTimeout(openingTimeout)
    openingTimeout = null
  }

  state.stagedOpenGroups.length = 0
  state.stagedOpenTileIds.clear()
  state.localOpenedFallbackGroups.length = 0
  state.openingInFlight = false
  state.openBoardDragCaptured = false
  state.openBoardDragReady = false
  state.boardInspectorDragActive = false

  publicOwnerBySignature.clear()
  publicGroups = []
  publicPlacements = []
  pendingRackReturnSlots = []
  localDraftWasPublished = false
  activeRackDragVisual = null
  activeSingleLayoffVisual = null
  currentLayoffPreview = null
  layoffRequestInFlight = false
  pairLayoffRequestInFlight = false
  draftSyncSerial++
  directRackLockedPlacement = null
  directRackLockedDragSignature = ''
  lastGameStateRef = null
  lastHandStateRef = null
  lastRound = round

  clearPreview()
  clearDragGhost()
  clearDropHighlights()
  clearGroup(publicMeldGroup)
  clearGroup(localFallbackGroup)
  clearGroup(stagedMeldGroup)
  clearGroup(previewGroup)
}

// =====================================================
// FRAME UPDATE
// =====================================================

export function updateMeldBoardAnimation() {
  ensureStateContainers()

  // Kamera pointer eventinden bağımsız ilerlediği için aktif drag tipi her
  // frame yeniden masa düzlemine projekte edilir. İki controller'ı art arda
  // çağırmıyoruz; pasif olanın captured=false sonucu aktif ghost'u ezmesin.
  if (activeRackDragVisual) {
    refreshActiveRackDragVisual()
  }
  else if (activeSingleLayoffVisual) {
    refreshActiveSingleLayoffVisual()
  }
  else {
    state.boardInspectorDragActive = false
    setBoardDragResult(false, false)
  }

  const progress = THREE.MathUtils.clamp(
    state.overviewProgress || 0,
    0,
    1
  )

  // Drop hedefini canlı ama sakin göster: parlama düşük genlikli olduğu için
  // slotlar yanıp sönmez, yalnızca hangi hücrelerin seçildiği daha okunur olur.
  const dragPulse =
    0.5 + 0.5 * Math.sin(performance.now() * 0.006)

  for (const marker of dropHighlightGroup.children) {
    if (marker.material) {
      marker.material.opacity = 0.22 + dragPulse * 0.13
    }
  }

  const ghostShadow = dragGhostGroup.getObjectByName('dragGhostShadow')
  if (ghostShadow?.material) {
    ghostShadow.material.opacity = 0.17 + dragPulse * 0.08
  }

  for (const holder of dragGhostGroup.children) {
    if (holder.userData?.flatTileHolder) {
      holder.position.y += dragPulse * 0.006
    }
  }

  for (const [seat, material] of slotMaterialsBySeat) {
    // Kendi açma alanın daha belirgin; diğer üç oyuncunun 91 slotu da
    // görünür ama masayı çizgi kalabalığına boğmamak için daha soluk.
    const localDragBoost =
      seat === state.localSeat &&
      (activeRackDragVisual || activeSingleLayoffVisual)
        ? 0.16
        : 0

    material.opacity = progress * (
      seat === state.localSeat
        ? 0.30 + localDragBoost
        : 0.105
    )
  }

  // AÇ / GERİ fiziksel düğmeleri kaldırıldı. Taslak açılış discard anında
  // otomatik kontrol edilir; staged gruba doğrudan tıklamak hâlâ geri alır.
  openButton.material.opacity = 0
  returnButton.material.opacity = 0
  openButton.root.visible = false
  returnButton.root.visible = false

  if (state.publicGameState !== lastGameStateRef) {
    lastGameStateRef = state.publicGameState
    reconcileWithGameState(state.publicGameState)
  }

  if (state.privateHandState !== lastHandStateRef) {
    lastHandStateRef = state.privateHandState
    reconcileWithHandState(state.privateHandState)
  }

  if (state.localSeat !== lastSeat) {
    lastSeat = state.localSeat
    updateWorldOrientation(publicMeldGroup)
    updateWorldOrientation(localFallbackGroup)
    updateWorldOrientation(stagedMeldGroup)
    updateWorldOrientation(previewGroup)

    positionLocalButtons()
  }
}

export function setupMeldBoard(
  socket,
  setMessage = () => {},
  helpers = {}
) {
  socketRef = socket
  setMessageRef = setMessage
  getHandMapRef = helpers.getHandMap || getHandMapRef
  validateMeldRef = helpers.validateMeld || validateMeldRef
  validatePairRef = helpers.validatePair || validatePairRef
  validateOpeningPairRef = helpers.validateOpeningPair || validateOpeningPairRef
  renderOwnHandRef = helpers.renderOwnHand || renderOwnHandRef
  openBoardInspectorRef = helpers.openBoardInspector || openBoardInspectorRef
  getBoardInspectorProjectionRef =
    helpers.getBoardInspectorProjection || getBoardInspectorProjectionRef

  renderer.domElement.addEventListener(
    'pointerdown',
    onBoardPointerDown,
    { capture: true }
  )

  return {
    updateRackGroupDrag,
    commitRackGroupDrag,
    cancelRackGroupDrag,
    updateSingleLayoffDrag,
    commitSingleLayoffDrag,
    cancelSingleLayoffDrag,
  }
}
