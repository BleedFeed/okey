import * as THREE from 'three'

import { state } from './state.js'
import {
  isMobileIncomingDiscardDropPoint,
  isTouchPointerEvent,
} from './mobile.js'
import {
  scene,
  camera,
  renderer,
  rackPlaceholders,
  ownTilesGroup,
  indicatorAnchor,
  INDICATOR_SCALE,
} from './scene.js'
import {
  createTile,
  createHiddenTile,
  clearGroup,
} from './tiles.js'
import {
  cancelRackDragVisual,
  cancelStickyPickupVisual,
  isDraggingReturnableDiscardTile,
  renderOwnHand,
} from './rack.js'
import {
  TILE_WIDTH,
  TILE_HEIGHT,
  TILE_DEPTH,
  DISCARD_ZONE_WIDTH,
  DISCARD_ZONE_DEPTH,
  DISCARD_ZONE_CENTER_X,
  DISCARD_ZONE_CENTER_Z,
  DISCARD_TILE_ROTATION_Z,
  getDiscardSlotLocalPosition,
} from './config.js'

// =====================================================
// PHYSICAL TABLE ACTIONS
// =====================================================

const TABLE_TOP_Y = 1.225
const STOCK_VISIBLE_LIMIT = 22
const STOCK_STACK_STEP = 0.016

// Her oyuncunun atıkları kendi ıstakasının sağındaki TEK kulede durur.
// Bütün taşlar aynı X/Z noktasına gelir; yalnız Y yüksekliği artar.
// Drag sırasında görülen hedef ile sonradan render edilen taş aynı helper'dan
// geldiği için konum ve yön birebir aynıdır.

const SEAT_ORDER = [
  'player-bottom',
  'player-right',
  'player-top',
  'player-left',
]

const invisibleMaterial = new THREE.MeshBasicMaterial({
  transparent: true,
  opacity: 0,
  depthWrite: false,
  depthTest: false,
})

// =====================================================
// STOCK
// =====================================================

const stockRoot = new THREE.Group()
stockRoot.name = 'physicalStockRoot'
scene.add(stockRoot)

const stockTiles = []

for (let i = 0; i < STOCK_VISIBLE_LIMIT; i++) {
  const tile = createHiddenTile()

  tile.rotation.x = -Math.PI / 2
  tile.rotation.z = Math.sin(i * 1.77) * 0.018

  tile.position.set(
    Math.sin(i * 2.14) * 0.006,
    TABLE_TOP_Y + TILE_DEPTH / 2 + i * STOCK_STACK_STEP,
    Math.cos(i * 1.43) * 0.006
  )

  tile.visible = false

  stockTiles.push(tile)
  stockRoot.add(tile)
}

const stockHitbox = new THREE.Mesh(
  new THREE.BoxGeometry(
    TILE_WIDTH * 1.75,
    0.22,
    TILE_HEIGHT * 1.42
  ),
  invisibleMaterial
)

stockHitbox.userData.tableAction = 'draw-stock'
stockRoot.add(stockHitbox)

const stockGlowMaterial = new THREE.MeshBasicMaterial({
  color: 0x72e6b7,
  transparent: true,
  opacity: 0.05,
  depthWrite: false,
  side: THREE.DoubleSide,
})

const stockGlow = new THREE.Mesh(
  new THREE.RingGeometry(0.22, 0.30, 40),
  stockGlowMaterial
)

stockGlow.rotation.x = -Math.PI / 2
stockGlow.position.y = TABLE_TOP_Y + 0.005
stockRoot.add(stockGlow)

// =====================================================
// GOSTERGE — FİZİKSEL MASA TAŞI
// =====================================================

const indicatorVisualGroup = new THREE.Group()
indicatorVisualGroup.name = 'physicalIndicatorVisual'
indicatorAnchor.add(indicatorVisualGroup)

const indicatorHitbox = new THREE.Mesh(
  new THREE.BoxGeometry(
    TILE_WIDTH * 1.34,
    TILE_HEIGHT * 1.20,
    TILE_DEPTH * 2.2
  ),
  invisibleMaterial
)
indicatorHitbox.userData.tableAction = 'indicator'
indicatorHitbox.visible = false
indicatorAnchor.add(indicatorHitbox)

let renderedIndicatorId = null

function renderPhysicalIndicator(gameState) {
  const indicator = gameState?.indicator || null
  if (!indicator) {
    clearGroup(indicatorVisualGroup)
    renderedIndicatorId = null
    indicatorHitbox.visible = false
    return
  }

  if (renderedIndicatorId !== indicator.id) {
    clearGroup(indicatorVisualGroup)
    const tile = createTile(indicator)
    tile.position.set(0, 0, 0)
    tile.scale.setScalar(INDICATOR_SCALE)
    tile.userData.physicalIndicator = true
    indicatorVisualGroup.add(tile)
    renderedIndicatorId = indicator.id
  }

  indicatorHitbox.visible = true
  indicatorHitbox.userData.tileData = indicator
}

// =====================================================
// DISCARD AREAS — ONE FOR EVERY PLAYER
// =====================================================

const discardRoots = {}
const discardVisualGroups = {}
const discardInspectHitboxes = {}
const topDiscardVisuals = {}
const topDiscardTiles = {}

for (const seat of SEAT_ORDER) {
  const root = new THREE.Group()
  root.name = `discardRoot-${seat}`

  // Oyuncunun sürekli görebildiği sabit atma alanı.
  const zone = new THREE.Mesh(
    new THREE.PlaneGeometry(
      DISCARD_ZONE_WIDTH,
      DISCARD_ZONE_DEPTH
    ),
    new THREE.MeshBasicMaterial({
      color: 0x0d3b2c,
      transparent: true,
      opacity: 0.28,
      depthWrite: false,
      side: THREE.DoubleSide,
    })
  )

  zone.rotation.x = -Math.PI / 2
  zone.position.set(
    DISCARD_ZONE_CENTER_X,
    -0.011,
    DISCARD_ZONE_CENTER_Z
  )
  root.add(zone)

  const zoneEdges = new THREE.LineSegments(
    new THREE.EdgesGeometry(
      new THREE.PlaneGeometry(
        DISCARD_ZONE_WIDTH,
        DISCARD_ZONE_DEPTH
      )
    ),
    new THREE.LineBasicMaterial({
      color: 0x6cb99b,
      transparent: true,
      opacity: 0.32,
    })
  )

  zoneEdges.rotation.x = -Math.PI / 2
  zoneEdges.position.set(
    DISCARD_ZONE_CENTER_X,
    -0.009,
    DISCARD_ZONE_CENTER_Z
  )
  root.add(zoneEdges)

  const visual = new THREE.Group()
  visual.name = `discardVisual-${seat}`
  root.add(visual)

  // Her kulenin yalnızca EN ÜST taşı inceleme için tıklanabilir.
  // Hitbox, taşın masada kapladığı gerçek yatay alana yakın tutulur.
  const inspectHitbox = new THREE.Mesh(
    new THREE.BoxGeometry(
      TILE_HEIGHT * 1.22,
      0.16,
      TILE_WIDTH * 1.32
    ),
    invisibleMaterial
  )

  inspectHitbox.userData.tableAction = 'inspect-discard'
  inspectHitbox.userData.discardSeat = seat
  inspectHitbox.visible = false
  root.add(inspectHitbox)

  discardRoots[seat] = root
  discardVisualGroups[seat] = visual
  discardInspectHitboxes[seat] = inspectHitbox
  topDiscardVisuals[seat] = null
  topDiscardTiles[seat] = null

  rackPlaceholders[seat]?.add(root)
}

const takeDiscardHitbox = new THREE.Mesh(
  new THREE.BoxGeometry(
    TILE_WIDTH * 1.15,
    0.14,
    TILE_HEIGHT * 1.12
  ),
  invisibleMaterial
)

takeDiscardHitbox.userData.tableAction = 'take-discard'
takeDiscardHitbox.visible = false

const takeDiscardGlowMaterial = new THREE.MeshBasicMaterial({
  color: 0x6fc8ff,
  transparent: true,
  opacity: 0,
  depthWrite: false,
  side: THREE.DoubleSide,
})

const takeDiscardGlow = new THREE.Mesh(
  new THREE.RingGeometry(0.17, 0.235, 40),
  takeDiscardGlowMaterial
)

takeDiscardGlow.rotation.x = -Math.PI / 2
takeDiscardGlow.visible = false

// Yandan alınıp ıstakaya konmuş taşın geri sürüklenebileceği kaynak kule.
// Yalnızca yerel oyuncuda görünür. Artık tıklamak geri bırakmaz; doğru taşı
// buraya sürükleyip mouse'u bırakmak gerekir.
const returnDiscardHitbox = new THREE.Mesh(
  new THREE.BoxGeometry(
    TILE_HEIGHT * 1.78,
    0.24,
    TILE_WIDTH * 2.05
  ),
  invisibleMaterial
)
returnDiscardHitbox.userData.tableAction = 'return-discard'
returnDiscardHitbox.visible = false

const returnDiscardGlowMaterial = new THREE.MeshBasicMaterial({
  color: 0xffc857,
  transparent: true,
  opacity: 0,
  depthWrite: false,
  side: THREE.DoubleSide,
})

const returnDiscardGlow = new THREE.Mesh(
  new THREE.PlaneGeometry(
    TILE_WIDTH * 1.55,
    TILE_HEIGHT * 1.35
  ),
  returnDiscardGlowMaterial
)
returnDiscardGlow.rotation.x = -Math.PI / 2
returnDiscardGlow.rotation.z = DISCARD_TILE_ROTATION_Z
returnDiscardGlow.visible = false
returnDiscardGlow.renderOrder = 50

const returnSnapWorldPosition = new THREE.Vector3()
const returnSnapLocalPosition = new THREE.Vector3()
const returnSnapRootQuaternion = new THREE.Quaternion()
const returnSnapLocalTileQuaternion = new THREE.Quaternion()
const returnSnapWorldQuaternion = new THREE.Quaternion()
const returnSnapOwnWorldQuaternion = new THREE.Quaternion()
const returnSnapTargetQuaternion = new THREE.Quaternion()
const returnSnapScale = new THREE.Vector3(1.045, 1.045, 1.045)
const returnSnapTileEuler = new THREE.Euler(
  -Math.PI / 2,
  0,
  DISCARD_TILE_ROTATION_Z,
  'XYZ'
)
returnSnapLocalTileQuaternion.setFromEuler(returnSnapTileEuler)

// Sol geri-bırakma hedefi artık mesh raycast sınırına bağlı değil.
// Sağdaki atma alanı gibi mouse'un sabit bir bölgeye girip girmediğine
// bakıyoruz. Girişten sonra biraz daha büyük çıkış sınırı (hysteresis)
// kullanmak küçük mouse titreşimlerinde snap'in aç-kapa yapmasını engeller.
const returnPointerPlane = new THREE.Plane()
const returnPointerPlaneNormal = new THREE.Vector3()
const returnPointerPlanePoint = new THREE.Vector3()
const returnPointerWorldHit = new THREE.Vector3()
const returnPointerLocalHit = new THREE.Vector3()
const returnPointerRootQuaternion = new THREE.Quaternion()
let returnDragCaptureActive = false

let returnDiscardPending = false

let latestDiscardVisual = null
let latestDiscardBaseY = 0
let latestDiscardSeat = null
let discardRecords = []
let lastPileIds = []
let lastRound = null

// Bir taş bir süreliğine yandan alınıp sonra geri konulsa bile gerçek atan
// oyuncusunu unutmayalım. Özellikle cancel-discard-pick sonrası aynı taş id'si
// yeniden görünürken owner tahmini yapmaya gerek kalmaz.
const discardOwnerByTileId = new Map()

// =====================================================
// LOCAL DISCARD INSPECTION PREVIEW
// =====================================================
// Bu önizleme yalnızca bu tarayıcıda oluşturulur. Socket'e hiçbir olay
// gönderilmez; diğer oyuncular büyütülmüş taşı göremez.

const discardInspectionRoot = new THREE.Group()
discardInspectionRoot.name = 'discardInspectionRoot'
discardInspectionRoot.visible = false
scene.add(discardInspectionRoot)

const inspectionBackdrop = new THREE.Mesh(
  new THREE.PlaneGeometry(
    TILE_WIDTH * 1.24,
    TILE_HEIGHT * 1.22
  ),
  new THREE.MeshBasicMaterial({
    color: 0x07100d,
    transparent: true,
    opacity: 0.72,
    depthWrite: false,
    side: THREE.DoubleSide,
  })
)
inspectionBackdrop.position.z = -TILE_DEPTH * 0.95
discardInspectionRoot.add(inspectionBackdrop)

let inspectionTile = null
let inspectionSeat = null
let inspectionTileId = null
let inspectionTargetScale = 0
let inspectionShownScale = 0
let inspectionPulse = 0

function closeDiscardInspection() {
  inspectionSeat = null
  inspectionTileId = null
  inspectionTargetScale = 0
}

function destroyInspectionTile() {
  if (!inspectionTile) return

  discardInspectionRoot.remove(inspectionTile)

  inspectionTile.traverse(object => {
    if (
      object.geometry &&
      !object.geometry.userData?.sharedResource
    ) {
      object.geometry.dispose?.()
    }

    const materials = object.material
      ? (Array.isArray(object.material)
          ? object.material
          : [object.material])
      : []

    for (const material of materials) {
      if (material?.userData?.sharedResource) continue

      material?.map?.dispose?.()
      material?.alphaMap?.dispose?.()
      material?.dispose?.()
    }
  })

  inspectionTile = null
}

function getInspectionAnchorWorld(seat) {
  if (seat === 'indicator') {
    const point = new THREE.Vector3()
    indicatorAnchor.getWorldPosition(point)
    point.y += 0.92
    return point
  }

  const visual = topDiscardVisuals[seat]
  if (!visual) return null

  const point = new THREE.Vector3()
  visual.getWorldPosition(point)
  point.y += 0.92
  return point
}

function showIndicatorInspection(tileData) {
  if (!tileData) return

  // Gösterge de atık kulesindeki taşla aynı yerel büyütme sistemini kullanır.
  showDiscardInspection('indicator', tileData)
}

function showDiscardInspection(seat, tileData) {
  if (!seat || !tileData) return

  // Aynı taşa tekrar tıklamak önizlemeyi kapatır.
  if (
    inspectionSeat === seat &&
    inspectionTileId === tileData.id &&
    inspectionTargetScale > 0
  ) {
    closeDiscardInspection()
    return
  }

  destroyInspectionTile()

  inspectionTile = createTile(tileData)
  inspectionTile.userData.localDiscardInspection = true
  inspectionTile.position.set(0, 0, 0)
  inspectionTile.rotation.set(0, 0, 0)
  discardInspectionRoot.add(inspectionTile)

  inspectionSeat = seat
  inspectionTileId = tileData.id
  inspectionTargetScale = 4.0
  inspectionShownScale = 0.55

  discardInspectionRoot.scale.setScalar(inspectionShownScale)

  const anchor = getInspectionAnchorWorld(seat)
  if (anchor) {
    discardInspectionRoot.position.copy(anchor)
  }

  // Kamera quaternion'ını kopyalamak taşın ön yüzünü ekrana dönük tutar.
  discardInspectionRoot.quaternion.copy(camera.quaternion)
  discardInspectionRoot.visible = true
}

// =====================================================
// HELPERS
// =====================================================

const pointer = new THREE.Vector2()
const raycaster = new THREE.Raycaster()

let hoverAction = null
let pointerIsTouch = false
let stockHoverAmount = 0
let discardHoverAmount = 0
let pulseTime = 0
let mobileTakeDiscardListener = null
let mobileDrawStockListener = null
let mobileReturnDiscardListener = null

function setPointerFromClient(clientX, clientY) {
  const rect = renderer.domElement.getBoundingClientRect()
  if (!(rect.width > 0) || !(rect.height > 0)) return false

  pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1
  pointer.y = -(((clientY - rect.top) / rect.height) * 2 - 1)
  return true
}

function updatePointer(event) {
  setPointerFromClient(event.clientX, event.clientY)
  pointerIsTouch = isTouchPointerEvent(event)
  state.pointerClientX = event.clientX
  state.pointerClientY = event.clientY
}

function isMyTurn() {
  return Boolean(
    state.publicGameState?.currentSeat &&
    state.publicGameState.currentSeat === state.localSeat
  )
}

function normalizeDiscardTile(value) {
  if (!value) return null

  if (value.tile) {
    return normalizeDiscardTile(value.tile)
  }

  if (
    value.id &&
    (
      value.type === 'fake-joker' ||
      value.type === 'normal' ||
      value.number !== undefined
    )
  ) {
    return value
  }

  return null
}

function getDiscardPileTiles(gameState) {
  const pile = gameState?.discardPile

  if (Array.isArray(pile)) {
    return pile
      .map(normalizeDiscardTile)
      .filter(Boolean)
  }

  const single =
    normalizeDiscardTile(gameState?.discardTop) ||
    normalizeDiscardTile(gameState?.topDiscard) ||
    normalizeDiscardTile(gameState?.lastDiscard)

  return single ? [single] : []
}

function nextSeat(seat, amount = 1) {
  const index = SEAT_ORDER.indexOf(seat)
  if (index < 0) return SEAT_ORDER[0]

  return SEAT_ORDER[
    (index + amount + SEAT_ORDER.length * 10) % SEAT_ORDER.length
  ]
}

function inferStarterSeat(gameState) {
  if (SEAT_ORDER.includes(gameState?.starter)) {
    return gameState.starter
  }

  if (
    Number.isInteger(gameState?.starter) &&
    gameState?.players?.[gameState.starter]?.seat
  ) {
    return gameState.players[gameState.starter].seat
  }

  if (SEAT_ORDER.includes(gameState?.dealerSeat)) {
    return nextSeat(gameState.dealerSeat, 1)
  }

  return SEAT_ORDER[0]
}

function previousSeat(seat) {
  return nextSeat(seat, -1)
}

function inferNewestDiscardOwner(gameState, previousGameState) {
  // En güvenilir bilgi: discard gerçekleşmeden hemen önce sıra kimdeydi?
  // game-state event'i discard sonrasında geldiği için previousGameState.currentSeat
  // normal akışta taşı atan oyuncudur.
  if (SEAT_ORDER.includes(previousGameState?.currentSeat)) {
    return previousGameState.currentSeat
  }

  // Yeniden bağlanma / ilk state gibi previous state olmayan durumda,
  // sıradaki oyuncunun hemen solundaki (seat order'da bir önceki) oyuncu
  // son taşı atmış olmalıdır. Okey akışımız bottom -> right -> top -> left.
  if (SEAT_ORDER.includes(gameState?.currentSeat)) {
    return previousSeat(gameState.currentSeat)
  }

  return inferStarterSeat(gameState)
}

function findDiscardRecordIndex(tileId) {
  if (!tileId) return -1

  for (let i = discardRecords.length - 1; i >= 0; i--) {
    if (discardRecords[i]?.tile?.id === tileId) {
      return i
    }
  }

  return -1
}

function removeDiscardRecord(tileId) {
  const index = findDiscardRecordIndex(tileId)
  if (index >= 0) {
    discardRecords.splice(index, 1)
  }
}

// take-discard başarılı olduktan sonra server taşı discardPile'dan zaten
// çıkarmıştır. Client'ın yerel fiziksel atık geçmişi reconnect/çok hızlı state
// geçişlerinde o eski tile id'sini tutabiliyordu. Başarılı ACK geldiği anda
// yalnız o görsel kaydı kesin olarak kaldırıyoruz. Owner bilgisini silmiyoruz;
// oyuncu masada işlem yapmadan taşı geri koyarsa aynı kuleye geri dönebilsin.
function confirmDiscardTakenVisual(tileId) {
  if (!tileId) return

  removeDiscardRecord(tileId)
  lastPileIds = lastPileIds.filter(id => id !== tileId)

  if (activeDiscardTopId === tileId) {
    const publicTop =
      normalizeDiscardTile(state.publicGameState?.discardTop) ||
      normalizeDiscardTile(state.publicGameState?.topDiscard) ||
      normalizeDiscardTile(state.publicGameState?.lastDiscard)

    activeDiscardTopId =
      publicTop && publicTop.id !== tileId
        ? publicTop.id
        : null
  }

  if (inspectionTileId === tileId) {
    closeDiscardInspection()
  }

  renderDiscardAreas(state.publicGameState || {})
}

function handleDiscardTakenVisualEvent(payload) {
  confirmDiscardTakenVisual(payload?.tileId)
}

let activeDiscardTopId = null

function seedHistoryFromFullPile(pile, gameState, previousGameState) {
  if (!pile.length) return

  // İlk state'te birden fazla discard geldiyse, mümkün olduğunca sıra sırasına
  // göre dağıt. Bundan sonraki yeni discard'lar canlı olarak kesin owner ile
  // izleneceği için bu yalnız reconnect/round ortasında giriş fallback'idir.
  const newestOwner = inferNewestDiscardOwner(gameState, previousGameState)
  let owner = nextSeat(newestOwner, -(pile.length - 1))

  for (const tile of pile) {
    discardRecords.push({
      tile,
      ownerSeat: owner,
    })
    discardOwnerByTileId.set(tile.id, owner)

    owner = nextSeat(owner, 1)
  }
}

function reconcileDiscardHistory(gameState, previousGameState) {
  const pile = getDiscardPileTiles(gameState)
  const currentIds = pile.map(tile => tile.id)
  const currentTop = pile.length ? pile[pile.length - 1] : null
  const previousTopId = lastPileIds.length
    ? lastPileIds[lastPileIds.length - 1]
    : activeDiscardTopId

  const roundChanged =
    lastRound !== null &&
    gameState?.round !== lastRound

  if (roundChanged) {
    discardRecords = []
    discardOwnerByTileId.clear()
    lastPileIds = []
    activeDiscardTopId = null
  }

  // ---------------------------------------------------
  // SUNUCU ŞU AN ATILMIŞ TAŞ GÖSTERMİYOR
  // ---------------------------------------------------
  // Bu genellikle son atığın alındığı anlamına gelir. Sadece gerçekten aktif
  // olan taşı sahibinin kulesinden çıkarıyoruz; diğer oyuncuların eski atıkları
  // yerinde kalmaya devam ediyor.
  if (!currentTop) {
    if (activeDiscardTopId) {
      removeDiscardRecord(activeDiscardTopId)
    }

    activeDiscardTopId = null
    lastPileIds = []
    lastRound = gameState?.round ?? lastRound
    return
  }

  // ---------------------------------------------------
  // İLK GÖZLEM / RECONNECT
  // ---------------------------------------------------
  if (discardRecords.length === 0) {
    if (pile.length > 1) {
      seedHistoryFromFullPile(pile, gameState, previousGameState)
    } else {
      const ownerSeat =
        discardOwnerByTileId.get(currentTop.id) ||
        inferNewestDiscardOwner(gameState, previousGameState)

      discardRecords.push({
        tile: currentTop,
        ownerSeat,
      })
      discardOwnerByTileId.set(currentTop.id, ownerSeat)
    }

    activeDiscardTopId = currentTop.id
    lastPileIds = currentIds
    lastRound = gameState?.round ?? lastRound
    return
  }

  const existingCurrentIndex = findDiscardRecordIndex(currentTop.id)

  // ---------------------------------------------------
  // AKTİF ÜST TAŞ DEĞİŞTİ
  // ---------------------------------------------------
  if (currentTop.id !== activeDiscardTopId) {
    // Yeni üst taş daha önce gördüğümüz bir taşsa son aktif taş alınmış ve
    // altındaki taş yeniden üstte kalmış demektir. Alınan taşı kulesinden sil.
    if (existingCurrentIndex >= 0) {
      if (activeDiscardTopId) {
        removeDiscardRecord(activeDiscardTopId)
      }

      const refreshedIndex = findDiscardRecordIndex(currentTop.id)
      if (refreshedIndex >= 0) {
        discardRecords[refreshedIndex].tile = currentTop
      }
    }

    // Daha önce görmediğimiz bir id ise yeni bir discard gerçekleşmiştir.
    else {
      const ownerSeat =
        discardOwnerByTileId.get(currentTop.id) ||
        inferNewestDiscardOwner(gameState, previousGameState)

      discardRecords.push({
        tile: currentTop,
        ownerSeat,
      })
      discardOwnerByTileId.set(currentTop.id, ownerSeat)
    }

    activeDiscardTopId = currentTop.id
  }

  // Aynı taş id'si devam ediyorsa güncel tile objesini koru.
  else {
    const index = findDiscardRecordIndex(currentTop.id)
    if (index >= 0) {
      discardRecords[index].tile = currentTop
    }
  }

  // Eğer sunucu tam discardPile geçmişi gönderiyorsa, reconnect sonrası bizim
  // kaçırdığımız id'leri de ekle. Canlı akışta zaten yukarıdaki yol çalışır.
  if (pile.length > 1) {
    for (const tile of pile) {
      if (findDiscardRecordIndex(tile.id) >= 0) continue

      // Eski bir taşı kesin owner bilgisi olmadan eklemek gerektiğinde, pile
      // içindeki sırasını aktif top'a göre geriye doğru hesapla.
      const distanceFromTop = pile.length - 1 - pile.findIndex(t => t.id === tile.id)
      const newestOwner = inferNewestDiscardOwner(gameState, previousGameState)

      const ownerSeat =
        discardOwnerByTileId.get(tile.id) ||
        nextSeat(newestOwner, -distanceFromTop)

      discardRecords.push({
        tile,
        ownerSeat,
      })
      discardOwnerByTileId.set(tile.id, ownerSeat)
    }
  }

  lastPileIds = currentIds
  lastRound = gameState?.round ?? lastRound
}

function publishMobileDiscardState(gameState, canTakeLatest = false) {
  const localSeat = SEAT_ORDER.includes(state.localSeat)
    ? state.localSeat
    : null
  const leftSeat = localSeat ? previousSeat(localSeat) : null
  const leftTile = leftSeat ? (topDiscardTiles[leftSeat] || null) : null
  const ownTile = localSeat ? (topDiscardTiles[localSeat] || null) : null
  const leftIsActive = Boolean(
    leftSeat &&
    leftTile?.id &&
    latestDiscardSeat === leftSeat &&
    activeDiscardTopId === leftTile.id
  )

  window.dispatchEvent(new CustomEvent('okey:mobile-discard-state', {
    detail: {
      leftSeat,
      leftTile,
      ownTile,
      ownCount: localSeat
        ? Math.max(0, Number(state.discardCountsBySeat?.[localSeat]) || 0)
        : 0,
      canTake: Boolean(canTakeLatest && leftIsActive),
      blockedPlayable: Boolean(
        leftIsActive &&
        gameState?.currentSeat === localSeat &&
        gameState?.discardTopPlayable
      ),
      stockCount: Math.max(0, Number(gameState?.stockCount) || 0),
      canDrawStock: Boolean(
        localSeat &&
        gameState?.currentSeat === localSeat &&
        Math.max(0, Number(gameState?.stockCount) || 0) > 0 &&
        !state.privateHandState?.mustDiscard &&
        !state.pendingTablePickup &&
        !state.isStickyPickup &&
        !state.isDraggingTile
      ),
    },
  }))
}

function renderDiscardAreas(gameState) {
  latestDiscardVisual = null
  latestDiscardSeat = null
  takeDiscardHitbox.visible = false
  takeDiscardGlow.visible = false

  for (const seat of SEAT_ORDER) {
    clearGroup(discardVisualGroups[seat])
    topDiscardVisuals[seat] = null
    topDiscardTiles[seat] = null
    discardInspectHitboxes[seat].visible = false
    discardInspectHitboxes[seat].userData.tileData = null
  }

  const counts = Object.fromEntries(
    SEAT_ORDER.map(seat => [seat, 0])
  )

  discardRecords.forEach((record, globalIndex) => {
    const seat = SEAT_ORDER.includes(record.ownerSeat)
      ? record.ownerSeat
      : SEAT_ORDER[globalIndex % SEAT_ORDER.length]

    const seatDiscardIndex = counts[seat]
    counts[seat] += 1

    const slot = getDiscardSlotLocalPosition(
      seatDiscardIndex
    )

    const tile = createTile(record.tile)
    tile.rotation.x = -Math.PI / 2
    tile.rotation.z = DISCARD_TILE_ROTATION_Z
    tile.position.set(
      slot.x,
      slot.y,
      slot.z
    )
    tile.scale.setScalar(0.99)

    discardVisualGroups[seat].add(tile)

    // Aynı oyuncunun yeni atığı geldikçe bu referans güncellenir; döngü
    // bittiğinde her koltuk için yalnızca kulenin en üst taşı kalır.
    topDiscardVisuals[seat] = tile
    topDiscardTiles[seat] = record.tile

    if (record.tile?.id === activeDiscardTopId) {
      latestDiscardVisual = tile
      latestDiscardBaseY = slot.y
      latestDiscardSeat = seat

      takeDiscardHitbox.position.set(
        slot.x,
        slot.y + 0.050,
        slot.z
      )

      takeDiscardGlow.position.set(
        slot.x,
        -0.007,
        slot.z
      )

      discardRoots[seat].add(takeDiscardHitbox)
      discardRoots[seat].add(takeDiscardGlow)
    }
  })

  // Her oyuncunun en üst atığını inceleme için tıklanabilir yap.
  for (const seat of SEAT_ORDER) {
    const topVisual = topDiscardVisuals[seat]
    const topTile = topDiscardTiles[seat]
    const inspectHitbox = discardInspectHitboxes[seat]

    if (topVisual && topTile) {
      inspectHitbox.position.copy(topVisual.position)
      inspectHitbox.position.y += 0.060
      inspectHitbox.userData.tileData = topTile
      inspectHitbox.userData.discardIndex = Math.max(0, counts[seat] - 1)
      inspectHitbox.visible = true
    }
  }

  // Aktif önizlemedeki taş artık o kulenin en üst taşı değilse kapat.
  if (
    SEAT_ORDER.includes(inspectionSeat) &&
    inspectionTileId
  ) {
    const currentTop = topDiscardTiles[inspectionSeat]

    if (!currentTop || currentTop.id !== inspectionTileId) {
      closeDiscardInspection()
    }
  }

  // Rack'teki yeşil atma önizlemesi bir sonraki boş slotu buradan bilir.
  for (const seat of SEAT_ORDER) {
    state.discardCountsBySeat[seat] = counts[seat]
  }

  const latestExists = Boolean(
    activeDiscardTopId &&
    latestDiscardSeat
  )

  // Bir discard'ı yalnız onu ATAN oyuncunun SAĞINDAKİ oyuncu alabilir.
  // Diğer üç oyuncu (taşı atan dahil) aynı taşa tıkladığında sadece inceleme
  // önizlemesini görür.
  const receiverSeat = latestDiscardSeat
    ? nextSeat(latestDiscardSeat, 1)
    : null

  const canTakeLatest =
    latestExists &&
    receiverSeat === state.localSeat &&
    gameState?.currentSeat === state.localSeat &&
    !gameState?.discardTopPlayable &&
    !state.pendingTablePickup &&
    !state.isStickyPickup

  takeDiscardHitbox.visible = canTakeLatest
  takeDiscardGlow.visible = latestExists
  publishMobileDiscardState(gameState, canTakeLatest)
}

function getActionAtPointer(event = null) {
  const targets = [
    stockHitbox,
    ...(indicatorHitbox.visible ? [indicatorHitbox] : []),
    ...SEAT_ORDER
      .map(seat => discardInspectHitboxes[seat])
      .filter(hitbox => hitbox?.visible),
  ]

  raycaster.setFromCamera(pointer, camera)
  let hit = raycaster.intersectObjects(targets, false)[0] || null

  // Telefon ekranında balya/atık görseli küçük kalabilir. Fiziksel hitbox'ları
  // büyütmek yerine yalnız touch'ta yakın çevrede birkaç ray örneği alıyoruz;
  // böylece masaüstü raycast'i ve hedeflerin dünya geometrisi değişmez.
  if (!hit && isTouchPointerEvent(event)) {
    const offsets = [
      [0, -18], [0, 18], [-18, 0], [18, 0],
      [-13, -13], [13, -13], [-13, 13], [13, 13],
      [0, -28], [0, 28], [-28, 0], [28, 0],
    ]

    for (const [dx, dy] of offsets) {
      if (!setPointerFromClient(event.clientX + dx, event.clientY + dy)) continue
      raycaster.setFromCamera(pointer, camera)
      hit = raycaster.intersectObjects(targets, false)[0] || null
      if (hit) break
    }

    // Sonraki drag/return hesapları gerçek parmak koordinatından devam etsin.
    setPointerFromClient(event.clientX, event.clientY)
  }

  if (!hit) return null

  const object = hit.object
  const action = object.userData?.tableAction

  if (action === 'draw-stock') {
    return { action: 'draw-stock' }
  }

  if (action === 'indicator') {
    const tileData = object.userData?.tileData || state.publicGameState?.indicator || null
    return { action: 'inspect-indicator', tileData }
  }

  if (action === 'inspect-discard') {
    const seat = object.userData?.discardSeat
    const tileData = object.userData?.tileData

    // Sana gerçekten alınabilir olan global son taşta eski davranış korunur:
    // tıklamak inceleme değil, taşı alma isteğidir.
    const receiverSeat = latestDiscardSeat
      ? nextSeat(latestDiscardSeat, 1)
      : null

    const canTakeThis =
      tileData?.id === activeDiscardTopId &&
      seat === latestDiscardSeat &&
      receiverSeat === state.localSeat &&
      takeDiscardHitbox.visible &&
      isMyTurn()

    if (canTakeThis) {
      return {
        action: 'take-discard',
        seat,
        tileData,
        sourceIndex: Number.isInteger(object.userData?.discardIndex)
          ? object.userData.discardIndex
          : null,
      }
    }

    const blockedPlayableDiscard = Boolean(
      tileData?.id === activeDiscardTopId &&
      seat === latestDiscardSeat &&
      receiverSeat === state.localSeat &&
      state.publicGameState?.currentSeat === state.localSeat &&
      state.publicGameState?.discardTopPlayable
    )

    if (blockedPlayableDiscard) {
      return {
        action: 'blocked-playable-discard',
        seat,
        tileData,
      }
    }

    return {
      action: 'inspect-discard',
      seat,
      tileData,
    }
  }

  return null
}

function updateCursor() {
  if (state.isDraggingTile) return

  if (state.pendingTablePickup) {
    renderer.domElement.style.cursor = 'wait'
    return
  }

  if (state.isStickyPickup) {
    renderer.domElement.style.cursor = 'grabbing'
    return
  }

  renderer.domElement.style.cursor =
    hoverAction ? 'pointer' : 'default'
}

function beginPickupRequest(target, socket, setMessage) {
  const action = target?.action
  if (state.pendingTablePickup || state.isStickyPickup) {
    return
  }

  if (!isMyTurn()) {
    setMessage('Sıra sende değil.')
    return
  }

  const requestId = `${Date.now()}-${Math.random()}`
  const beforeIds = (state.privateHandState?.hand || []).map(tile => tile.id)

  state.pendingTablePickup = {
    requestId,
    source: action === 'draw-stock' ? 'stock' : 'discard',
    beforeIds,
    sourceSeat: action === 'take-discard' ? (target?.seat || null) : null,
    sourceIndex:
      action === 'take-discard' && Number.isInteger(target?.sourceIndex)
        ? target.sourceIndex
        : null,
  }

  state.isTableInteracting = true
  hoverAction = null
  updateCursor()

  const eventName = action === 'draw-stock' ? 'draw-stock' : 'take-discard'

  setMessage(action === 'draw-stock' ? 'Taş çekiliyor…' : 'Atılan taş alınıyor…')

  socket.emit(eventName, result => {
    const pending = state.pendingTablePickup

    if (!result?.ok) {
      if (pending?.requestId === requestId) {
        state.pendingTablePickup = null
        state.isTableInteracting = false
      }

      setMessage(
        result?.message ||
        (action === 'draw-stock' ? 'Taş çekilemedi.' : 'Taş alınamadı.')
      )

      updateCursor()
      return
    }

    // Yandan alınan taş server tarafında discardPile.pop() ile çıkarıldı.
    // Yerel fiziksel kule kaydını da ACK anında kesin temizle; böylece taş
    // sonrasında açılışta kullanılsa bile eski görseli atık stackinde kalmaz.
    if (action === 'take-discard') {
      confirmDiscardTakenVisual(target?.tileData?.id || result?.tile?.id)
    }

    // Başarılı hand-state geldiğinde network.js yeni taşı tespit edip
    // mouse'a yapıştıracak. Burada pending'i özellikle temizlemiyoruz.
    setMessage('Taşı ıstakada istediğin yere bırak.')
  })
}

// =====================================================
// RETURN PICKED DISCARD TARGET
// =====================================================

function getActiveReturnDiscardInfo() {
  if (
    state.isStickyPickup &&
    state.stickyPickupSource === 'discard' &&
    state.stickyPickupTileId &&
    SEAT_ORDER.includes(state.stickyPickupReturnSeat) &&
    Number.isInteger(state.stickyPickupReturnIndex)
  ) {
    return {
      tileId: state.stickyPickupTileId,
      seat: state.stickyPickupReturnSeat,
      index: state.stickyPickupReturnIndex,
      sticky: true,
    }
  }

  if (
    state.returnableDiscardTileId &&
    (state.privateHandState?.hand || []).some(
      tile => tile.id === state.returnableDiscardTileId
    ) &&
    SEAT_ORDER.includes(state.returnableDiscardSeat) &&
    Number.isInteger(state.returnableDiscardIndex)
  ) {
    return {
      tileId: state.returnableDiscardTileId,
      seat: state.returnableDiscardSeat,
      index: state.returnableDiscardIndex,
      sticky: false,
    }
  }

  return null
}

function isStickyDiscardPickupReturnActive() {
  return Boolean(getActiveReturnDiscardInfo()?.sticky)
}

function updateReturnDiscardTarget() {
  const returnInfo = getActiveReturnDiscardInfo()
  const seat = returnInfo?.seat || null
  const index = returnInfo?.index ?? null

  const active = Boolean(returnInfo && isMyTurn())

  returnDiscardHitbox.visible = active
  returnDiscardGlow.visible = active

  if (!active) {
    returnDragCaptureActive = false
    state.returnDiscardDropReady = false
    returnDiscardGlowMaterial.opacity = 0
    return
  }

  const root = discardRoots[seat]
  if (!root) return

  if (returnDiscardHitbox.parent !== root) {
    returnDiscardHitbox.parent?.remove(returnDiscardHitbox)
    root.add(returnDiscardHitbox)
  }

  if (returnDiscardGlow.parent !== root) {
    returnDiscardGlow.parent?.remove(returnDiscardGlow)
    root.add(returnDiscardGlow)
  }

  const slot = getDiscardSlotLocalPosition(index)

  returnDiscardHitbox.position.set(
    slot.x,
    slot.y + 0.065,
    slot.z
  )

  returnDiscardGlow.position.set(
    slot.x,
    -0.006,
    slot.z
  )
}

function isPointerInsideReturnDiscardArea(expanded = false) {
  if (!returnDiscardHitbox.visible) return false

  // Telefonda fiziksel 3D discard stack'i kamerada görünmek zorunda değil.
  // Soldaki floating SOLDAN AL paneli, yandan alınmış taşı geri bırakmak için
  // aynı authoritative cancel-discard-pick hedefi olarak davranır.
  if (
    pointerIsTouch &&
    isMobileIncomingDiscardDropPoint(
      Number(state.pointerClientX) || -9999,
      Number(state.pointerClientY) || -9999
    )
  ) {
    return true
  }

  const returnInfo = getActiveReturnDiscardInfo()
  const seat = returnInfo?.seat || null
  const index = returnInfo?.index ?? null

  if (
    !SEAT_ORDER.includes(seat) ||
    !Number.isInteger(index)
  ) {
    return false
  }

  const root = discardRoots[seat]
  if (!root) return false

  const slot = getDiscardSlotLocalPosition(index)

  root.updateWorldMatrix(true, false)
  root.getWorldQuaternion(returnPointerRootQuaternion)

  returnPointerPlaneNormal
    .set(0, 1, 0)
    .applyQuaternion(returnPointerRootQuaternion)
    .normalize()

  returnPointerPlanePoint.set(
    slot.x,
    slot.y + 0.04,
    slot.z
  )
  root.localToWorld(returnPointerPlanePoint)

  returnPointerPlane.setFromNormalAndCoplanarPoint(
    returnPointerPlaneNormal,
    returnPointerPlanePoint
  )

  raycaster.setFromCamera(pointer, camera)

  const hit = raycaster.ray.intersectPlane(
    returnPointerPlane,
    returnPointerWorldHit
  )

  if (!hit) return false

  returnPointerLocalHit.copy(hit)
  root.worldToLocal(returnPointerLocalHit)

  // Giriş alanı zaten sağdaki atma bölgesi gibi affedici. Hedefe
  // yakalandıktan sonra çıkış alanını %30 kadar büyütüyoruz.
  const releaseScale = (expanded ? 1.30 : 1) * (pointerIsTouch ? 1.22 : 1)
  const halfX = TILE_HEIGHT * 1.08 * releaseScale
  const halfZ = TILE_WIDTH * 1.55 * releaseScale

  return (
    Math.abs(returnPointerLocalHit.x - slot.x) <= halfX &&
    Math.abs(returnPointerLocalHit.z - slot.z) <= halfZ
  )
}

function updateReturnDragCapture() {
  const canCapture =
    !returnDiscardPending &&
    returnDiscardHitbox.visible &&
    (
      isDraggingReturnableDiscardTile() ||
      isStickyDiscardPickupReturnActive()
    )

  if (!canCapture) {
    returnDragCaptureActive = false
    state.returnDiscardDropReady = false
    return false
  }

  const inside = isPointerInsideReturnDiscardArea(
    returnDragCaptureActive
  )

  returnDragCaptureActive = inside
  state.returnDiscardDropReady = inside
  return inside
}

function getReturnDiscardSnapTransform() {
  const returnInfo = getActiveReturnDiscardInfo()
  const seat = returnInfo?.seat || null
  const index = returnInfo?.index ?? null

  if (
    !SEAT_ORDER.includes(seat) ||
    !Number.isInteger(index)
  ) {
    return null
  }

  const root = discardRoots[seat]
  if (!root) return null

  const slot = getDiscardSlotLocalPosition(index)

  returnSnapWorldPosition.set(
    slot.x,
    slot.y,
    slot.z
  )
  root.localToWorld(returnSnapWorldPosition)

  returnSnapLocalPosition.copy(returnSnapWorldPosition)
  ownTilesGroup.worldToLocal(returnSnapLocalPosition)

  root.getWorldQuaternion(returnSnapRootQuaternion)
  returnSnapWorldQuaternion
    .copy(returnSnapRootQuaternion)
    .multiply(returnSnapLocalTileQuaternion)

  ownTilesGroup.getWorldQuaternion(returnSnapOwnWorldQuaternion)
  returnSnapTargetQuaternion
    .copy(returnSnapOwnWorldQuaternion)
    .invert()
    .multiply(returnSnapWorldQuaternion)

  return {
    position: returnSnapLocalPosition,
    quaternion: returnSnapTargetQuaternion,
  }
}

function snapReturnableDraggedTile() {
  if (
    !state.returnDiscardDropReady ||
    !isDraggingReturnableDiscardTile() ||
    !state.draggedObject
  ) {
    return
  }

  const target = getReturnDiscardSnapTransform()
  if (!target) return

  // Sağdaki normal atma alanıyla aynı hızlı, yumuşak snap hissi.
  state.draggedObject.position.lerp(
    target.position,
    0.30
  )

  state.draggedObject.quaternion.slerp(
    target.quaternion,
    0.30
  )

  state.draggedObject.scale.lerp(
    returnSnapScale,
    0.24
  )
}

export function resetTableVisualState() {
  discardRecords = []
  lastPileIds = []
  lastRound = null
  activeDiscardTopId = null
  discardOwnerByTileId.clear()

  latestDiscardVisual = null
  latestDiscardBaseY = 0
  latestDiscardSeat = null
  returnDiscardPending = false
  returnDragCaptureActive = false
  hoverAction = null
  stockHoverAmount = 0
  discardHoverAmount = 0

  state.returnableDiscardTileId = null
  state.returnableDiscardSeat = null
  state.returnableDiscardIndex = null
  state.returnDiscardDropReady = false

  for (const seat of SEAT_ORDER) {
    state.discardCountsBySeat[seat] = 0
    clearGroup(discardVisualGroups[seat])
    topDiscardVisuals[seat] = null
    topDiscardTiles[seat] = null
    discardInspectHitboxes[seat].visible = false
    discardInspectHitboxes[seat].userData.tileData = null
  }

  takeDiscardHitbox.visible = false
  takeDiscardGlow.visible = false
  returnDiscardHitbox.visible = false
  returnDiscardGlow.visible = false
  returnDiscardGlowMaterial.opacity = 0

  closeDiscardInspection()
  destroyInspectionTile()
  discardInspectionRoot.visible = false
  inspectionShownScale = 0
  publishMobileDiscardState({}, false)
}

// =====================================================
// PUBLIC API
// =====================================================

export function attachTableActionsToSeat() {
  // Discard alanları artık tüm oyuncuların rack placeholder'larına kalıcı
  // bağlı. Local seat değişince özel bir taşıma yapmaya gerek yok.
}

export function updateTableActionVisuals(
  gameState,
  previousGameState = null
) {
  const stockCount = Math.max(
    0,
    Number(gameState?.stockCount || 0)
  )

  const visibleStockTiles = Math.min(
    STOCK_VISIBLE_LIMIT,
    stockCount
  )

  for (let i = 0; i < stockTiles.length; i++) {
    stockTiles[i].visible = i < visibleStockTiles
  }

  const stockTopY =
    TABLE_TOP_Y +
    TILE_DEPTH / 2 +
    Math.max(0, visibleStockTiles - 1) * STOCK_STACK_STEP

  stockHitbox.position.set(0, stockTopY + 0.06, 0)

  renderPhysicalIndicator(gameState)
  reconcileDiscardHistory(gameState, previousGameState)
  renderDiscardAreas(gameState)
}

export function setupTableInteractions(
  socket,
  setMessage = () => {}
) {
  // Fiziksel discard kuleleri her clientta yerel geçmiş olarak tutuluyor.
  // Başka bir oyuncu yandan taşı aldığında da o taşı anında kendi görsel
  // kaydımızdan çıkarabilmek için server'ın public discard-taken olayını dinle.
  socket.off('discard-taken', handleDiscardTakenVisualEvent)
  socket.on('discard-taken', handleDiscardTakenVisualEvent)

  // Rack-odaklı mobil kamera masa merkezindeki balyayı göstermediği için
  // floating BALYA kartı aynı authoritative draw-stock akışını çağırır. Yeni
  // kural yoktur; sıra / mustDiscard / stock kontrollerini server yine yapar.
  if (mobileDrawStockListener) {
    window.removeEventListener('okey:mobile-draw-stock', mobileDrawStockListener)
  }
  mobileDrawStockListener = () => {
    if (state.isDraggingTile || state.pendingTablePickup || state.isStickyPickup) return
    if (!isMyTurn()) {
      setMessage('Sıra sende değil.')
      return
    }
    if (Math.max(0, Number(state.publicGameState?.stockCount) || 0) <= 0) {
      setMessage('Balya boş.')
      return
    }
    if (state.privateHandState?.mustDiscard) {
      setMessage('Önce elindeki fazla taşı atmalısın.')
      return
    }
    beginPickupRequest({ action: 'draw-stock' }, socket, setMessage)
  }
  window.addEventListener('okey:mobile-draw-stock', mobileDrawStockListener)

  // Mobilde sol-alt panel fiziksel 3D kuleye küçük bir raycast atmayı
  // gerektirmeden aynı güvenli take-discard akışını çağırır. Server doğrulaması
  // değişmez; panel yalnız mevcut hedefi erişilebilir hale getirir.
  if (mobileTakeDiscardListener) {
    window.removeEventListener('okey:mobile-take-discard', mobileTakeDiscardListener)
  }
  mobileTakeDiscardListener = () => {
    if (state.isDraggingTile || state.pendingTablePickup || state.isStickyPickup) return

    const leftSeat = SEAT_ORDER.includes(state.localSeat)
      ? previousSeat(state.localSeat)
      : null
    const leftTile = leftSeat ? topDiscardTiles[leftSeat] : null
    const receiverSeat = latestDiscardSeat
      ? nextSeat(latestDiscardSeat, 1)
      : null
    const canTake = Boolean(
      leftSeat &&
      leftTile?.id &&
      latestDiscardSeat === leftSeat &&
      activeDiscardTopId === leftTile.id &&
      receiverSeat === state.localSeat &&
      state.publicGameState?.currentSeat === state.localSeat &&
      !state.publicGameState?.discardTopPlayable &&
      takeDiscardHitbox.visible
    )

    if (!canTake) {
      setMessage(
        state.publicGameState?.discardTopPlayable
          ? 'BU TAŞ İŞLEK, ALAMAZSIN'
          : 'Soldaki atık şu anda alınamaz.'
      )
      return
    }

    beginPickupRequest({
      action: 'take-discard',
      seat: leftSeat,
      tileData: leftTile,
      sourceIndex: Math.max(0, (state.discardCountsBySeat?.[leftSeat] || 1) - 1),
    }, socket, setMessage)
  }
  window.addEventListener('okey:mobile-take-discard', mobileTakeDiscardListener)

  // Mobil floating SOLDAN AL paneli, taş sticky haldeyken de rack'e
  // yerleştirildikten sonra da geri bırakma düğmesi gibi çalışır. Server'daki
  // cancel-discard-pick doğrulaması değişmez.
  if (mobileReturnDiscardListener) {
    window.removeEventListener('okey:mobile-return-discard', mobileReturnDiscardListener)
  }
  mobileReturnDiscardListener = () => {
    if (returnDiscardPending) return

    const returnInfo = getActiveReturnDiscardInfo()
    if (!returnInfo || !isMyTurn()) {
      setMessage('Geri bırakılabilecek yandan alınmış taş yok.')
      return
    }

    returnDiscardPending = true
    state.returnDiscardDropReady = false
    setMessage('Yandan alınan taş geri bırakılıyor…')

    socket.emit('cancel-discard-pick', result => {
      returnDiscardPending = false

      if (!result?.ok) {
        setMessage(result?.message || 'Taş geri bırakılamadı.')
        updateReturnDiscardTarget()
        return
      }

      if (returnInfo.sticky) {
        cancelStickyPickupVisual({ render: false })
      } else {
        state.returnableDiscardTileId = null
        state.returnableDiscardSeat = null
        state.returnableDiscardIndex = null
        cancelRackDragVisual({ render: false })
        renderOwnHand()
      }

      returnDragCaptureActive = false
      state.returnDiscardDropReady = false
      updateReturnDiscardTarget()
      setMessage('Taş soldaki atık alanına geri bırakıldı.')
    })
  }
  window.addEventListener('okey:mobile-return-discard', mobileReturnDiscardListener)

  // Yandan alınan taş daha ıstakaya konmadan mouse'a yapışık haldeyken de
  // geldiği sol stack'e tek tıkla doğrudan geri bırakılabilir.
  renderer.domElement.addEventListener(
    'pointerdown',
    event => {
      if (event.button !== 0) return
      if (isTouchPointerEvent(event) && !event.isPrimary) return
      if (returnDiscardPending) return
      if (!isStickyDiscardPickupReturnActive()) return

      updatePointer(event)
      updateReturnDiscardTarget()
      const overReturnTarget = updateReturnDragCapture()
      if (!overReturnTarget) return

      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation()

      returnDiscardPending = true
      state.returnDiscardDropReady = false
      setMessage('Yandan alınan taş geldiği kuleye geri bırakılıyor…')

      socket.emit('cancel-discard-pick', result => {
        returnDiscardPending = false

        if (!result?.ok) {
          setMessage(result?.message || 'Taş geri bırakılamadı.')
          updateReturnDiscardTarget()
          return
        }

        cancelStickyPickupVisual({ render: false })
        returnDragCaptureActive = false
        state.returnDiscardDropReady = false
        updateReturnDiscardTarget()
        setMessage('Taş atık kulesine geri bırakıldı.')
      })
    },
    true
  )

  // Geri bırakma artık click ile değil gerçek drag + mouse-up ile yapılır.
  // Capture kullanıyoruz; böylece doğru taş kaynak kulenin üzerindeyken
  // bırakılırsa rack'in normal pointer-up drop'u çalışmadan önce yakalarız.
  renderer.domElement.addEventListener(
    'pointerup',
    event => {
      if (event.button !== 0) return
      if (isTouchPointerEvent(event) && !event.isPrimary) return
      if (returnDiscardPending) return
      if (!isDraggingReturnableDiscardTile()) return

      updatePointer(event)
      updateReturnDiscardTarget()

      const overReturnTarget = updateReturnDragCapture()

      if (!overReturnTarget) return

      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation()

      returnDiscardPending = true
      state.returnDiscardDropReady = false
      setMessage('Taş geldiği atık kulesine geri bırakılıyor…')

      socket.emit('cancel-discard-pick', result => {
        returnDiscardPending = false

        if (!result?.ok) {
          // Pointer-up rack'e iletilmedi. Başarısızsa taşı güvenli biçimde
          // eski rack konumuna döndür ve geri bırakma hakkını koru.
          cancelRackDragVisual({ render: true })

          setMessage(
            result?.message ||
            'Taş geri bırakılamadı.'
          )
          updateReturnDiscardTarget()
          return
        }

        state.returnableDiscardTileId = null
        state.returnableDiscardSeat = null
        state.returnableDiscardIndex = null
        returnDragCaptureActive = false

        // Başarılıysa önce geri dönüş işaretini temizle, sonra rack'i yeniden
        // çiz. Sunucunun hand-state'i geldiğinde taş tamamen elden kalkar.
        cancelRackDragVisual({ render: true })

        updateReturnDiscardTarget()
        setMessage('Taş atık kulesine geri bırakıldı.')
      })
    },
    true
  )

  renderer.domElement.addEventListener(
    'pointermove',
    event => {
      if (isTouchPointerEvent(event) && !event.isPrimary) return
      updatePointer(event)

      updateReturnDiscardTarget()

      // Sarı çerçeveli yandan alınmış taş normal taş gibi basılı tutularak
      // sürüklenir. Kaynak kulenin üzerine gelince hedef aktif olur; click yok.
      if (state.isDraggingTile) {
        const overReturnTarget = updateReturnDragCapture()

        hoverAction = overReturnTarget ? 'return-discard' : null

        if (overReturnTarget) {
          // Capture phase'de rack pointermove'dan ÖNCE snap kilidini kur.
          // Bundan sonra rack.js bu frame taşı tekrar ıstakaya çekmez.
          snapReturnableDraggedTile()
        }

        updateCursor()
        return
      }

      state.returnDiscardDropReady = false

      if (state.isStickyPickup) {
        const overReturnTarget = isStickyDiscardPickupReturnActive()
          ? updateReturnDragCapture()
          : false
        hoverAction = overReturnTarget ? 'return-discard' : null
        updateCursor()
        return
      }

      if (state.pendingTablePickup) {
        hoverAction = null
        updateCursor()
        return
      }

      const target = getActionAtPointer(event)
      hoverAction = target?.action || null
      updateCursor()
    }
  , true)

  // Kaynak taşlarda "basılı tut" yoktur.
  // Tek pointerdown = al/çek isteği.
  renderer.domElement.addEventListener(
    'pointerdown',
    event => {
      if (event.button !== 0) return
      if (isTouchPointerEvent(event) && !event.isPrimary) return
      if (state.isDraggingTile) return
      if (state.pendingTablePickup || state.isStickyPickup) return

      updatePointer(event)
      const target = getActionAtPointer(event)

      // Masada başka bir yere tıklamak açık incelemeyi kapatır. Rack'in kendi
      // pointerdown akışına müdahale etmiyoruz.
      if (!target) {
        closeDiscardInspection()
        return
      }

      event.preventDefault()


      if (target.action === 'inspect-indicator') {
        showIndicatorInspection(target.tileData || state.publicGameState?.indicator)
        setMessage('Gösterge büyütüldü.')
        return
      }

      if (target.action === 'inspect-discard') {
        showDiscardInspection(target.seat, target.tileData)
        return
      }

      if (target.action === 'blocked-playable-discard') {
        setMessage('BU TAŞ İŞLEK, ALAMAZSIN')
        return
      }

      closeDiscardInspection()
      beginPickupRequest(target, socket, setMessage)
    }
  )

  window.addEventListener('blur', () => {
    hoverAction = null
    returnDragCaptureActive = false
    state.returnDiscardDropReady = false
    closeDiscardInspection()
    updateCursor()
  })

  window.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      closeDiscardInspection()
    }
  })
}

// =====================================================
// SNAPPY HOVER ANIMATIONS
// =====================================================

export function updateTableInteractionAnimation() {
  pulseTime += 0.08
  inspectionPulse += 0.075

  updateReturnDiscardTarget()

  if (returnDiscardGlow.visible) {
    const ready = Boolean(state.returnDiscardDropReady)

    returnDiscardGlowMaterial.color.setHex(
      ready ? 0x72e6b7 : 0xffc857
    )

    const targetOpacity = ready ? 0.72 : 0.12

    returnDiscardGlowMaterial.opacity +=
      (
        targetOpacity -
        returnDiscardGlowMaterial.opacity
      ) * 0.22

    const pulse =
      1 +
      Math.sin(pulseTime) *
        (ready ? 0.055 : 0.015)

    returnDiscardGlow.scale.setScalar(pulse)

    // Mouse eventleri arasında da taş hedefe akmaya devam etsin.
    snapReturnableDraggedTile()
  }

  // Yerel büyütülmüş atık önizlemesi. Kamera hareket etse bile yüzü sürekli
  // kullanıcıya bakar; açılıp kapanma hızlı ama yumuşak bir scale ile olur.
  if (discardInspectionRoot.visible || inspectionTargetScale > 0) {
    const anchor = inspectionSeat
      ? getInspectionAnchorWorld(inspectionSeat)
      : null

    if (anchor) {
      anchor.y += Math.sin(inspectionPulse) * 0.018
      discardInspectionRoot.position.lerp(anchor, 0.34)
    }

    discardInspectionRoot.quaternion.slerp(
      camera.quaternion,
      0.42
    )

    inspectionShownScale +=
      (inspectionTargetScale - inspectionShownScale) * 0.28

    discardInspectionRoot.scale.setScalar(inspectionShownScale)

    if (inspectionTargetScale <= 0 && inspectionShownScale < 0.06) {
      discardInspectionRoot.visible = false
      inspectionShownScale = 0
      destroyInspectionTile()
    }
  }

  const interactionsAvailable =
    !state.pendingTablePickup &&
    !state.isStickyPickup &&
    !state.isDraggingTile

  const stockTarget =
    interactionsAvailable &&
    hoverAction === 'draw-stock' &&
    isMyTurn()
      ? 1
      : 0

  const discardTarget =
    interactionsAvailable &&
    hoverAction === 'take-discard' &&
    isMyTurn()
      ? 1
      : 0

  stockHoverAmount +=
    (stockTarget - stockHoverAmount) * 0.24

  discardHoverAmount +=
    (discardTarget - discardHoverAmount) * 0.24

  stockRoot.position.y = stockHoverAmount * 0.035

  stockGlowMaterial.opacity =
    0.05 + stockHoverAmount * 0.30

  stockGlow.scale.setScalar(
    1 +
    stockHoverAmount * 0.09 +
    Math.sin(pulseTime) * stockHoverAmount * 0.025
  )

  if (latestDiscardVisual) {
    latestDiscardVisual.position.y +=
      (latestDiscardBaseY + discardHoverAmount * 0.038 -
        latestDiscardVisual.position.y) * 0.28
  }

  takeDiscardGlowMaterial.opacity =
    takeDiscardGlow.visible
      ? 0.035 + discardHoverAmount * 0.40
      : 0

  takeDiscardGlow.scale.setScalar(
    1 +
    discardHoverAmount * 0.10 +
    Math.sin(pulseTime + 1.3) * discardHoverAmount * 0.03
  )
}
