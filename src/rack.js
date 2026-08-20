import * as THREE from 'three'
import {
  TILE_WIDTH,
  TILE_HEIGHT,
  TILE_DEPTH,
  NORMAL_TILE_GAP,
  GROUP_GAP,
  RACK_USABLE_WIDTH,
  MAX_ROW_TILES,
  RACK_LEFT_LIMIT,
  RACK_RIGHT_LIMIT,
  DISCARD_TILE_ROTATION_Z,
  getDiscardSlotLocalPosition,
} from './config.js'
import { state } from './state.js'
import {
  camera,
  renderer,
  rackPlaceholders,
  rackDragPlane,
  ownTilesGroup,
  opponentTileGroups,
} from './scene.js'
import {
  createTile,
  createHiddenTile,
  clearGroup,
} from './tiles.js'


// =====================================================
// RACK INTERACTION
// =====================================================

// Drag hissi anlık olsun; sadece yanlış mikro titreşimleri click'ten
// ayırmak için çok küçük bir eşik kullanıyoruz.
const POINTER_MOVE_EPSILON = 0.65

// Native dblclick, ilk pointerdown'da drag başladığı için rack taşlarında
// güvenilir değildi. Aynı gerçek okeye iki rahat tıklamayı kendimiz
// algılarız; küçük el/fare farklarını tolere eder ama normal drag'i bozmaz.
const JOKER_DOUBLE_CLICK_MS = 560
const JOKER_DOUBLE_CLICK_MAX_DISTANCE = 28
const JOKER_CLICK_MOVE_TOLERANCE = 7

// Taşlar kesinlikle üst üste binmesin. NORMAL_TILE_GAP'ten biraz
// daha sıkı olabilir ama fiziksel genişliğin altına asla düşmez.
const COLLISION_DISTANCE = TILE_WIDTH + 0.004

// Float hesaplarından gelen mikroskobik farklar taşları gereksiz yere
// oynatmasın. Bu tolerans fiziksel çakışmayı gizleyecek kadar büyük değildir.
const POSITION_EPSILON = 0.001

// Duvar insertion'ı yalnız pointer fiziksel rack sınırına gerçekten dayandığında
// zorlanır. Duvar ile ilk/son taş arasında boşluk varsa pointer o boşlukta kaldığı
// sürece solver taşı tam istenen X'e bırakır. Pointer sınırın dışına taşınıp clamp
// olursa edge-insert devreye girer ve mevcut kenar taşı yalnız gerektiği kadar itilir.
const WALL_INSERT_EDGE_EPSILON = POSITION_EPSILON * 4

// =====================================================
// RACK ROW VISUAL TUNING
// =====================================================
// Bu sekiz değer yalnız ıstakadaki taşların GÖRSEL boyutunu, oyuncuya
// doğru yatışını, yukarı/aşağı ve oyuncuya yakın/uzak konumunu değiştirir.
// Rack solver / taş sırası /
// yatay snap koordinatları değişmez. İnce ayar için doğrudan bu değerleri
// değiştirebilirsin.
//
// row 0 = ALT sıra (oyuncuya yakın)
// row 1 = ÜST sıra (masaya yakın)
//
// Açı derece cinsinden. Daha büyük pozitif değer = taşın üst kısmı oyuncuya
// daha fazla yatar. Negatif verirsen ters yöne yatırırsın.
const LOWER_ROW_TILE_SCALE = 1.0
const UPPER_ROW_TILE_SCALE = 1.0
const LOWER_ROW_PLAYER_TILT_DEG = 24.73
const UPPER_ROW_PLAYER_TILT_DEG = 24.73
// Pozitif = yukarı, negatif = aşağı. Three.js rack-local Y birimidir.
const LOWER_ROW_Y_OFFSET = -0.05
const UPPER_ROW_Y_OFFSET = -0.13
// Pozitif = oyuncuya yaklaşır, negatif = masa merkezine doğru uzaklaşır.
// Bu değer rack-local Z eksenindedir ve dört oyuncuda da aynı mantıkta çalışır.
const LOWER_ROW_PLAYER_DISTANCE_OFFSET = 0.05
const UPPER_ROW_PLAYER_DISTANCE_OFFSET = 0.09

function getRackRowVisual(rowIndex) {
  const isUpperRow = rowIndex === 1

  return {
    scale: isUpperRow
      ? UPPER_ROW_TILE_SCALE
      : LOWER_ROW_TILE_SCALE,
    rotationX: THREE.MathUtils.degToRad(
      -(isUpperRow
        ? UPPER_ROW_PLAYER_TILT_DEG
        : LOWER_ROW_PLAYER_TILT_DEG)
    ),
  }
}

// Manuel per algılamasında per içindeki taşlar fiziksel olarak da
// birbirine yakın olmalı; büyük kullanıcı boşluklarının üzerinden
// yanlış per seçilmesin.
const MELD_LINK_MAX_DISTANCE =
  TILE_WIDTH + NORMAL_TILE_GAP + 0.020

// Snap tanımı bilinçli olarak dar: oyuncu taşı gerçekten komşunun dibine
// bıraktığında yardım eder; iki grubun arasındaki büyük boşluktan eski pere
// geri çekmez. Normal merkez mesafesi TILE_WIDTH + NORMAL_TILE_GAP'tir.
const MELD_SNAP_MAX_DISTANCE =
  TILE_WIDTH + NORMAL_TILE_GAP + 0.028

// Drag edilen gerçek taşlar havada gezer; bu grup yalnızca bırakma
// sonucunu gösteren hayalet slotları taşır.
const dropPreviewGroup = new THREE.Group()
dropPreviewGroup.name = 'rackDropPreview'

const previewPool = []
let activeDrag = null

// Ortadan veya son atıktan alınan taş, ikinci tık ıstakaya gelene kadar
// mouse'a yapışık kalır. Normal eldeki taş drag sisteminden tamamen ayrıdır.
let stickyPickup = null
let stickyStockDiscardReady = false

// Gerçek okey artık ele geldiğinde normal yüzüyle görünür. Oyuncu isterse
// rack üzerindeyken çift tıklayarak yalnız kendi ekranında arka yüzünü çevirebilir.
// Bu tamamen görseldir; authoritative taş kimliği / joker kuralları değişmez.
const flippedRackJokerIds = new Set()
let lastRackJokerClick = null
const stickyRaycaster = new THREE.Raycaster()
const stickyPointer = new THREE.Vector2()
const stickyWorldPlane = new THREE.Plane()
const stickyPlanePoint = new THREE.Vector3()
const stickyPlaneNormal = new THREE.Vector3()
const stickyWorldHit = new THREE.Vector3()

// =====================================================
// RIGHT-SIDE DISCARD TARGET
// =====================================================
//
// Oyuncu tek bir taşı sağ tarafa sürüklediğinde bu alan aktive olur.
// Mouse bırakıldığı anda taş doğrudan sunucuya "discard" olarak gönderilir.
// Per sürükleme bu bölgeyi kullanmaz.
//

// Önceki +0.18 sınırı ıstakanın sağ boşluğunu fazla erken discard sayıyordu.
// Hedef artık gerçek atık kulesine daha yakın başlar.
const DISCARD_TRIGGER_X = RACK_RIGHT_LIMIT + 0.52

function getCurrentDiscardTarget() {
  const count =
    state.discardCountsBySeat?.[state.localSeat] || 0

  return getDiscardSlotLocalPosition(count)
}

const discardGuideGroup = new THREE.Group()
discardGuideGroup.name = 'discardGuideGroup'

const discardGuideMaterial = new THREE.MeshBasicMaterial({
  color: 0x72e6b7,
  transparent: true,
  opacity: 0,
  depthWrite: false,
  depthTest: false,
  side: THREE.DoubleSide,
})

const discardGuide = new THREE.Mesh(
  new THREE.PlaneGeometry(
    TILE_WIDTH * 1.55,
    TILE_HEIGHT * 1.35
  ),
  discardGuideMaterial
)

discardGuide.rotation.x = -Math.PI / 2
discardGuide.rotation.z = DISCARD_TILE_ROTATION_Z
{
  const initialDiscardTarget = getDiscardSlotLocalPosition(0)
  discardGuide.position.set(
    initialDiscardTarget.x,
    -0.007,
    initialDiscardTarget.z
  )
}
discardGuide.renderOrder = 50
discardGuideGroup.add(discardGuide)

let discardGuideTargetOpacity = 0
let discardGuidePulse = 0

function getPreviewMesh(index) {
  if (previewPool[index]) {
    return previewPool[index]
  }

  const geometry = new THREE.BoxGeometry(
    TILE_WIDTH + 0.012,
    TILE_HEIGHT + 0.012,
    TILE_DEPTH + 0.010
  )

  const material = new THREE.MeshBasicMaterial({
    color: 0x6ee7c4,
    transparent: true,
    opacity: 0.50,
    wireframe: true,
    depthTest: false,
    depthWrite: false,
  })

  const mesh = new THREE.Mesh(geometry, material)
  mesh.visible = false
  mesh.renderOrder = 40

  previewPool[index] = mesh
  dropPreviewGroup.add(mesh)

  return mesh
}

function clearDropPreview() {
  for (const mesh of previewPool) {
    mesh.visible = false
  }
}

export function clearRackSelection() {
  clearDropPreview()
}

export function attachOwnTilesToSeat(seat) {
  if (ownTilesGroup.parent) {
    ownTilesGroup.parent.remove(ownTilesGroup)
  }

  if (rackDragPlane.parent) {
    rackDragPlane.parent.remove(rackDragPlane)
  }

  const rack = rackPlaceholders[seat]
  if (!rack) return

  rack.add(ownTilesGroup)
  rack.add(rackDragPlane)
  rack.add(dropPreviewGroup)
  rack.add(discardGuideGroup)
  ownTilesGroup.position.set(0, 0, 0)
}

export function getHandMap() {
  const hand = state.privateHandState?.hand || []
  return new Map(hand.map(tile => [tile.id, tile]))
}

export function syncRackRows() {
  const hand = state.privateHandState?.hand || []
  const validIds = new Set(hand.map(tile => tile.id))
  const stickyId = state.stickyPickupTileId
  const stagedIds =
    state.stagedOpenTileIds instanceof Set
      ? state.stagedOpenTileIds
      : new Set()

  state.rackRows[0] = state.rackRows[0].filter(
    id =>
      validIds.has(id) &&
      id !== stickyId &&
      !stagedIds.has(id)
  )

  state.rackRows[1] = state.rackRows[1].filter(
    id =>
      validIds.has(id) &&
      id !== stickyId &&
      !stagedIds.has(id)
  )

  for (const id of state.manualTilePositions.keys()) {
    // Açma alanına hazırlanmış taşın eski rack konumunu özellikle koruyoruz.
    // GERİ yapılırsa taş sağ uca sıçramadan aynı yere döner.
    if (!validIds.has(id) || id === stickyId) {
      state.manualTilePositions.delete(id)
    }
  }

  const existing = new Set([
    ...state.rackRows[0],
    ...state.rackRows[1],
  ])

  for (const tile of hand) {
    // Masadan yeni alınan taş veya açma alanında hazırlanan taş, kullanıcı
    // ilgili işlemi bitirene kadar normal rack sıralarına eklenmez.
    if (tile.id === stickyId) continue
    if (stagedIds.has(tile.id)) continue
    if (existing.has(tile.id)) continue

    const saved = state.manualTilePositions.get(tile.id)

    const targetRow =
      saved && (saved.row === 0 || saved.row === 1)
        ? saved.row
        : state.rackRows[0].length < MAX_ROW_TILES
          ? 0
          : 1

    state.rackRows[targetRow].push(tile.id)
    existing.add(tile.id)

    // Daha önce rack'te olan (ör. açma alanından geri gelen) taşın eski
    // konumu hâlâ boşsa aynen koru. O aralık bu sırada başka taşlarla
    // doldurulduysa üst üste bindirmek yerine yalnız geri gelen taşı yeni
    // boşluğa koy; mevcut taşları oynatma.
    if (saved) {
      const oldSpotIsFree = state.rackRows[targetRow].every(existingId => {
        if (existingId === tile.id) return true

        const position = state.manualTilePositions.get(existingId)
        if (!position) return true

        return Math.abs(position.x - saved.x) >= COLLISION_DISTANCE
      })

      if (oldSpotIsFree) {
        continue
      }

      state.manualTilePositions.delete(tile.id)
    }

    let rightMost = RACK_LEFT_LIMIT

    for (const existingId of state.rackRows[targetRow]) {
      if (existingId === tile.id) continue

      const position = state.manualTilePositions.get(existingId)
      if (position) {
        rightMost = Math.max(rightMost, position.x)
      }
    }

    const newX = THREE.MathUtils.clamp(
      rightMost + TILE_WIDTH + NORMAL_TILE_GAP,
      RACK_LEFT_LIMIT,
      RACK_RIGHT_LIMIT
    )

    state.manualTilePositions.set(tile.id, {
      x: newX,
      row: targetRow,
    })
  }
}

export function isRealJoker(tile) {
  const joker = state.publicGameState?.joker

  if (!tile || !joker || tile.type !== 'normal') {
    return false
  }

  return tile.color === joker.color && tile.number === joker.number
}

export function getEffectiveTile(tile) {
  if (!tile) return null

  const joker = state.publicGameState?.joker

  if (!joker) {
    return { ...tile, wildcard: false }
  }

  if (tile.type === 'fake-joker') {
    return {
      ...tile,
      color: joker.color,
      number: joker.number,
      wildcard: false,
    }
  }

  if (isRealJoker(tile)) {
    return { ...tile, wildcard: true }
  }

  return { ...tile, wildcard: false }
}

export function visualValidateGroup(tiles) {
  if (!Array.isArray(tiles) || tiles.length < 3 || tiles.length > 4) {
    return false
  }

  const normalized = tiles.map(getEffectiveTile)
  if (normalized.some(tile => !tile)) return false
  const normal = normalized.filter(tile => !tile.wildcard)
  const jokerCount = normalized.length - normal.length

  if (normal.length === 0) return true

  const number = normal[0].number

  if (normal.some(tile => tile.number !== number)) {
    return false
  }

  const colors = new Set(normal.map(tile => tile.color))

  if (colors.size !== normal.length) {
    return false
  }

  return normal.length + jokerCount <= 4
}

export function visualValidateRun(tiles) {
  if (!Array.isArray(tiles) || tiles.length < 3 || tiles.length > 13) {
    return false
  }

  const normalized = tiles.map(getEffectiveTile)
  if (normalized.some(tile => !tile)) return false

  const normal = normalized.filter(tile => !tile.wildcard)
  if (normal.length === 0) return true

  const color = normal[0].color
  if (normal.some(tile => tile.color !== color)) return false

  // Istakadaki gerçek soldan-saga sıra artık kuralın parçasıdır.
  // 7-9-8 matematiksel olarak aynı sayıları taşısa da per değildir;
  // yalnız 7-8-9 gibi ardışık dizilim kabul edilir. Joker bulunduğu slotta
  // eksik olan tek sayıyı temsil edebilir, fakat diğer taşların sırasını
  // yeniden düzenlemez.
  for (let startNumber = 1; startNumber <= 14 - tiles.length; startNumber++) {
    let valid = true

    for (let index = 0; index < normalized.length; index++) {
      const tile = normalized[index]
      if (tile.wildcard) continue

      if (Number(tile.number) !== startNumber + index) {
        valid = false
        break
      }
    }

    if (valid) return true
  }

  return false
}

export function visualValidateMeld(tiles) {
  return visualValidateGroup(tiles) || visualValidateRun(tiles)
}

export function visualValidatePair(tiles) {
  if (!Array.isArray(tiles) || tiles.length !== 2) {
    return false
  }

  const [first, second] = tiles.map(getEffectiveTile)

  if (!first || !second) return false

  // 101 Okey'de gerçek okey çiftte eksik eşin yerine kullanılabilir.
  // İki gerçek okey de birlikte bir çift temsil edebilir.
  if (first.wildcard || second.wildcard) {
    return true
  }

  // Sahte okey wildcard değildir; göstergeye göre gerçek okeyin
  // basılı kimliği gibi davranır. Bu yüzden effective renk/sayıyla
  // normal bir taş gibi karşılaştırılır.
  return (
    first.color === second.color &&
    first.number === second.number
  )
}


function isIndicatorTwinTile(tile) {
  const indicator = state.publicGameState?.indicator
  return Boolean(
    tile &&
    indicator &&
    tile.id !== indicator.id &&
    tile.type === 'normal' &&
    tile.color === indicator.color &&
    Number(tile.number) === Number(indicator.number)
  )
}

// Ortadaki açık gösterge hiçbir zaman ele alınmaz. Özel çift hakkı yalnız
// eldeki ikinci aynı gösterge taşı için ve yalnız ilk çift açılışında geçerlidir.
export function visualValidateOpeningPair(tiles) {
  if (visualValidatePair(tiles)) return true
  if (!Array.isArray(tiles) || tiles.length !== 2) return false
  if (state.privateHandState?.opened) return false
  if (state.publicGameState?.indicatorPairUsed) return false

  return tiles.filter(isIndicatorTwinTile).length === 1
}

// İki taş henüz tamamlanmış bir per olmasa da, kullanıcı onları
// doğal bir per başlangıcı olarak yan yana dizmiş olabilir. Bu kontrol
// YALNIZCA alt-yarı grup sürükleme içindir; normal per doğrulamasına ve
// rack'teki otomatik grup boşluklarına dahil edilmez.
function visualValidateNearMeldPair(tiles) {
  if (!Array.isArray(tiles) || tiles.length !== 2) {
    return false
  }

  const normalized = tiles.map(getLiteralEffectiveTile)
  const [first, second] = normalized

  if (!first || !second) return false

  const firstNumber = Number(first.number)
  const secondNumber = Number(second.number)

  if (!Number.isFinite(firstNumber) || !Number.isFinite(secondNumber)) {
    return false
  }

  if (!first.color || !second.color) {
    return false
  }

  // Set başlangıcı: aynı sayı, farklı renk.
  // Örn. sarı 6 + mavi 6.
  if (
    firstNumber === secondNumber &&
    first.color !== second.color
  ) {
    return true
  }

  // Seri başlangıcı: aynı renk, ardışık iki sayı.
  // Örn. siyah 10 + siyah 11.
  if (
    first.color === second.color &&
    secondNumber === firstNumber + 1
  ) {
    return true
  }

  return false
}

function getLiteralEffectiveTile(tile) {
  const joker = state.publicGameState?.joker

  // Sahte okey kendi kuralındaki sabit yüz değerini temsil eder.
  // Gerçek okey ise burada wildcard yapılmaz; üzerinde yazan gerçek
  // renk/sayı ile değerlendirilir. Bu fonksiyon yalnızca ıstakadaki
  // doğal (jokersiz) perin zaten tamamlanıp tamamlanmadığını anlamak içindir.
  if (tile?.type === 'fake-joker' && joker) {
    return {
      ...tile,
      color: joker.color,
      number: joker.number,
    }
  }

  return { ...tile }
}

function visualValidateNaturalGroup(tiles) {
  if (!Array.isArray(tiles) || tiles.length < 3 || tiles.length > 4) {
    return false
  }

  const normalized = tiles.map(getLiteralEffectiveTile)
  const number = normalized[0]?.number

  if (number == null) return false
  if (normalized.some(tile => tile.number !== number)) return false

  const colors = new Set(normalized.map(tile => tile.color))
  return colors.size === normalized.length
}

function visualValidateNaturalRun(tiles) {
  if (!Array.isArray(tiles) || tiles.length < 3 || tiles.length > 13) {
    return false
  }

  const normalized = tiles.map(getLiteralEffectiveTile)
  const color = normalized[0]?.color

  if (!color) return false
  if (normalized.some(tile => tile.color !== color)) return false

  const numbers = normalized.map(tile => Number(tile.number))

  if (numbers.some(number => !Number.isFinite(number))) return false
  if (new Set(numbers).size !== numbers.length) return false

  // Array sırası ıstakadaki soldan-saga gerçek dizilimdir. Sort etmek
  // 7-9-8 gibi oyuncunun yanlış dizdiği bir grubu yanlışlıkla per yapıyordu.
  for (let i = 1; i < numbers.length; i++) {
    if (numbers[i] !== numbers[i - 1] + 1) {
      return false
    }
  }

  return numbers[0] >= 1 && numbers[numbers.length - 1] <= 13
}

function visualValidateNaturalMeld(tiles) {
  return visualValidateNaturalGroup(tiles) || visualValidateNaturalRun(tiles)
}

function containsCompleteNaturalSubMeld(tiles) {
  if (!Array.isArray(tiles) || tiles.length <= 3) return false

  // Wildcard destekli daha uzun aday, içinde zaten tamamen doğal bir
  // per barındırıyorsa o doğal peri yutmasın. Örn. farklı renk 1-1-1
  // zaten settir; yanındaki gerçek okey yüzünde 10 yazıyor diye
  // 1-1-1-10 dört taşlık grup yapılmaz.
  for (let start = 0; start < tiles.length; start++) {
    for (let end = start + 3; end <= tiles.length; end++) {
      if (start === 0 && end === tiles.length) continue

      if (visualValidateNaturalMeld(tiles.slice(start, end))) {
        return true
      }
    }
  }

  return false
}

function visualValidateRackGroup(tiles) {
  if (visualValidateOpeningPair(tiles)) return true
  if (visualValidateNaturalMeld(tiles)) return true

  // Gerçek okey, ancak gerçekten eksik bir peri tamamlıyorsa rack grubuna
  // katılsın. Normal farklı renkli/uyumsuz taşlar wildcard gibi davranamaz.
  // Örn. 12-13 + gerçek okey birlikte taşınır; fakat gerçek okey içermeyen
  // mavi 8 - mavi 9 - sarı 10 kesinlikle per sayılmaz.
  const hasRealJoker = tiles.some(tile => isRealJoker(tile))

  if (!hasRealJoker) return false
  if (!visualValidateMeld(tiles)) return false

  // Tamamlanmış doğal bir 3'lünün yanındaki gerçek okey de legal olarak
  // peri büyütebilir: 13-13-13-Okey dört renkli sete, 4-5-6-Okey ise
  // 4-5-6-7 serisine dönüşebilir. Bu nedenle doğal alt-per bulunması
  // jokerli daha uzun peri reddetme sebebi değildir.
  return true
}

function isBetterRangePlan(candidate, current) {
  // Tamamlanmış perler ve gerçek çiftler, kaç tane yakın-per ikilisi
  // yan yana gelirse gelsin parçalanmamalı. Örn. farklı renk 2-2-2
  // setinin sağındaki mavi 1, sağdaki mavi 2 ile 1-2 başlangıcı
  // oluşturabilir; fakat bu, tamamlanmış 2-2-2 perinden o taşı koparamaz.
  // Bu öncelik detectManualMeldRanges için davranışı değiştirmez çünkü
  // oradaki bütün adaylar zaten complete=true'dur.
  if (candidate.completeCovered !== current.completeCovered) {
    return candidate.completeCovered > current.completeCovered
  }

  // Tamamlanmış gruplar aynı ölçüde korunuyorsa kalan boş alanlarda
  // mümkün olan en çok taşı çift/yakın-per bloklarında kapsa.
  if (candidate.covered !== current.covered) {
    return candidate.covered > current.covered
  }

  if (candidate.cohesion !== current.cohesion) {
    return candidate.cohesion > current.cohesion
  }

  // Tam eşitlikte daha az blok, daha az parçalanma demektir.
  return candidate.ranges.length < current.ranges.length
}

function chooseBestNonOverlappingRanges(length, candidates) {
  const dp = Array(length + 1).fill(null)
  dp[length] = {
    covered: 0,
    completeCovered: 0,
    cohesion: 0,
    ranges: [],
  }

  const byStart = Array.from(
    { length },
    () => []
  )

  for (const candidate of candidates) {
    byStart[candidate.start]?.push(candidate)
  }

  for (let i = length - 1; i >= 0; i--) {
    const skipped = dp[i + 1]
    let best = {
      covered: skipped.covered,
      completeCovered: skipped.completeCovered,
      cohesion: skipped.cohesion,
      ranges: [...skipped.ranges],
    }

    for (const candidate of byStart[i]) {
      const after = dp[candidate.end]
      const plan = {
        // Önce mümkün olan en çok taşı gerçek gruplarda kapsa.
        covered: candidate.length + after.covered,

        completeCovered:
          (candidate.complete === false ? 0 : candidate.length) +
          after.completeCovered,

        // Kapsama ve tamamlanmış-grup sayısı eşitse length^2 toplamı
        // daha uzun/tek parça blokları
        // tercih eder: 10-11-12-13, iki örtüşen üçlüye bölünmez.
        cohesion:
          candidate.length * candidate.length +
          after.cohesion,

        ranges: [
          { start: candidate.start, end: candidate.end },
          ...after.ranges,
        ],
      }

      if (isBetterRangePlan(plan, best)) {
        best = plan
      }
    }

    dp[i] = best
  }

  return dp[0].ranges
}

function detectManualMeldRanges(rowIds, handMap = getHandMap(), rowIndex = null) {
  if (!Array.isArray(rowIds) || rowIds.length < 2) return []

  // .filter(Boolean) kullanmak stale bir id olduğunda tile indexleriyle
  // rackRows indexlerini kaydırıyordu. syncRackRows normalde bunu temizler,
  // ama network/render yarışında yanlış aralığın grup sanılmaması için
  // indeksleri birebir koruyoruz.
  const tiles = rowIds.map(id => handMap.get(id) || null)
  const n = tiles.length
  const candidates = []

  for (let start = 0; start < n; start++) {
    for (let end = start + 2; end <= n; end++) {
      const segment = tiles.slice(start, end)

      if (segment.some(tile => !tile)) continue
      if (!visualValidateRackGroup(segment)) continue

      if (rowIndex === 0 || rowIndex === 1) {
        let physicallyJoined = true
        for (let index = start + 1; index < end; index++) {
          const leftX = getRenderedTileX(rowIds[index - 1], rowIndex, index - 1)
          const rightX = getRenderedTileX(rowIds[index], rowIndex, index)
          if (Math.abs(rightX - leftX) > MELD_LINK_MAX_DISTANCE) {
            physicallyJoined = false
            break
          }
        }
        if (!physicallyJoined) continue
      }

      candidates.push({
        start,
        end,
        length: end - start,
        complete: true,
      })
    }
  }

  return chooseBestNonOverlappingRanges(n, candidates)
}

function getRowGroupRanges(rowIndex, handMap = getHandMap()) {
  return detectManualMeldRanges(
    state.rackRows[rowIndex],
    handMap,
    rowIndex
  )
}

function calculateGapBefore(rowIndex, handMap = getHandMap()) {
  const ids = state.rackRows[rowIndex]
  const ranges = getRowGroupRanges(rowIndex, handMap)
  const gaps = new Map()

  for (const range of ranges) {
    if (range.start > 0) {
      gaps.set(range.start, Math.max(gaps.get(range.start) || 0, 1))
    }

    if (range.end < ids.length) {
      gaps.set(range.end, Math.max(gaps.get(range.end) || 0, 1))
    }
  }

  return gaps
}

export function getRowXPositions(rowIndex, handMap = getHandMap()) {
  const ids = state.rackRows[rowIndex]
  const count = ids.length

  if (count === 0) return []

  const gapBefore = calculateGapBefore(rowIndex, handMap)
  const naturalStep = TILE_WIDTH + NORMAL_TILE_GAP
  let requestedGroupGap = 0

  for (const amount of gapBefore.values()) {
    requestedGroupGap += GROUP_GAP * amount
  }

  // Fallback dizilimde dahi taşlar üst üste binmesin. Çok fazla grup
  // boşluğu istenmişse önce dekoratif GROUP_GAP küçülür; taş merkezleri
  // COLLISION_DISTANCE altına hiçbir zaman düşmez.
  const minimumNormalSpan =
    Math.max(0, count - 1) * COLLISION_DISTANCE

  const maximumGroupGap = Math.max(
    0,
    RACK_USABLE_WIDTH - TILE_WIDTH - minimumNormalSpan
  )

  const groupGapScale = requestedGroupGap > 0
    ? Math.min(1, maximumGroupGap / requestedGroupGap)
    : 1

  const effectiveGroupGap = GROUP_GAP * groupGapScale
  const totalGroupGap = requestedGroupGap * groupGapScale

  let step = naturalStep
  const usableForNormal = RACK_USABLE_WIDTH - TILE_WIDTH - totalGroupGap

  if (count > 1) {
    step = Math.min(
      naturalStep,
      Math.max(
        COLLISION_DISTANCE,
        usableForNormal / (count - 1)
      )
    )
  }

  let finalWidth = TILE_WIDTH

  for (let i = 1; i < count; i++) {
    finalWidth += step

    if (gapBefore.has(i)) {
      finalWidth += effectiveGroupGap * gapBefore.get(i)
    }
  }

  const positions = []
  let x = -finalWidth / 2 + TILE_WIDTH / 2
  positions.push(x)

  for (let i = 1; i < count; i++) {
    x += step

    if (gapBefore.has(i)) {
      x += effectiveGroupGap * gapBefore.get(i)
    }

    positions.push(x)
  }

  return positions
}

function addPickedDiscardMarker(tile) {
  if (!tile) return

  const boxGeometry = new THREE.BoxGeometry(
    TILE_WIDTH + 0.030,
    TILE_HEIGHT + 0.030,
    TILE_DEPTH + 0.022
  )

  const edgesGeometry = new THREE.EdgesGeometry(boxGeometry)
  boxGeometry.dispose()

  const markerMaterial = new THREE.LineBasicMaterial({
    color: 0xffc857,
    transparent: true,
    opacity: 0.95,
    depthTest: false,
    depthWrite: false,
  })

  const marker = new THREE.LineSegments(
    edgesGeometry,
    markerMaterial
  )

  marker.name = 'pickedDiscardMarker'
  marker.userData.pickedDiscardMarker = true
  marker.renderOrder = 90
  marker.position.z = 0.004

  tile.add(marker)
}

export function resetRackForNewRound() {
  // Yeni roundda aynı fiziksel taş ID'leri yeniden dağıtılabilir. Önceki
  // roundun manuel X/row kayıtlarını taşımak bu yeni taşların aynı slotlara
  // üst üste binmesine neden oluyordu. Yalnız round değişiminde temizliyoruz;
  // normal oyun sırasında untouched row / minimum movement davranışı korunur.
  resetDragState()
  cancelStickyPickupVisual({ render: false })

  // game-state ile yeni hand-state aynı animation frame'den önce gelebilir.
  // Eski roundun staged id'leri burada kalırsa yeni elde aynı tile id'leri
  // rackRows'a alınmaz ve taşların yalnız bir kısmı görünür. Round reset'i
  // görsel rack ile staging filtresini atomik olarak temizler.
  state.stagedOpenGroups.length = 0
  state.stagedOpenTileIds.clear()
  state.openingInFlight = false
  state.rackRows = [[], []]
  state.manualTilePositions.clear()
  state.forcedGroupsByRow = [[], []]
  state.layoutMode = 'manual'
  state.selectedTileId = null
  state.pendingTablePickup = null
  state.isTableInteracting = false
  flippedRackJokerIds.clear()

  clearGroup(ownTilesGroup)
}

function repairRackRowVisibility(rowIndex, handMap) {
  const ids = [...new Set(state.rackRows[rowIndex] || [])]
  state.rackRows[rowIndex] = ids

  if (ids.length <= 1) return

  const fallback = getRowXPositions(rowIndex, handMap)
  const entries = ids.map((id, index) => {
    const saved = state.manualTilePositions.get(id)
    const savedX = Number(saved?.x)

    return {
      id,
      x: Number.isFinite(savedX)
        ? savedX
        : (fallback[index] ?? 0),
    }
  })

  const ordered = [...entries].sort((a, b) => a.x - b.x)
  const alreadyVisible = ordered.every((entry, index) => {
    if (
      entry.x < RACK_LEFT_LIMIT - POSITION_EPSILON ||
      entry.x > RACK_RIGHT_LIMIT + POSITION_EPSILON
    ) {
      return false
    }

    return (
      index === 0 ||
      entry.x - ordered[index - 1].x >=
        COLLISION_DISTANCE - POSITION_EPSILON
    )
  })

  if (alreadyVisible) return

  // Yanlış açılışın geri dönmesi, server rollback'i veya başka bir toplu
  // iade sonrasında eski X kayıtları çakışmışsa yalnız bozuk sırayı minimum
  // toplam hareketle onar. Sağlam sıra hiç recenter edilmez.
  const repaired = normalizeStaticEntries(entries)

  if (repaired.valid) {
    state.rackRows[rowIndex] = repaired.entries.map(entry => entry.id)

    for (const entry of repaired.entries) {
      state.manualTilePositions.set(entry.id, {
        x: entry.x,
        row: rowIndex,
      })
    }

    return
  }

  // Teorik olarak 11 taşlık satır mevcut rack genişliğine sığar. Eski state
  // çok bozuksa son güvenli yol yalnız bu sırayı collision-safe fallback'e
  // almak; diğer sıraya dokunmuyoruz.
  const safePositions = getRowXPositions(rowIndex, handMap)
  state.rackRows[rowIndex].forEach((id, index) => {
    state.manualTilePositions.set(id, {
      x: safePositions[index] ?? 0,
      row: rowIndex,
    })
  })
}

function repairRackVisibilityIfNeeded(handMap) {
  repairRackRowVisibility(0, handMap)
  repairRackRowVisibility(1, handMap)
}

function restoreActiveDragVisualAfterHandRender() {
  if (!activeDrag) return

  const discardTarget = activeDrag.discardReady
    ? getCurrentDiscardTarget()
    : null

  for (const item of activeDrag.items) {
    const object = ownTilesGroup.children.find(
      child => child.userData?.tileId === item.id
    ) || null

    item.object = object
    if (!object) continue

    if (discardTarget && activeDrag.mode === 'single') {
      object.visible = true
      object.position.set(
        discardTarget.x,
        discardTarget.y,
        discardTarget.z
      )
      object.rotation.x = -Math.PI / 2
      object.rotation.z = DISCARD_TILE_ROTATION_Z
      object.scale.setScalar(1.045)
      continue
    }

    object.position.set(
      activeDrag.anchorX + item.offsetX,
      activeDrag.anchorY + item.offsetY,
      0.15
    )
    object.rotation.x = -0.10
    object.rotation.z = 0
    object.scale.setScalar(
      activeDrag.mode === 'single' ? 1.075 : 1.045
    )
    object.visible = !activeDrag.openBoardCaptured
  }

  updateActiveDragPreview()
}

export function renderOwnHand() {
  clearGroup(ownTilesGroup)

  if (stickyPickup) {
    stickyPickup.object = null
  }

  syncRackRows()

  const handMap = getHandMap()
  repairRackVisibilityIfNeeded(handMap)

  for (let rowIndex = 0; rowIndex < 2; rowIndex++) {
    const ids = state.rackRows[rowIndex]
    const needsFallback = ids.some(
      id => !state.manualTilePositions.has(id)
    )
    const fallbackPositions = needsFallback
      ? getRowXPositions(rowIndex, handMap)
      : null

    ids.forEach((id, index) => {
      const tileData = handMap.get(id)
      if (!tileData) return

      const tile = createTile(tileData)
      tile.userData.rackRow = rowIndex
      tile.userData.rackIndex = index

      const saved = state.manualTilePositions.get(id)
      const x = saved?.x ?? fallbackPositions?.[index] ?? 0

      if (!saved) {
        state.manualTilePositions.set(id, {
          x,
          row: rowIndex,
        })
      }

      tile.position.set(
        x,
        getRowBaseY(rowIndex),
        getRowBaseZ(rowIndex)
      )

      const rowVisual = getRackRowVisual(rowIndex)
      tile.rotation.x = rowVisual.rotationX
      tile.scale.setScalar(rowVisual.scale)

      // Gerçek okey de diğer taşlar gibi düz gelir. Yalnız oyuncu bu fiziksel
      // okeyi çift tıklayarak çevirdiyse arka yüzünü gösterir.
      tile.rotation.y = (
        isRealJoker(tileData) && flippedRackJokerIds.has(id)
      )
        ? Math.PI
        : 0

      if (id === state.returnableDiscardTileId) {
        addPickedDiscardMarker(tile)
      }

      ownTilesGroup.add(tile)
    })
  }

  // game-state her sıra değişiminde private hand-state'i tekrar yayınlıyor.
  // O sırada renderOwnHand meshleri yeniden kurduğu için aktif drag'in eski
  // mesh referansı kopmasın; yeni mesh aynı mouse konumuna anında bağlanır.
  restoreActiveDragVisualAfterHandRender()
  ensureStickyPickupVisual(handMap)
}

export function renderHiddenTilesForSeat(seat, count) {
  if (seat === state.localSeat) return

  const group = opponentTileGroups[seat]
  if (!group) return

  clearGroup(group)

  const rowCounts = [
    Math.min(MAX_ROW_TILES, count),
    Math.max(0, count - MAX_ROW_TILES),
  ]

  rowCounts.forEach((rowCount, rowIndex) => {
    if (rowCount <= 0) return

    const width = Math.min(
      RACK_USABLE_WIDTH,
      rowCount * (TILE_WIDTH + NORMAL_TILE_GAP)
    )

    const step = rowCount > 1
      ? (width - TILE_WIDTH) / (rowCount - 1)
      : 0

    const startX = -width / 2 + TILE_WIDTH / 2

    for (let i = 0; i < rowCount; i++) {
      const tile = createHiddenTile()

      tile.position.set(
        startX + i * step,
        getRowBaseY(rowIndex),
        getRowBaseZ(rowIndex)
      )

      const rowVisual = getRackRowVisual(rowIndex)
      tile.rotation.x = rowVisual.rotationX
      tile.rotation.y = Math.PI
      tile.scale.setScalar(rowVisual.scale)
      group.add(tile)
    }
  })
}


// =====================================================
// STICKY TABLE PICKUP
// =====================================================
//
// Ortadaki kapalı taşa veya soldaki son atığa bir kez tıklanınca
// sunucudan gelen yeni taş burada tutulur. Mouse düğmesine basılı tutmak
// gerekmez. Taş ancak ıstakanın üzerine ikinci kez tıklanınca rack'e girer.
//

function getRackLocalPointFromClient(clientX, clientY) {
  const rack = rackPlaceholders[state.localSeat]
  if (!rack) return null

  const rect = renderer.domElement.getBoundingClientRect()

  stickyPointer.x =
    ((clientX - rect.left) / rect.width) * 2 - 1

  stickyPointer.y =
    -(((clientY - rect.top) / rect.height) * 2 - 1)

  stickyRaycaster.setFromCamera(stickyPointer, camera)

  rack.updateWorldMatrix(true, false)

  stickyPlaneNormal
    .set(0, 0, 1)
    .applyQuaternion(rack.getWorldQuaternion(new THREE.Quaternion()))
    .normalize()

  stickyPlanePoint.copy(
    rack.localToWorld(new THREE.Vector3(0, 0, 0.17))
  )

  stickyWorldPlane.setFromNormalAndCoplanarPoint(
    stickyPlaneNormal,
    stickyPlanePoint
  )

  const hit = stickyRaycaster.ray.intersectPlane(
    stickyWorldPlane,
    stickyWorldHit
  )

  if (!hit) return null

  return rack.worldToLocal(hit.clone())
}

function isRackPlacementPoint(localPoint) {
  if (!localPoint) return false

  return (
    localPoint.x >= RACK_LEFT_LIMIT - TILE_WIDTH * 0.70 &&
    localPoint.x <= RACK_RIGHT_LIMIT + TILE_WIDTH * 0.70 &&
    localPoint.y >= 0.16 &&
    localPoint.y <= 0.90
  )
}

function ensureStickyPickupVisual(handMap = getHandMap()) {
  const tileId = state.stickyPickupTileId

  if (!tileId) {
    stickyPickup = null
    state.isStickyPickup = false
    return
  }

  const tileData = handMap.get(tileId)

  // Raund değiştiyse / taş artık elimizde değilse takılı mod kalmasın.
  if (!tileData) {
    stickyPickup = null
    state.stickyPickupTileId = null
    state.isStickyPickup = false
    state.stickyPickupSource = null
    state.stickyPickupReturnSeat = null
    state.stickyPickupReturnIndex = null
    clearDropPreview()
    return
  }

  if (!stickyPickup || stickyPickup.tileId !== tileId) {
    stickyPickup = {
      tileId,
      object: null,
      localX: 0,
      localY: 0.52,
      lastSolution: null,
    }
  }

  if (stickyPickup.object?.parent === ownTilesGroup) {
    return
  }

  const tile = createTile(tileData)
  tile.userData.stickyPickup = true

  if (state.stickyPickupSource === 'discard') {
    addPickedDiscardMarker(tile)
  }

  tile.position.set(
    stickyPickup.localX,
    stickyPickup.localY,
    0.19
  )
  tile.rotation.x = -0.10

  // Yeni çekilen gerçek okey de normal yüzüyle gelir. Çevirme yalnız rack'e
  // yerleştirildikten sonra oyuncunun çift tıklama tercihiyle yapılır.
  tile.rotation.y = 0

  tile.scale.setScalar(1.085)
  tile.renderOrder = 60

  stickyPickup.object = tile
  ownTilesGroup.add(tile)
}

function calculateStickyPickupSolution(localPoint) {
  const tileId = state.stickyPickupTileId

  if (!tileId || !localPoint) {
    return {
      valid: false,
      layouts: new Map(),
      requested: new Map(),
    }
  }

  const targetRow = getTargetRowFromY(localPoint.y)
  let requested = new Map([
    [
      tileId,
      {
        x: THREE.MathUtils.clamp(
          localPoint.x,
          RACK_LEFT_LIMIT,
          RACK_RIGHT_LIMIT
        ),
        row: targetRow,
      },
    ],
  ])

  // Sticky taş da normal tek taşla AYNI snap niyetini kullanır. Snap hedefi
  // solver'dan önce hesaplandığı için preview ile gerçek bırakma birebirdir.
  requested = applySingleSnapIntent(tileId, requested)

  const allDraggedIds = new Set([tileId])
  const layouts = new Map()
  let valid = true

  for (let rowIndex = 0; rowIndex < 2; rowIndex++) {
    const draggedIds =
      rowIndex === targetRow
        ? [tileId]
        : []

    const layout = solveRowDrop(
      rowIndex,
      draggedIds,
      requested,
      allDraggedIds,
      false
    )

    layouts.set(rowIndex, layout)

    if (!layout.valid) {
      valid = false
    }
  }

  return {
    valid,
    layouts,
    requested,
  }
}

function updateStickyPickupPreview(localPoint) {
  clearDropPreview()

  if (!stickyPickup || !state.stickyPickupTileId) return

  if (!isRackPlacementPoint(localPoint)) {
    stickyPickup.lastSolution = null
    return
  }

  const solution = calculateStickyPickupSolution(localPoint)
  stickyPickup.lastSolution = solution

  const requested = solution.requested.get(state.stickyPickupTileId)
  if (!requested) return

  let previewX = THREE.MathUtils.clamp(
    requested.x,
    RACK_LEFT_LIMIT,
    RACK_RIGHT_LIMIT
  )

  if (solution.valid) {
    previewX =
      solution.layouts
        .get(requested.row)
        ?.positions
        ?.get(state.stickyPickupTileId) ?? previewX
  }

  const mesh = getPreviewMesh(0)
  mesh.visible = true
  mesh.position.set(
    previewX,
    getRowBaseY(requested.row),
    0.115
  )
  mesh.rotation.x = -0.10
  mesh.material.color.setHex(
    solution.valid
      ? 0x72e6b7
      : 0xff6f61
  )
  mesh.material.opacity = solution.valid ? 0.62 : 0.72

  for (let i = 1; i < previewPool.length; i++) {
    previewPool[i].visible = false
  }
}

function moveStickyPickup(localPoint) {
  if (!stickyPickup || !localPoint) return

  stickyPickup.localX = localPoint.x
  stickyPickup.localY = localPoint.y

  ensureStickyPickupVisual()

  if (stickyPickup.object) {
    stickyPickup.object.position.x +=
      (localPoint.x - stickyPickup.object.position.x) * 0.48

    stickyPickup.object.position.y +=
      (localPoint.y - stickyPickup.object.position.y) * 0.48

    stickyPickup.object.position.z = 0.19
    stickyPickup.object.rotation.x +=
      (-0.10 - stickyPickup.object.rotation.x) * 0.35
    stickyPickup.object.scale.lerp(
      new THREE.Vector3(1.085, 1.085, 1.085),
      0.30
    )
  }

  updateStickyPickupPreview(localPoint)

  // Ortadan çekilen taş artık önce ıstakaya bırakılmak zorunda değil.
  // Sticky pickup sağdaki normal discard eşiğine taşınırsa aynı atma
  // kılavuzunu yak ve pointer-up / click ile doğrudan discard'a izin ver.
  stickyStockDiscardReady = Boolean(
    state.stickyPickupSource === 'stock' &&
    localPoint.x >= DISCARD_TRIGGER_X
  )

  if (stickyStockDiscardReady) {
    discardGuideTargetOpacity = 0.72
    const discardTarget = getCurrentDiscardTarget()
    discardGuide.position.set(
      discardTarget.x,
      -0.007,
      discardTarget.z
    )
  }
  else if (!activeDrag) {
    discardGuideTargetOpacity = 0
  }
}

export function beginStickyPickup(tileId, options = {}) {
  if (!tileId) return false

  state.stickyPickupSource = options.source || null
  state.stickyPickupReturnSeat = options.returnSeat || null
  state.stickyPickupReturnIndex = Number.isInteger(options.returnIndex)
    ? options.returnIndex
    : null

  // Yeni taş normal rack sıralarına hiçbir zaman otomatik düşmesin.
  for (let rowIndex = 0; rowIndex < 2; rowIndex++) {
    state.rackRows[rowIndex] = state.rackRows[rowIndex].filter(
      id => id !== tileId
    )
  }

  state.manualTilePositions.delete(tileId)

  resetDragState()

  state.stickyPickupTileId = tileId
  state.isStickyPickup = true
  state.isTableInteracting = false
  stickyStockDiscardReady = false

  stickyPickup = {
    tileId,
    object: null,
    localX: 0,
    localY: 0.52,
    lastSolution: null,
  }

  const initialPoint = getRackLocalPointFromClient(
    state.pointerClientX,
    state.pointerClientY
  )

  if (initialPoint) {
    stickyPickup.localX = initialPoint.x
    stickyPickup.localY = initialPoint.y
  }

  renderOwnHand()

  if (initialPoint) {
    moveStickyPickup(initialPoint)
  }

  renderer.domElement.style.cursor = 'grabbing'
  return true
}

function applySolvedLayouts(solution) {
  for (let rowIndex = 0; rowIndex < 2; rowIndex++) {
    const layout = solution.layouts.get(rowIndex)
    if (!layout) continue

    state.rackRows[rowIndex] = [...layout.order]

    for (const [id, x] of layout.positions) {
      state.manualTilePositions.set(id, {
        x,
        row: rowIndex,
      })
    }
  }
}

function commitStickyPickup(localPoint) {
  if (!stickyPickup || !state.stickyPickupTileId) return false
  if (!isRackPlacementPoint(localPoint)) return false

  const solution =
    stickyPickup.lastSolution ||
    calculateStickyPickupSolution(localPoint)

  if (!solution.valid) {
    updateStickyPickupPreview(localPoint)
    return false
  }

  const acceptedTileId = state.stickyPickupTileId

  // Preview'da hesaplanan tek çözüm doğrudan uygulanır; bırakma sonrasında
  // ikinci bir gizli snap pass'i yoktur.
  applySolvedLayouts(solution)

  const acceptedFromDiscard = state.stickyPickupSource === 'discard'

  if (acceptedFromDiscard) {
    state.returnableDiscardTileId = acceptedTileId
    state.returnableDiscardSeat = state.stickyPickupReturnSeat
    state.returnableDiscardIndex = state.stickyPickupReturnIndex
  } else {
    state.returnableDiscardTileId = null
    state.returnableDiscardSeat = null
    state.returnableDiscardIndex = null
  }

  state.stickyPickupTileId = null
  state.isStickyPickup = false
  state.stickyPickupSource = null
  state.stickyPickupReturnSeat = null
  state.stickyPickupReturnIndex = null
  stickyPickup = null
  stickyStockDiscardReady = false
  discardGuideTargetOpacity = 0

  clearDropPreview()
  renderOwnHand()
  renderer.domElement.style.cursor = 'default'

  return true
}

export function cancelStickyPickupVisual({ render = true } = {}) {
  if (stickyPickup?.object) {
    const object = stickyPickup.object
    object.parent?.remove(object)

    object.traverse(child => {
      if (
        child.geometry &&
        !child.geometry.userData?.sharedResource
      ) {
        child.geometry.dispose?.()
      }

      const materials = child.material
        ? (Array.isArray(child.material)
            ? child.material
            : [child.material])
        : []

      for (const material of materials) {
        if (material?.userData?.sharedResource) continue
        material?.map?.dispose?.()
        material?.alphaMap?.dispose?.()
        material?.dispose?.()
      }
    })
  }

  state.stickyPickupTileId = null
  state.isStickyPickup = false
  state.stickyPickupSource = null
  state.stickyPickupReturnSeat = null
  state.stickyPickupReturnIndex = null
  state.returnableDiscardTileId = null
  state.returnableDiscardSeat = null
  state.returnableDiscardIndex = null
  stickyPickup = null
  stickyStockDiscardReady = false
  discardGuideTargetOpacity = 0

  clearDropPreview()

  if (render) {
    renderOwnHand()
  }

  renderer.domElement.style.cursor = 'default'
}

function updatePointer(event, pointer) {
  const rect = renderer.domElement.getBoundingClientRect()

  pointer.x =
    ((event.clientX - rect.left) / rect.width) * 2 - 1

  pointer.y =
    -(((event.clientY - rect.top) / rect.height) * 2 - 1)
}

function findTileIdFromObject(object) {
  let current = object

  while (current) {
    if (current.userData?.tileId) {
      return current.userData.tileId
    }

    current = current.parent
  }

  return null
}

function findTileLocation(tileId) {
  for (let row = 0; row < 2; row++) {
    const index = state.rackRows[row].indexOf(tileId)

    if (index >= 0) {
      return { row, index }
    }
  }

  return null
}

function getTargetRowFromY(y) {
  return y > 0.50 ? 1 : 0
}

function getRowBaseY(rowIndex) {
  const baseY = rowIndex === 0 ? 0.30 : 0.70
  const visualOffset = rowIndex === 0
    ? LOWER_ROW_Y_OFFSET
    : UPPER_ROW_Y_OFFSET

  return baseY + visualOffset
}

function getRowBaseZ(rowIndex) {
  const baseZ = rowIndex === 0 ? 0.05 : -0.18
  const playerDistanceOffset = rowIndex === 0
    ? LOWER_ROW_PLAYER_DISTANCE_OFFSET
    : UPPER_ROW_PLAYER_DISTANCE_OFFSET

  return baseZ + playerDistanceOffset
}

function sortRowByManualPosition(rowIndex) {
  state.rackRows[rowIndex].sort((a, b) => {
    const posA = state.manualTilePositions.get(a)
    const posB = state.manualTilePositions.get(b)

    return (posA?.x ?? 0) - (posB?.x ?? 0)
  })
}

function captureCurrentRackAsManualLayout() {
  for (const tileObject of ownTilesGroup.children) {
    const tileId = tileObject.userData?.tileId
    const rowIndex = tileObject.userData?.rackRow

    if (
      !tileId ||
      (rowIndex !== 0 && rowIndex !== 1)
    ) {
      continue
    }

    if (!state.manualTilePositions.has(tileId)) {
      state.manualTilePositions.set(tileId, {
        x: THREE.MathUtils.clamp(
          tileObject.position.x,
          RACK_LEFT_LIMIT,
          RACK_RIGHT_LIMIT
        ),
        row: rowIndex,
      })
    }
  }

  sortRowByManualPosition(0)
  sortRowByManualPosition(1)
}

function getManualRowEntries(rowIndex, excludedIds = new Set()) {
  const ids = state.rackRows[rowIndex]
  const includedIds = ids.filter(id => !excludedIds.has(id))
  const needsFallback = includedIds.some(
    id => !state.manualTilePositions.has(id)
  )

  // Normal drag sırasında bütün taşların manual pozisyonu zaten vardır.
  // Önceden burada her pointermove'da getRowXPositions -> per taraması
  // çalışıyordu. Fallback'i yalnız gerçekten eksik pozisyon varsa hesapla.
  const fallbackById = new Map()

  if (needsFallback) {
    const fallbackPositions = getRowXPositions(rowIndex)

    ids.forEach((id, index) => {
      fallbackById.set(id, fallbackPositions[index] ?? 0)
    })
  }

  return includedIds
    .map(id => {
      const saved = state.manualTilePositions.get(id)

      return {
        id,
        x: saved?.x ?? fallbackById.get(id) ?? 0,
      }
    })
    .sort((a, b) => a.x - b.x)
}

function getRenderedTileX(tileId, rowIndex, index) {
  const object = ownTilesGroup.children.find(
    child => child.userData?.tileId === tileId
  )

  if (object) return object.position.x

  const saved = state.manualTilePositions.get(tileId)
  if (saved) return saved.x

  // İlk render/network yarışında henüz mesh veya manuel X oluşmamış olabilir.
  // Buradan getRowXPositions() çağırmak artık detectManualMeldRanges() ->
  // getRenderedTileX() döngüsü yaratırdı. Per algısı için yalnız komşu
  // mesafesi gerektiğinden doğal rack adımını deterministik fallback kullan.
  return Number(index) * (TILE_WIDTH + NORMAL_TILE_GAP)
}

function areEntryRangeTilesPhysicallyJoined(entries, start, end) {
  for (let i = start + 1; i < end; i++) {
    if (
      Math.abs(entries[i].x - entries[i - 1].x) >
      MELD_LINK_MAX_DISTANCE
    ) {
      return false
    }
  }

  return true
}

function detectDraggableGroupRanges(entries, handMap = getHandMap()) {
  const n = entries.length
  if (n < 2) return []

  const tiles = entries.map(
    entry => handMap.get(entry.id) || null
  )
  const candidates = []

  for (let start = 0; start < n; start++) {
    for (let end = start + 2; end <= n; end++) {
      const segmentTiles = tiles.slice(start, end)

      if (segmentTiles.some(tile => !tile)) continue

      const isCompleteGroup = visualValidateRackGroup(segmentTiles)
      const isNearGroup =
        !isCompleteGroup &&
        visualValidateNearMeldPair(segmentTiles)

      if (!isCompleteGroup && !isNearGroup) continue
      if (!areEntryRangeTilesPhysicallyJoined(entries, start, end)) continue

      candidates.push({
        start,
        end,
        length: end - start,
        complete: isCompleteGroup,
      })
    }
  }

  return chooseBestNonOverlappingRanges(n, candidates)
}

function findMeldContainingTile(tileId) {
  const location = findTileLocation(tileId)
  if (!location) return null

  const rowIndex = location.row
  const ids = state.rackRows[rowIndex]
  const handMap = getHandMap()

  const entries = ids.map((id, index) => ({
    id,
    x: getRenderedTileX(id, rowIndex, index),
  }))

  // Aynı taş birden fazla örtüşen "yakın per" adayına girebildiğinde
  // eski longest-scan seçimi satırın solundaki adayı tesadüfen seçebiliyordu.
  // Aynı DP segmentasyonu hem tam perleri hem çift/yakın-per başlangıçlarını
  // tek, çakışmayan bloklara ayırır; böylece tutuş deterministik kalır.
  const ranges = detectDraggableGroupRanges(entries, handMap)
  const range = ranges.find(
    candidate =>
      location.index >= candidate.start &&
      location.index < candidate.end
  )

  if (!range) return null

  return {
    rowIndex,
    tileIds: ids.slice(range.start, range.end),
  }
}

function isTileHitboxObject(object) {
  return object?.userData?.tileHitbox === true
}

function getPrecisePickHit(hits) {
  // Taşın tamamını kaplayan ana hitbox'ı kullanıyoruz.
  // Per tutuşu artık küçük dairesel handle'a bağlı değil; basılan noktanın
  // taşın üst / alt yarısında olmasına göre pointerdown sırasında karar verilir.
  // Bu sayede alt yarının tamamı geniş ve güvenilir bir per tutma alanıdır.
  return hits.find(hit =>
    isTileHitboxObject(hit.object)
  ) || null
}

function isLowerHalfPick(pickHit, tileId) {
  if (!pickHit?.point || !tileId) return false

  const tileObject = ownTilesGroup.children.find(
    child => child.userData?.tileId === tileId
  )

  if (!tileObject) return false

  // Dünya koordinatındaki tıklama noktasını taşın kendi koordinatına çevir.
  // Taş merkezi y=0: y < 0 alt yarı, y >= 0 üst yarı.
  const localPoint = tileObject.worldToLocal(
    pickHit.point.clone()
  )

  return localPoint.y < 0
}

function beginActiveDrag(mode, tileIds, anchorTileId) {
  captureCurrentRackAsManualLayout()

  const uniqueIds = [...new Set(tileIds)]
  const anchorObject = ownTilesGroup.children.find(
    child => child.userData?.tileId === anchorTileId
  )

  const anchorLocation = findTileLocation(anchorTileId)

  if (!anchorObject || !anchorLocation) {
    return false
  }

  const anchorSaved = state.manualTilePositions.get(anchorTileId)
  const anchorX = anchorSaved?.x ?? anchorObject.position.x
  const anchorY = getRowBaseY(anchorLocation.row)

  const items = []

  for (const id of uniqueIds) {
    const location = findTileLocation(id)
    if (!location) continue

    const saved = state.manualTilePositions.get(id)
    const object = ownTilesGroup.children.find(
      child => child.userData?.tileId === id
    )

    const x = saved?.x ?? object?.position.x ?? 0
    const y = getRowBaseY(location.row)

    items.push({
      id,
      sourceRow: location.row,
      offsetX: x - anchorX,
      offsetY: y - anchorY,
      object,
    })
  }

  if (items.length === 0) return false

  const handMap = getHandMap()
  const dragTiles = uniqueIds
    .map(id => handMap.get(id))
    .filter(Boolean)

  const dragKind =
    mode === 'single'
      ? 'single'
      : (
          dragTiles.length === 2 &&
          visualValidatePair(dragTiles)
            ? 'pair'
            : (
                dragTiles.length >= 3 &&
                visualValidateMeld(dragTiles)
                  ? 'meld'
                  : 'near'
              )
        )

  activeDrag = {
    mode,
    dragKind,
    anchorTileId,
    items,
    anchorX,
    anchorY,
    hasMoved: false,
    lastSolution: null,
    discardReady: false,
  }

  state.activeRackDragMode = mode
  state.activeRackDragKind = dragKind
  state.isDraggingTile = true
  state.dragStarted = true
  state.draggedTileId = anchorTileId
  state.draggedObject = anchorObject
  state.draggedSourceRow = anchorLocation.row

  return true
}

function getClampedDragAnchor(localPoint) {
  const minOffsetX = Math.min(
    ...activeDrag.items.map(item => item.offsetX)
  )

  const maxOffsetX = Math.max(
    ...activeDrag.items.map(item => item.offsetX)
  )

  const minOffsetY = Math.min(
    ...activeDrag.items.map(item => item.offsetY)
  )

  const maxOffsetY = Math.max(
    ...activeDrag.items.map(item => item.offsetY)
  )

  return {
    x: THREE.MathUtils.clamp(
      localPoint.x,
      RACK_LEFT_LIMIT - minOffsetX,
      RACK_RIGHT_LIMIT - maxOffsetX
    ),

    y: THREE.MathUtils.clamp(
      localPoint.y,
      0.20 - minOffsetY,
      0.86 - maxOffsetY
    ),
  }
}

function moveActiveDrag(localPoint) {
  if (!activeDrag) return

  const canUseDiscardTarget =
    activeDrag.mode === 'single' &&
    activeDrag.items.length === 1 &&
    localPoint.x >= DISCARD_TRIGGER_X

  activeDrag.discardReady = canUseDiscardTarget

  if (canUseDiscardTarget) {
    clearDropPreview()
    discardGuideTargetOpacity = 0.72

    const discardTarget = getCurrentDiscardTarget()
    discardGuide.position.set(
      discardTarget.x,
      -0.007,
      discardTarget.z
    )

    const item = activeDrag.items[0]

    if (!item.object) {
      item.object = ownTilesGroup.children.find(
        child => child.userData?.tileId === item.id
      )
    }

    if (item.object) {
      item.object.scale.setScalar(1.06)
    }

    return
  }

  discardGuideTargetOpacity =
    activeDrag.mode === 'single'
      ? 0.12
      : 0

  const anchor = getClampedDragAnchor(localPoint)

  activeDrag.anchorX = anchor.x
  activeDrag.anchorY = anchor.y

  for (const item of activeDrag.items) {
    if (!item.object) {
      item.object = ownTilesGroup.children.find(
        child => child.userData?.tileId === item.id
      )
    }

    if (!item.object) continue

    item.object.position.x = anchor.x + item.offsetX
    item.object.position.y = anchor.y + item.offsetY
    item.object.position.z = 0.15
    item.object.rotation.x = -0.10
    item.object.rotation.z +=
      (0 - item.object.rotation.z) * 0.38
    item.object.scale.setScalar(
      activeDrag.mode === 'single'
        ? 1.075
        : 1.045
    )
  }

  updateActiveDragPreview()
}

function buildRequestedDropPositions() {
  const requested = new Map()

  for (const item of activeDrag.items) {
    requested.set(item.id, {
      x: activeDrag.anchorX + item.offsetX,
      row: getTargetRowFromY(
        activeDrag.anchorY + item.offsetY
      ),
    })
  }

  return requested
}

function normalizeStaticEntries(entries) {
  const sorted = entries
    .map(entry => ({ ...entry }))
    .sort((a, b) => a.x - b.x)

  if (sorted.length === 0) {
    return {
      valid: true,
      entries: sorted,
    }
  }

  if (sorted.length === 1) {
    sorted[0].x = THREE.MathUtils.clamp(
      sorted[0].x,
      RACK_LEFT_LIMIT,
      RACK_RIGHT_LIMIT
    )

    return {
      valid: true,
      entries: sorted,
    }
  }

  const requiredSpan =
    (sorted.length - 1) * COLLISION_DISTANCE

  if (
    requiredSpan >
    RACK_RIGHT_LIMIT - RACK_LEFT_LIMIT + POSITION_EPSILON
  ) {
    return {
      valid: false,
      entries: sorted,
    }
  }

  // Geçerli statik taşlara hiç dokunma. Eski sürümlerde burada soldan
  // sağa bir normalizasyon her preview hesabında tekrar çalışıyor ve çok
  // küçük bir overlap / sınır hatasında tüm sırayı zincirleme kaydırabiliyordu.
  const alreadyStable =
    sorted[0].x >= RACK_LEFT_LIMIT - POSITION_EPSILON &&
    sorted[sorted.length - 1].x <= RACK_RIGHT_LIMIT + POSITION_EPSILON &&
    sorted.every(
      (entry, index) =>
        index === 0 ||
        entry.x - sorted[index - 1].x >=
          COLLISION_DISTANCE - POSITION_EPSILON
    )

  if (alreadyStable) {
    return {
      valid: true,
      entries: sorted,
    }
  }

  // Eğer eski bir state gerçekten çakışmalı geldiyse onu "bir yana doğru
  // süpürmek" yerine en az toplam hareketle düzelt. x_i >= x_(i-1) + d
  // koşulunu y_i = x_i - i*d dönüşümüyle monoton izotonik projeksiyona
  // çeviriyoruz. Böylece yalnızca bozuk kısım gerektiği kadar hareket eder.
  const transformedMin = RACK_LEFT_LIMIT
  const transformedMax =
    RACK_RIGHT_LIMIT -
    (sorted.length - 1) * COLLISION_DISTANCE

  const blocks = []

  sorted.forEach((entry, index) => {
    const value = THREE.MathUtils.clamp(
      entry.x - index * COLLISION_DISTANCE,
      transformedMin,
      transformedMax
    )

    blocks.push({
      start: index,
      end: index,
      sum: value,
      count: 1,
      mean: value,
    })

    while (
      blocks.length >= 2 &&
      blocks[blocks.length - 2].mean >
        blocks[blocks.length - 1].mean
    ) {
      const right = blocks.pop()
      const left = blocks.pop()
      const sum = left.sum + right.sum
      const count = left.count + right.count

      blocks.push({
        start: left.start,
        end: right.end,
        sum,
        count,
        mean: THREE.MathUtils.clamp(
          sum / count,
          transformedMin,
          transformedMax
        ),
      })
    }
  })

  const projected = new Array(sorted.length)

  for (const block of blocks) {
    for (let index = block.start; index <= block.end; index++) {
      projected[index] = block.mean
    }
  }

  sorted.forEach((entry, index) => {
    entry.x =
      projected[index] +
      index * COLLISION_DISTANCE
  })

  return {
    valid:
      sorted[0].x >= RACK_LEFT_LIMIT - POSITION_EPSILON &&
      sorted[sorted.length - 1].x <=
        RACK_RIGHT_LIMIT + POSITION_EPSILON,
    entries: sorted,
  }
}

// Mouse hangi iki mevcut taşın arasındaysa bırakma niyeti o aralıktır.
// v30'da ankraj çözücüsü hedef aralık dar olduğunda başka, boş bir aralık
// seçebiliyordu; bu yüzden kullanıcı iki taşın arasına sokmak isterken taş
// yana kaçıyordu. Burada hedef insert index'i tek ve deterministik tutuyoruz.
function getRequestedInsertIndex(entries, requestedX) {
  for (let index = 0; index < entries.length; index++) {
    if (requestedX < entries[index].x) {
      return index
    }
  }

  return entries.length
}

// Bir bırakma çözümünün tek görevi vardır: sürüklenen blok için seçilen
// aralığı korumak ve mevcut taşları mümkün olduğunca hiç oynatmamak.
// Tek taş ve per artık aynı motoru kullanır; farklı fallback davranışları yoktur.
function makeInvalidLayout(entries) {
  return {
    valid: false,
    order: entries.map(entry => entry.id),
    positions: new Map(entries.map(entry => [entry.id, entry.x])),
  }
}

function buildGapPlacement(
  entries,
  group,
  insertIndex,
  groupMin
) {
  const groupSpan =
    group[group.length - 1].x - group[0].x

  const shift = groupMin - group[0].x
  const placedGroup = group.map(item => ({
    ...item,
    x: item.x + shift,
  }))

  const leftEntries = entries.slice(0, insertIndex)
  const rightEntries = entries.slice(insertIndex)
  const positions = new Map(
    entries.map(entry => [entry.id, entry.x])
  )

  for (const item of placedGroup) {
    positions.set(item.id, item.x)
  }

  // Solda yalnız BLOĞA gerçekten çarpan zincir sola açılır. Bir taş zaten
  // yeterince uzaktaysa kendisi ve onun solundaki bağımsız taşlar yerinde kalır.
  let rightBoundary = placedGroup[0].x

  for (let i = leftEntries.length - 1; i >= 0; i--) {
    const entry = leftEntries[i]
    const maximumX = rightBoundary - COLLISION_DISTANCE
    const x =
      entry.x > maximumX + POSITION_EPSILON
        ? maximumX
        : entry.x

    positions.set(entry.id, x)
    rightBoundary = x
  }

  // Sağ tarafta aynı kuralın simetriği uygulanır.
  let leftBoundary = placedGroup[placedGroup.length - 1].x

  for (let i = 0; i < rightEntries.length; i++) {
    const entry = rightEntries[i]
    const minimumX = leftBoundary + COLLISION_DISTANCE
    const x =
      entry.x < minimumX - POSITION_EPSILON
        ? minimumX
        : entry.x

    positions.set(entry.id, x)
    leftBoundary = x
  }

  const order = [
    ...leftEntries.map(entry => entry.id),
    ...placedGroup.map(item => item.id),
    ...rightEntries.map(entry => entry.id),
  ]

  const orderedXs = order.map(id => positions.get(id))

  for (let i = 0; i < orderedXs.length; i++) {
    const x = orderedXs[i]

    if (!Number.isFinite(x)) {
      return makeInvalidLayout(entries)
    }

    if (
      x < RACK_LEFT_LIMIT - POSITION_EPSILON ||
      x > RACK_RIGHT_LIMIT + POSITION_EPSILON
    ) {
      return makeInvalidLayout(entries)
    }

    if (
      i > 0 &&
      x - orderedXs[i - 1] <
        COLLISION_DISTANCE - POSITION_EPSILON
    ) {
      return makeInvalidLayout(entries)
    }
  }

  let staticMovement = 0
  let movedStaticCount = 0
  let maximumStaticMovement = 0

  for (const entry of entries) {
    const delta = Math.abs(
      (positions.get(entry.id) ?? entry.x) - entry.x
    )

    staticMovement += delta
    maximumStaticMovement = Math.max(
      maximumStaticMovement,
      delta
    )

    if (delta > POSITION_EPSILON) {
      movedStaticCount++
    }
  }

  return {
    valid: true,
    order,
    positions,
    score: {
      staticMovement,
      movedStaticCount,
      maximumStaticMovement,
      draggedMovement: Math.abs(groupMin - group[0].x),
    },
  }
}

function isBetterGapPlacement(candidate, current) {
  if (!current) return true

  const a = candidate.score
  const b = current.score

  // 1) Önce rafta duran taşların TOPLAM hareketini minimum yap.
  if (
    Math.abs(a.staticMovement - b.staticMovement) >
    POSITION_EPSILON
  ) {
    return a.staticMovement < b.staticMovement
  }

  // 2) Aynı toplam harekette mümkün olan en az sayıda eski taşı oynat.
  if (a.movedStaticCount !== b.movedStaticCount) {
    return a.movedStaticCount < b.movedStaticCount
  }

  // 3) Tek bir taşın gereksiz büyük sıçramasını engelle.
  if (
    Math.abs(
      a.maximumStaticMovement - b.maximumStaticMovement
    ) > POSITION_EPSILON
  ) {
    return a.maximumStaticMovement < b.maximumStaticMovement
  }

  // 4) Statikler açısından eşitse sürüklenen blok mouse'a en yakın kalsın.
  return a.draggedMovement < b.draggedMovement
}

function solveDeterministicGapDrop(
  entries,
  group,
  insertIndex
) {
  if (
    !Array.isArray(group) ||
    group.length === 0 ||
    !Number.isInteger(insertIndex) ||
    insertIndex < 0 ||
    insertIndex > entries.length
  ) {
    return makeInvalidLayout(entries)
  }

  const groupSpan =
    group[group.length - 1].x - group[0].x

  // Seçilen aralığın SOL/SAĞ tarafındaki taşların hepsi en kötü ihtimalle
  // COLLISION_DISTANCE ile paketlense dahi blok rack sınırında kalmalı.
  // Bu aralık insertIndex'e sadıktır; başka bir boşluğa kaçış yoktur.
  const minimumGroupMin =
    RACK_LEFT_LIMIT + insertIndex * COLLISION_DISTANCE

  const rightCount = entries.length - insertIndex
  const maximumGroupMin =
    RACK_RIGHT_LIMIT -
    rightCount * COLLISION_DISTANCE -
    groupSpan

  if (
    minimumGroupMin >
    maximumGroupMin + POSITION_EPSILON
  ) {
    return makeInvalidLayout(entries)
  }

  const candidates = []

  const addCandidate = value => {
    if (!Number.isFinite(value)) return

    const clamped = THREE.MathUtils.clamp(
      value,
      minimumGroupMin,
      maximumGroupMin
    )

    if (
      candidates.some(
        existing =>
          Math.abs(existing - clamped) < POSITION_EPSILON / 4
      )
    ) {
      return
    }

    candidates.push(clamped)
  }

  // Mouse'un istediği yer her zaman adaydır.
  addCandidate(group[0].x)
  addCandidate(minimumGroupMin)
  addCandidate(maximumGroupMin)

  // Statik hareket maliyeti yalnız bu temas eşiklerinde eğim değiştirir.
  // Tüm eşikleri denemek (satırda en fazla ~22 taş var) hem ucuz hem kesin;
  // rastgele penalty/fallback seçimine ihtiyaç bırakmaz.
  for (let i = 0; i < insertIndex; i++) {
    addCandidate(
      entries[i].x +
      (insertIndex - i) * COLLISION_DISTANCE
    )
  }

  for (let i = insertIndex; i < entries.length; i++) {
    addCandidate(
      entries[i].x -
      groupSpan -
      (i - insertIndex + 1) * COLLISION_DISTANCE
    )
  }

  let best = null

  for (const groupMin of candidates) {
    const placement = buildGapPlacement(
      entries,
      group,
      insertIndex,
      groupMin
    )

    if (!placement.valid) continue

    if (isBetterGapPlacement(placement, best)) {
      best = placement
    }
  }

  return best || makeInvalidLayout(entries)
}

// Bir grup/per sürüklenirken hedef satırdaki mevcut yapışık grupların
// ortasına girmesine izin verme. Aksi halde örn. mavi 9-10-11'in sağına
// siyah 8-9-10 bırakılırken solver, mavi 10 ile 11 arasını da bir gap
// sanıp mavi 11'i sürüklenen perin sağına atabiliyor.
//
// Bu kilit YALNIZCA çoklu grup sürüklemesinde kullanılır. Tek taş sürükleme
// hâlâ iki taşın arasına girebilir ve gerekirse komşuları açabilir.
function getProtectedStaticInsertIndices(entries) {
  const protectedIndices = new Set()
  const ranges = detectDraggableGroupRanges(entries)

  // Yalnız seçilmiş, çakışmayan gerçek blokların iç sınırlarını kilitle.
  // Önceki tüm-subsegment taraması iki ayrı perin sınırındaki tesadüfi
  // "yakın per" çiftini de grup sanıp iki per arasındaki gerçek boşluğu
  // kapatabiliyordu.
  for (const range of ranges) {
    for (
      let insertIndex = range.start + 1;
      insertIndex < range.end;
      insertIndex++
    ) {
      protectedIndices.add(insertIndex)
    }
  }

  return protectedIndices
}

function getDeterministicBlockInsertIndex(
  entries,
  requestedCenter,
  protectedIndices = new Set()
) {
  if (!Number.isFinite(requestedCenter)) {
    return null
  }

  const rawIndex = getRequestedInsertIndex(
    entries,
    requestedCenter
  )

  if (!protectedIndices.has(rawIndex)) {
    return rawIndex
  }

  // Mouse mevcut bir perin tam içine denk geldiyse o peri parçalama.
  // Korunan iç sınırların oluşturduğu bütün bloğu bul ve mouse bloğun
  // hangi yarısındaysa tüm sürüklenen grubu o tarafa koy.
  let firstProtected = rawIndex
  let lastProtected = rawIndex

  while (protectedIndices.has(firstProtected - 1)) {
    firstProtected--
  }

  while (protectedIndices.has(lastProtected + 1)) {
    lastProtected++
  }

  const leftBoundary = Math.max(0, firstProtected - 1)
  const rightBoundary = Math.min(entries.length, lastProtected + 1)

  if (leftBoundary === rightBoundary) {
    return leftBoundary
  }

  const firstEntry = entries[leftBoundary]
  const lastEntry = entries[rightBoundary - 1]

  if (!firstEntry || !lastEntry) {
    return rawIndex
  }

  const protectedCenter =
    (firstEntry.x + lastEntry.x) / 2

  return requestedCenter <= protectedCenter
    ? leftBoundary
    : rightBoundary
}

function makeDraggedBlock(draggedIds, requested, compact = false) {
  const group = draggedIds
    .map(id => ({
      id,
      x: requested.get(id)?.x ?? 0,
    }))
    .sort((a, b) => a.x - b.x)

  if (group.length === 0) return group

  if (compact) {
    const center =
      group.reduce((sum, item) => sum + item.x, 0) /
      group.length

    const start =
      center -
      ((group.length - 1) * COLLISION_DISTANCE) / 2

    group.forEach((item, index) => {
      item.x = start + index * COLLISION_DISTANCE
    })

    return group
  }

  for (let i = 1; i < group.length; i++) {
    group[i].x = Math.max(
      group[i].x,
      group[i - 1].x + COLLISION_DISTANCE
    )
  }

  return group
}

function solveRowDrop(
  rowIndex,
  draggedIds,
  requested,
  allDraggedIds,
  compactDragged = false
) {
  const rawEntries = getManualRowEntries(
    rowIndex,
    allDraggedIds
  )

  // Bu sıraya hiçbir sürüklenen taş gelmiyorsa EN ÖNEMLİ kural: dokunma.
  // Normalizasyon bile yapma; diğer sıradaki bir drop bu sıradaki taşları
  // mikroskobik miktarda dahi oynatamaz.
  if (draggedIds.length === 0) {
    return {
      valid: true,
      order: rawEntries.map(entry => entry.id),
      positions: new Map(rawEntries.map(entry => [entry.id, entry.x])),
    }
  }

  const normalizedStatic = normalizeStaticEntries(rawEntries)

  if (!normalizedStatic.valid) {
    return makeInvalidLayout(rawEntries)
  }

  const entries = normalizedStatic.entries

  let group = makeDraggedBlock(
    draggedIds,
    requested,
    compactDragged
  )

  if (group.length === 0) {
    return makeInvalidLayout(entries)
  }

  const rackCenterSpan =
    RACK_RIGHT_LIMIT - RACK_LEFT_LIMIT

  let groupSpan =
    group[group.length - 1].x - group[0].x

  // Çoklu blok kendi eski iç boşlukları yüzünden rack'e sığmıyorsa yalnız
  // SÜRÜKLENEN bloğu kompaktlaştır. Statik taşlara dokunmak çözüm değildir.
  if (
    groupSpan > rackCenterSpan + POSITION_EPSILON &&
    group.length > 1 &&
    !compactDragged
  ) {
    return solveRowDrop(
      rowIndex,
      draggedIds,
      requested,
      allDraggedIds,
      true
    )
  }

  if (groupSpan > rackCenterSpan + POSITION_EPSILON) {
    return makeInvalidLayout(entries)
  }

  const requestedCenter =
    (group[0].x + group[group.length - 1].x) / 2

  let insertIndex

  if (group.length === 1) {
    // Tek taş mouse'un gösterdiği TAM aralığa girer. Snap hedefi X'i biraz
    // değiştirmiş olsa bile applySingleSnapIntent'in insertIndex hint'i
    // kullanıcının ilk seçtiği boşluğu kilitler.
    const hintedInsertIndex =
      requested.get(group[0].id)?.insertIndex

    insertIndex =
      Number.isInteger(hintedInsertIndex) &&
      hintedInsertIndex >= 0 &&
      hintedInsertIndex <= entries.length
        ? hintedInsertIndex
        : getRequestedInsertIndex(
            entries,
            requestedCenter
          )
  } else {
    // Per/per-benzeri grup mevcut başka bir grubun içini parçalayamaz.
    // Mouse o grubun içine gelirse yalnızca sol veya sağ dış sınır seçilir.
    const protectedIndices =
      getProtectedStaticInsertIndices(entries)

    insertIndex = getDeterministicBlockInsertIndex(
      entries,
      requestedCenter,
      protectedIndices
    )
  }

  if (!Number.isInteger(insertIndex)) {
    return makeInvalidLayout(entries)
  }

  const layout = solveDeterministicGapDrop(
    entries,
    group,
    insertIndex
  )

  if (
    !layout.valid &&
    group.length > 1 &&
    !compactDragged
  ) {
    // Korunan grup değil ama çoklu sürükleme çağrısı gelmişse ikinci ve son
    // deneme yalnız sürüklenen bloğu kompaktlaştırır. Gap değişmez.
    return solveRowDrop(
      rowIndex,
      draggedIds,
      requested,
      allDraggedIds,
      true
    )
  }

  return layout
}

function calculateActiveDragSolution() {
  if (!activeDrag) {
    return {
      valid: false,
      layouts: new Map(),
      requested: new Map(),
    }
  }

  let requested = buildRequestedDropPositions()

  if (
    activeDrag.mode === 'single' &&
    activeDrag.items.length === 1
  ) {
    requested = applySingleSnapIntent(
      activeDrag.items[0].id,
      requested
    )
  }

  const allDraggedIds = new Set(
    activeDrag.items.map(item => item.id)
  )

  const layouts = new Map()
  let valid = true

  for (let rowIndex = 0; rowIndex < 2; rowIndex++) {
    const draggedIds = activeDrag.items
      .filter(item => requested.get(item.id)?.row === rowIndex)
      .map(item => item.id)

    const layout = solveRowDrop(
      rowIndex,
      draggedIds,
      requested,
      allDraggedIds,
      activeDrag.mode === 'meld'
    )

    layouts.set(rowIndex, layout)

    if (!layout.valid) {
      valid = false
    }
  }

  return {
    valid,
    layouts,
    requested,
  }
}

function updateActiveDragPreview() {
  clearDropPreview()
  if (!activeDrag) return

  const solution = calculateActiveDragSolution()
  activeDrag.lastSolution = solution

  const draggedSet = new Set(
    activeDrag.items.map(item => item.id)
  )

  let previewIndex = 0

  const validColor =
    activeDrag.mode === 'meld'
      ? 0x70c7ff
      : 0xffd783

  for (let rowIndex = 0; rowIndex < 2; rowIndex++) {
    const layout = solution.layouts.get(rowIndex)

    if (solution.valid && layout) {
      for (const [id, x] of layout.positions) {
        if (!draggedSet.has(id)) continue
        if (solution.requested.get(id)?.row !== rowIndex) continue

        const mesh = getPreviewMesh(previewIndex++)
        mesh.visible = true
        mesh.position.set(
          x,
          getRowBaseY(rowIndex),
          0.115
        )
        mesh.rotation.x = -0.10
        mesh.material.color.setHex(validColor)
        mesh.material.opacity = 0.52
      }
    }
  }

  // Geçersiz drop'ta nereye bırakmaya çalışıldığını kırmızı göster.
  if (!solution.valid) {
    for (const item of activeDrag.items) {
      const requested = solution.requested.get(item.id)
      if (!requested) continue

      const mesh = getPreviewMesh(previewIndex++)
      mesh.visible = true
      mesh.position.set(
        THREE.MathUtils.clamp(
          requested.x,
          RACK_LEFT_LIMIT,
          RACK_RIGHT_LIMIT
        ),
        getRowBaseY(requested.row),
        0.115
      )
      mesh.rotation.x = -0.10
      mesh.material.color.setHex(0xff6f61)
      mesh.material.opacity = 0.68
    }
  }

  for (let i = previewIndex; i < previewPool.length; i++) {
    previewPool[i].visible = false
  }
}

function getPreDropCompleteGroups(
  rowIds,
  droppedTileId,
  preDropPositions,
  handMap
) {
  const entries = rowIds
    .filter(id => id !== droppedTileId)
    .map(id => ({
      id,
      x: preDropPositions.get(id),
    }))
    .filter(entry => Number.isFinite(entry.x))
    .sort((a, b) => a.x - b.x)

  if (entries.length < 2) return []

  const candidates = []

  for (let start = 0; start < entries.length; start++) {
    for (let end = start + 2; end <= entries.length; end++) {
      const segmentEntries = entries.slice(start, end)
      const segmentTiles = segmentEntries.map(
        entry => handMap.get(entry.id) || null
      )

      if (segmentTiles.some(tile => !tile)) continue
      if (!visualValidateRackGroup(segmentTiles)) continue
      if (!areEntryRangeTilesPhysicallyJoined(entries, start, end)) continue

      candidates.push({
        start,
        end,
        length: end - start,
        complete: true,
      })
    }
  }

  const ranges = chooseBestNonOverlappingRanges(
    entries.length,
    candidates
  )

  return ranges.map(range =>
    new Set(
      entries
        .slice(range.start, range.end)
        .map(entry => entry.id)
    )
  )
}

function snapCandidateStealsCompleteGroup(
  segmentIds,
  droppedTileId,
  isCompleteCandidate,
  protectedGroups
) {
  const existingCandidateIds = new Set(
    segmentIds.filter(id => id !== droppedTileId)
  )

  for (const protectedGroup of protectedGroups) {
    let overlapCount = 0

    for (const id of protectedGroup) {
      if (existingCandidateIds.has(id)) {
        overlapCount++
      }
    }

    if (overlapCount === 0) continue

    // İki taşlık yeni bir "yakın per" mevcut tamamlanmış perden taş
    // çalamaz. Tamamlanmış aday da eski grubun yalnız bir kısmını değil,
    // grubun tamamını içermek zorundadır.
    if (!isCompleteCandidate || overlapCount !== protectedGroup.size) {
      return true
    }
  }

  return false
}

function isBetterSingleSnapCandidate(candidate, current) {
  if (!current) return true

  // Oyuncunun bıraktığı fiziksel yer birinci öncelik. Önceki sürümde uzun
  // grup önce geldiği için 5'i 5-5'in dibine bıraksan bile eski 5-6-7-8
  // dört taş olduğu için kazanabiliyordu. Artık en yakın geçerli komşuluk
  // kazanır; yalnız neredeyse aynı mesafedeki adaylarda complete/uzunluk
  // tie-break olarak kullanılır.
  if (
    Math.abs(candidate.anchorDistance - current.anchorDistance) >
    0.004
  ) {
    return candidate.anchorDistance < current.anchorDistance
  }

  if (candidate.complete !== current.complete) {
    return candidate.complete
  }

  if (candidate.tileIds.length !== current.tileIds.length) {
    return candidate.tileIds.length > current.tileIds.length
  }

  return candidate.start < current.start
}

function isSnapCandidateContinuouslyJoined(
  segmentIds,
  droppedTileId,
  requestedX,
  preDropPositions
) {
  const droppedIndex = segmentIds.indexOf(droppedTileId)
  if (droppedIndex < 0) return false

  let touchesDroppedNeighbor = false

  for (let i = 1; i < segmentIds.length; i++) {
    const leftId = segmentIds[i - 1]
    const rightId = segmentIds[i]
    const includesDropped =
      leftId === droppedTileId || rightId === droppedTileId

    if (includesDropped) {
      const neighborId =
        leftId === droppedTileId
          ? rightId
          : leftId
      const neighborX = preDropPositions.get(neighborId)

      if (!Number.isFinite(neighborX)) return false

      if (
        Math.abs(requestedX - neighborX) >
        MELD_SNAP_MAX_DISTANCE
      ) {
        return false
      }

      touchesDroppedNeighbor = true
      continue
    }

    // Yeni taşın dışındaki üyeler önceden de birbirine fiziksel olarak
    // bağlı olmalı. Böylece satır sırası uygun diye uzaktaki uyumlu taşlar
    // tek drop ile uzun bir per/gruba çekilmez.
    const leftX = preDropPositions.get(leftId)
    const rightX = preDropPositions.get(rightId)

    if (!Number.isFinite(leftX) || !Number.isFinite(rightX)) {
      return false
    }

    if (
      Math.abs(rightX - leftX) >
      MELD_LINK_MAX_DISTANCE
    ) {
      return false
    }
  }

  return touchesDroppedNeighbor
}

// Tek taş snap'i artık drop SONRASINDA ikinci kez taşları oynatmaz.
// Önce hedef X burada belirlenir, sonra normal deterministik solver TEK KEZ
// çalışır. Böylece preview ile pointer-up sonucu aynıdır ve mevcut taşlar
// yalnız fiziksel olarak gerçekten yer açmaları gerekiyorsa hareket eder.
function getSingleSnapTargetX(
  tileId,
  rowIndex,
  requestedX
) {
  if (!tileId || !Number.isFinite(requestedX)) {
    return requestedX
  }

  const handMap = getHandMap()
  const entries = getManualRowEntries(
    rowIndex,
    new Set([tileId])
  )

  const insertIndex = getRequestedInsertIndex(
    entries,
    requestedX
  )

  const ids = [
    ...entries.slice(0, insertIndex).map(entry => entry.id),
    tileId,
    ...entries.slice(insertIndex).map(entry => entry.id),
  ]

  const preDropPositions = new Map(
    entries.map(entry => [entry.id, entry.x])
  )

  const tileIndex = insertIndex
  const protectedCompleteGroups = getPreDropCompleteGroups(
    ids,
    tileId,
    preDropPositions,
    handMap
  )

  let best = null

  for (let start = 0; start <= tileIndex; start++) {
    for (let end = tileIndex + 1; end <= ids.length; end++) {
      if (end - start < 2) continue

      const segmentIds = ids.slice(start, end)
      const segmentTiles = segmentIds.map(
        id => handMap.get(id) || null
      )

      if (segmentTiles.some(tile => !tile)) continue

      const isCompleteCandidate =
        visualValidateRackGroup(segmentTiles)

      const isNearCandidate =
        !isCompleteCandidate &&
        visualValidateNearMeldPair(segmentTiles)

      if (!isCompleteCandidate && !isNearCandidate) continue

      if (
        snapCandidateStealsCompleteGroup(
          segmentIds,
          tileId,
          isCompleteCandidate,
          protectedCompleteGroups
        )
      ) {
        continue
      }

      if (
        !isSnapCandidateContinuouslyJoined(
          segmentIds,
          tileId,
          requestedX,
          preDropPositions
        )
      ) {
        continue
      }

      const existingDistances = segmentIds
        .filter(id => id !== tileId)
        .map(id => Math.abs(
          requestedX - preDropPositions.get(id)
        ))
        .filter(Number.isFinite)

      const candidate = {
        start,
        tileIds: segmentIds,
        complete: isCompleteCandidate,
        anchorDistance:
          existingDistances.length > 0
            ? Math.min(...existingDistances)
            : Number.POSITIVE_INFINITY,
      }

      if (isBetterSingleSnapCandidate(candidate, best)) {
        best = candidate
      }
    }
  }

  if (!best) return requestedX

  const droppedIndex = best.tileIds.indexOf(tileId)
  if (droppedIndex < 0) return requestedX

  const leftId =
    droppedIndex > 0
      ? best.tileIds[droppedIndex - 1]
      : null

  const rightId =
    droppedIndex < best.tileIds.length - 1
      ? best.tileIds[droppedIndex + 1]
      : null

  const leftX = leftId
    ? preDropPositions.get(leftId)
    : null

  const rightX = rightId
    ? preDropPositions.get(rightId)
    : null

  // Semantik snap yalnız SÜRÜKLENEN taşın hedefini değiştirir. Var olan
  // per/çift üyelerinin X'i burada asla yeniden merkezlenmez.
  if (Number.isFinite(leftX) && Number.isFinite(rightX)) {
    const minimumX = leftX + COLLISION_DISTANCE
    const maximumX = rightX - COLLISION_DISTANCE

    if (minimumX <= maximumX + POSITION_EPSILON) {
      return THREE.MathUtils.clamp(
        requestedX,
        minimumX,
        maximumX
      )
    }

    // Aralık fiziksel olarak darsa tam ortayı iste; tek solver iki komşu
    // zincirini yalnız gerektiği kadar açacaktır.
    return (leftX + rightX) / 2
  }

  if (Number.isFinite(leftX)) {
    return leftX + COLLISION_DISTANCE
  }

  if (Number.isFinite(rightX)) {
    return rightX - COLLISION_DISTANCE
  }

  return requestedX
}

function applySingleSnapIntent(tileId, requested) {
  const target = requested.get(tileId)

  if (
    !target ||
    !Number.isFinite(target.x) ||
    (target.row !== 0 && target.row !== 1)
  ) {
    return requested
  }

  // Snap X'i komşuya yaklaşırken başka bir taş merkezinin ötesine geçse
  // bile kullanıcının ilk işaret ettiği ARALIK değişmesin. Insert hint bu
  // niyeti solver'a taşır.
  const targetEntries = getManualRowEntries(
    target.row,
    new Set([tileId])
  )

  const firstEntry = targetEntries[0] || null
  const lastEntry = targetEntries[targetEntries.length - 1] || null
  const wantsLeftWall = Boolean(
    firstEntry &&
    target.x <=
      RACK_LEFT_LIMIT + WALL_INSERT_EDGE_EPSILON
  )
  const wantsRightWall = Boolean(
    lastEntry &&
    target.x >=
      RACK_RIGHT_LIMIT - WALL_INSERT_EDGE_EPSILON
  )

  const insertIndex = wantsLeftWall
    ? 0
    : wantsRightWall
      ? targetEntries.length
      : getRequestedInsertIndex(
          targetEntries,
          target.x
        )

  const snapX = wantsLeftWall
    ? RACK_LEFT_LIMIT
    : wantsRightWall
      ? RACK_RIGHT_LIMIT
      : getSingleSnapTargetX(
          tileId,
          target.row,
          target.x
        )

  if (!Number.isFinite(snapX)) {
    return requested
  }

  const adjusted = new Map(requested)
  adjusted.set(tileId, {
    ...target,
    x: THREE.MathUtils.clamp(
      snapX,
      RACK_LEFT_LIMIT,
      RACK_RIGHT_LIMIT
    ),
    insertIndex,
  })

  return adjusted
}

function commitActiveDrag() {
  if (!activeDrag) return false

  const solution =
    activeDrag.lastSolution ||
    calculateActiveDragSolution()

  if (!solution.valid) {
    return false
  }

  // Preview'da gösterilen çözüm doğrudan state'e uygulanır. Pointer-up'tan
  // sonra başka bir snap/normalize pass'i çalışmadığı için gizli taş hareketi yoktur.
  applySolvedLayouts(solution)
  return true
}

function resetDragState() {
  clearDropPreview()
  discardGuideTargetOpacity = 0

  activeDrag = null

  state.activeRackDragMode = null
  state.activeRackDragKind = null
  state.openBoardDragCaptured = false
  state.openBoardDragReady = false
  state.boardInspectorDragActive = false
  state.isDraggingTile = false
  state.dragStarted = false
  state.draggedTileId = null
  state.draggedObject = null
  state.draggedSourceRow = null
  state.returnDiscardDropReady = false
}

export function isDraggingReturnableDiscardTile() {
  return Boolean(
    activeDrag &&
    activeDrag.mode === 'single' &&
    activeDrag.items.length === 1 &&
    activeDrag.items[0].id === state.returnableDiscardTileId
  )
}

export function cancelRackDragVisual({ render = true } = {}) {
  resetDragState()

  if (render) {
    renderOwnHand()
  }

  renderer.domElement.style.cursor = 'default'
}

export function updateRackInteractionAnimation() {
  discardGuidePulse += 0.11

  const markerPulse =
    0.82 + (Math.sin(discardGuidePulse * 0.72) + 1) * 0.09

  ownTilesGroup.traverse(child => {
    if (!child.userData?.pickedDiscardMarker) return

    if (child.material) {
      child.material.opacity = markerPulse
    }
  })

  // Kamera pointer eventinden bağımsız hareket ettiği için board controller'ın
  // her-frame captured durumunu rack görünürlüğüne de uygula. Böylece üst
  // kameraya per/taş taşırken çift görüntü veya bir frame kaybolma oluşmaz.
  if (activeDrag) {
    const boardCaptured = Boolean(state.openBoardDragCaptured)

    if (boardCaptured !== Boolean(activeDrag.openBoardCaptured)) {
      activeDrag.openBoardCaptured = boardCaptured
      activeDrag.openBoardReady = Boolean(state.openBoardDragReady)

      for (const item of activeDrag.items) {
        if (!item.object) {
          item.object = ownTilesGroup.children.find(
            child => child.userData?.tileId === item.id
          )
        }

        if (item.object) {
          item.object.visible = !boardCaptured
        }
      }
    }
  }

  // Üst kamera geri inerken pointer bir an sabit kalsa bile rack'teki gerçek
  // per görünmez kalmasın. Board ghost alanı terk edildiğinde fiziksel taşları
  // kendiliğinden geri açıyoruz.
  if (
    activeDrag?.openBoardCaptured &&
    !state.boardInspectorDragActive &&
    (state.overviewProgress || 0) < 0.09
  ) {
    activeDrag.openBoardCaptured = false
    activeDrag.openBoardReady = false

    for (const item of activeDrag.items) {
      if (item.object) {
        item.object.visible = true
      }
    }
  }

  // Kaynaktan alınmış sticky taş, pointer eventleri arasında da hedefe
  // yaklaşmaya devam eder; böylece hafif ama hızlı bir takip hissi verir.
  if (stickyPickup?.object && state.isStickyPickup) {
    stickyPickup.object.position.x +=
      (stickyPickup.localX - stickyPickup.object.position.x) * 0.34

    stickyPickup.object.position.y +=
      (stickyPickup.localY - stickyPickup.object.position.y) * 0.34

    stickyPickup.object.position.z +=
      (0.19 - stickyPickup.object.position.z) * 0.34
  }

  const pulse =
    1 +
    Math.sin(discardGuidePulse) *
      (
        discardGuideTargetOpacity > 0.5
          ? 0.055
          : 0.015
      )

  discardGuide.scale.setScalar(pulse)

  discardGuideMaterial.opacity +=
    (
      discardGuideTargetOpacity -
      discardGuideMaterial.opacity
    ) * 0.22

  if (
    activeDrag?.discardReady &&
    activeDrag.mode === 'single' &&
    activeDrag.items.length === 1
  ) {
    const item = activeDrag.items[0]

    if (item.object) {
      const discardTarget = getCurrentDiscardTarget()

      const targetPosition =
        new THREE.Vector3(
          discardTarget.x,
          discardTarget.y,
          discardTarget.z
        )

      item.object.position.lerp(
        targetPosition,
        0.30
      )

      item.object.rotation.x +=
        (
          -Math.PI / 2 -
          item.object.rotation.x
        ) * 0.27

      item.object.rotation.z +=
        (
          DISCARD_TILE_ROTATION_Z -
          item.object.rotation.z
        ) * 0.30

      item.object.scale.lerp(
        new THREE.Vector3(
          1.045,
          1.045,
          1.045
        ),
        0.24
      )
    }
  }
}

export function setupRackDragging(
  socket,
  setMessage = () => {},
  meldBoard = null
) {
  const raycaster = new THREE.Raycaster()
  const pointer = new THREE.Vector2()

  const press = {
    tileId: null,
    pointerId: null,
    startX: 0,
    startY: 0,
  }

  function clearPress() {
    press.tileId = null
    press.pointerId = null
    press.startX = 0
    press.startY = 0
  }

  function clearRackJokerClick() {
    lastRackJokerClick = null
  }

  function isSecondRackJokerClick(tileId, event) {
    const previous = lastRackJokerClick
    if (!previous || previous.tileId !== tileId) return false

    const elapsed = performance.now() - previous.at
    const distance = Math.hypot(
      event.clientX - previous.x,
      event.clientY - previous.y
    )

    return (
      elapsed >= 0 &&
      elapsed <= JOKER_DOUBLE_CLICK_MS &&
      distance <= JOKER_DOUBLE_CLICK_MAX_DISTANCE
    )
  }

  function rememberRackJokerClick(tileId, event) {
    const tileData = tileId ? getHandMap().get(tileId) : null

    if (!tileId || !isRealJoker(tileData)) {
      clearRackJokerClick()
      return
    }

    lastRackJokerClick = {
      tileId,
      at: performance.now(),
      x: event.clientX,
      y: event.clientY,
    }
  }

  function toggleRackJokerFlip(tileId) {
    if (flippedRackJokerIds.has(tileId)) {
      flippedRackJokerIds.delete(tileId)
    }
    else {
      flippedRackJokerIds.add(tileId)
    }
  }

  function setActiveDragObjectsVisible(visible) {
    if (!activeDrag) return

    for (const item of activeDrag.items) {
      if (!item.object) {
        item.object = ownTilesGroup.children.find(
          child => child.userData?.tileId === item.id
        )
      }

      if (item.object) {
        item.object.visible = visible
      }
    }
  }

  function cancelCurrentInteraction() {
    meldBoard?.cancelRackGroupDrag?.()
    meldBoard?.cancelSingleLayoffDrag?.()
    resetDragState()
    clearPress()
    renderOwnHand()
  }

  function discardStickyStockTile() {
    if (
      !state.isStickyPickup ||
      state.stickyPickupSource !== 'stock' ||
      !state.stickyPickupTileId ||
      !stickyStockDiscardReady
    ) {
      return false
    }

    const tileId = state.stickyPickupTileId

    // Görsel sticky modunu hemen kapat; authoritative karar yine server'ın
    // mevcut discard validator'ından geçer. Reddedilirse hand-state içindeki
    // taş yeniden rack'e çizilir.
    cancelStickyPickupVisual({ render: false })
    setMessage('Çekilen taş doğrudan atılıyor…')

    socket?.emit?.(
      'discard',
      tileId,
      result => {
        if (!result?.ok) {
          setMessage(result?.message || 'Taş atılamadı.')
          syncRackRows()
          renderOwnHand()
          return
        }

        setMessage('Çekilen taş doğrudan atıldı.')
      }
    )

    return true
  }

  renderer.domElement.addEventListener(
    'pointerdown',
    event => {
      if (event.button !== 0) return

      state.pointerClientX = event.clientX
      state.pointerClientY = event.clientY

      // Masadan alınmış taş mouse'a yapışıkken click'in tek görevi
      // normalde taşı ıstakaya bırakmaktır. Stock'tan çekilmiş taş sağdaki
      // discard alanındaysa ıstakaya uğramadan direkt atılabilir.
      if (state.isStickyPickup && state.stickyPickupTileId) {
        event.preventDefault()
        event.stopImmediatePropagation()

        const localPoint = getRackLocalPointFromClient(
          event.clientX,
          event.clientY
        )

        if (
          state.stickyPickupSource === 'stock' &&
          localPoint?.x >= DISCARD_TRIGGER_X
        ) {
          moveStickyPickup(localPoint)
          discardStickyStockTile()
          return
        }

        if (!isRackPlacementPoint(localPoint)) {
          setMessage('Taşı bırakmak için ıstakanın üzerine tıkla.')
          return
        }

        moveStickyPickup(localPoint)

        if (commitStickyPickup(localPoint)) {
          setMessage(
            state.returnableDiscardTileId
              ? 'Taş ıstakaya yerleştirildi. Sarı çerçeveli taşı geldiği atık kulesine sürükleyip bırakarak geri koyabilirsin.'
              : 'Taş ıstakaya yerleştirildi.'
          )
        } else {
          setMessage('Buraya sığmıyor; başka bir yere tıkla.')
        }

        return
      }

      updatePointer(event, pointer)
      raycaster.setFromCamera(pointer, camera)

      const hits = raycaster.intersectObjects(
        ownTilesGroup.children,
        true
      )

      const pickHit = getPrecisePickHit(hits)
      if (!pickHit) return

      const tileId = findTileIdFromObject(pickHit.object)
      if (!tileId) return
      if (!findTileLocation(tileId)) return

      const tileData = getHandMap().get(tileId)
      if (isRealJoker(tileData) && isSecondRackJokerClick(tileId, event)) {
        event.preventDefault()
        event.stopImmediatePropagation()

        // İkinci rahat tıkta yeni bir drag başlatmadan anında çevir. İlk tık
        // normal click olarak kalır; gerçek sürükleme yapılmışsa tracker zaten
        // pointer-up'ta temizlendiği için yanlışlıkla flip oluşmaz.
        clearRackJokerClick()
        meldBoard?.cancelRackGroupDrag?.()
        meldBoard?.cancelSingleLayoffDrag?.()
        resetDragState()
        clearPress()
        toggleRackJokerFlip(tileId)
        renderOwnHand()
        return
      }

      meldBoard?.cancelRackGroupDrag?.()
      meldBoard?.cancelSingleLayoffDrag?.()

      // Çift-tık flip yukarıda erken yakalanmadıysa bu pointerdown normal
      // yeni bir tutuş/drag başlatır; eski seçim state'i taşınmaz.
      resetDragState()

      press.tileId = tileId
      press.pointerId = event.pointerId
      press.startX = event.clientX
      press.startY = event.clientY

      renderer.domElement.setPointerCapture(event.pointerId)

      // Taş etkileşimi iki yatay bölgeye ayrılır:
      // - Üst yarı: her zaman yalnızca basılan taşı tutar.
      // - Alt yarı: basılan taş geçerli per/çift içindeyse tüm grubu tutar.
      //             Geçerli grup yoksa mevcut davranış korunur ve tek taşı tutar.
      // Görsel yarım-küre aynı kalır; sadece per yakalama hit alanı büyümüştür.
      if (isLowerHalfPick(pickHit, tileId)) {
        const meld = findMeldContainingTile(tileId)

        if (meld) {
          beginActiveDrag(
            'meld',
            meld.tileIds,
            tileId
          )

          // Önizleme ancak mouse hareket edince gösterilecek.
          return
        }
      }

      // Üst yarı veya alt yarıda geçerli per/çift yok: yalnızca o taş tutulur.
      beginActiveDrag(
        'single',
        [tileId],
        tileId
      )
    }
  )

  renderer.domElement.addEventListener(
    'pointermove',
    event => {
      state.pointerClientX = event.clientX
      state.pointerClientY = event.clientY

      // Sticky pickup mouse düğmesinden bağımsızdır: kaynak taşa bir kez
      // tıkladıktan sonra pointer yalnız hareket ederek taşı taşır.
      if (state.isStickyPickup && state.stickyPickupTileId) {
        const localPoint = getRackLocalPointFromClient(
          event.clientX,
          event.clientY
        )

        if (localPoint) {
          moveStickyPickup(localPoint)
        }

        return
      }

      if (!activeDrag) return
      if (press.pointerId !== event.pointerId) return

      const movement = Math.hypot(
        event.clientX - press.startX,
        event.clientY - press.startY
      )

      // Çok küçük el titremelerini drop olarak sayma.
      if (movement > POINTER_MOVE_EPSILON) {
        activeDrag.hasMoved = true
        clearRackJokerClick()
      }

      updatePointer(event, pointer)
      raycaster.setFromCamera(pointer, camera)

      // Per / gerçek çift sürüklenirken mouse üst kamera alanına çıkabilir.
      // Kamera masaya yükseldikten sonra board slotu hedefleniyorsa rack
      // çözücüsü devreden çıkar; gerçek taşları saklayıp masadaki snap
      // önizlemesini gösteririz. Böylece per, kamera hareket ederken rack'e
      // geri çekilmez.
      const canTargetOpenBoard =
        activeDrag.mode === 'meld' &&
        activeDrag.items.length >= 2

      const canTargetLayoffBoard =
        activeDrag.mode === 'single' &&
        activeDrag.items.length === 1 &&
        Boolean(
          state.privateHandState?.opened ||
          state.privateHandState?.openingDraftReady
        )

      const boardDragResult = canTargetOpenBoard
        ? meldBoard?.updateRackGroupDrag?.({
            tileIds: activeDrag.items.map(item => item.id),
            clientX: event.clientX,
            clientY: event.clientY,
          })
        : canTargetLayoffBoard
          ? meldBoard?.updateSingleLayoffDrag?.({
              tileId: activeDrag.items[0].id,
              clientX: event.clientX,
              clientY: event.clientY,
            })
          : null

      // v48: board controller iki bilgiyi ayrı döndürür.
      // captured = üst kamera masasında per için ghost kontrolü devraldı.
      // ready    = ghost gerçekten boş açma slotlarına snap oldu.
      // Eski boolean controller ile de uyumluluğu koruyoruz.
      const openBoardCaptured =
        typeof boardDragResult === 'object' && boardDragResult !== null
          ? Boolean(boardDragResult.captured)
          : Boolean(boardDragResult)

      const openBoardReady =
        typeof boardDragResult === 'object' && boardDragResult !== null
          ? Boolean(boardDragResult.ready)
          : Boolean(boardDragResult)

      activeDrag.openBoardReady = openBoardReady
      activeDrag.openBoardCaptured = openBoardCaptured

      if (openBoardCaptured) {
        activeDrag.discardReady = false
        clearDropPreview()
        discardGuideTargetOpacity = 0
        setActiveDragObjectsVisible(false)
        return
      }

      if (activeDrag.mode === 'meld') {
        meldBoard?.cancelRackGroupDrag?.()
        meldBoard?.cancelSingleLayoffDrag?.()
      } else {
        meldBoard?.cancelSingleLayoffDrag?.()
      }

      setActiveDragObjectsVisible(true)

      // Geometri sınırına takılmak yerine rack'in sonsuz düzlemini kullan.
      // Böylece sağdaki atma alanına sürükleme ve geniş masada hareket daha
      // akıcı kalır.
      const localPoint = getRackLocalPointFromClient(
        event.clientX,
        event.clientY
      )

      if (!localPoint) return

      // Yandan alınmış taş kendi kaynak atık kulesinin geri-bırakma
      // alanına girdiği anda rack çözücüsü taşı kontrol etmeyi bırakır.
      // Table-actions capture pointermove daha önce çalışıp bu flag'i set eder.
      // Böylece bir frame rack'e, bir frame kuleye çekilme (dur-başla) olmaz.
      if (
        state.returnDiscardDropReady &&
        isDraggingReturnableDiscardTile()
      ) {
        activeDrag.discardReady = false
        clearDropPreview()
        discardGuideTargetOpacity = 0
        return
      }

      // Mouse basılı olduğu sürece taş / per mouse'u takip eder.
      moveActiveDrag(localPoint)
    }
  )

  function finishPointer(event, cancelled = false) {
    // Stock'tan çekilen sticky taş sağdaki atma alanına sürüklenmişse
    // pointer-up ile doğrudan discard edilir. Yandan alınan taşta eski
    // davranış korunur: pointer-up bırakmaz, kullan veya kaynağına geri koy.
    if (state.isStickyPickup && state.stickyPickupTileId) {
      if (
        !cancelled &&
        state.stickyPickupSource === 'stock' &&
        stickyStockDiscardReady &&
        discardStickyStockTile()
      ) {
        clearPress()
        return
      }

      clearPress()
      return
    }

    if (!activeDrag) {
      clearPress()
      return
    }

    if (
      press.pointerId !== null &&
      event.pointerId !== press.pointerId
    ) {
      return
    }

    if (cancelled) {
      clearRackJokerClick()
      cancelCurrentInteraction()
      return
    }

    const releaseMovement = Math.hypot(
      event.clientX - press.startX,
      event.clientY - press.startY
    )
    const pressedTileData = press.tileId
      ? getHandMap().get(press.tileId)
      : null

    if (
      isRealJoker(pressedTileData) &&
      releaseMovement <= JOKER_CLICK_MOVE_TOLERANCE
    ) {
      // Çift tık sırasında 1-2 px doğal el/fare oynaması rack drag'i
      // commit etmesin. Gerçek okey için küçük hareketi click sayıp taşı
      // eski güvenli yerine bırakıyoruz; daha belirgin hareket normal drag'dir.
      meldBoard?.cancelRackGroupDrag?.()
      meldBoard?.cancelSingleLayoffDrag?.()
      setActiveDragObjectsVisible(true)
      rememberRackJokerClick(press.tileId, event)
      resetDragState()
      clearPress()
      renderOwnHand()
      return
    }

    // Masa üstündeki 13x6 açma slotlarından biri hedeflenmişse per/çift
    // rack'e geri bırakılmaz; hazırlık alanına taşınır. Sunucuya gönderme
    // AÇ düğmesine basınca toplu yapılır.
    if (activeDrag.mode === 'meld') {
      const tileIds = activeDrag.items.map(item => item.id)

      // Kamera pointer'ın son hareketinden sonra da yükselmeye devam edebilir.
      // Controller mouse-up anında son slot hedefini tekrar hesapladığı için
      // yalnız eski openBoardReady flag'ine güvenmiyoruz.
      if (meldBoard?.commitRackGroupDrag?.(tileIds)) {
        resetDragState()
        clearPress()
        renderOwnHand()
        return
      }
    }

    // Elini açmış oyuncu tek taşı üst kamerada doğrudan mevcut bir pere
    // bırakabilir. Başarılı hedefte rack'e geri snap etmek yerine server'ın
    // layoff event'ine bırakıyoruz; sonuç hand-state ile kesinleşir.
    if (
      activeDrag.mode === 'single' &&
      activeDrag.items.length === 1
    ) {
      const tileId = activeDrag.items[0].id

      if (meldBoard?.commitSingleLayoffDrag?.(tileId)) {
        setActiveDragObjectsVisible(false)
        resetDragState()
        clearPress()
        return
      }
    }

    meldBoard?.cancelRackGroupDrag?.()
    meldBoard?.cancelSingleLayoffDrag?.()
    setActiveDragObjectsVisible(true)

    // Sağdaki atma alanındaysa tek taş doğrudan atılır.
    if (
      activeDrag.discardReady &&
      activeDrag.mode === 'single' &&
      activeDrag.items.length === 1
    ) {
      const tileId = activeDrag.items[0].id

      clearDropPreview()
      discardGuideTargetOpacity = 0
      activeDrag = null

      state.isDraggingTile = false
      state.dragStarted = false
      state.draggedTileId = null
      state.draggedObject = null
      state.draggedSourceRow = null

      clearPress()

      setMessage('Taş atılıyor…')

      socket?.emit?.(
        'discard',
        tileId,
        result => {
          if (!result?.ok) {
            setMessage(
              result?.message ||
              'Taş atılamadı.'
            )

            renderOwnHand()
            return
          }

          setMessage('Taş atıldı.')
        }
      )

      return
    }

    // Mouse hareket etmediyse yalnızca aynı yerde tutulup bırakılmıştır.
    // Seçim oluşmaz, taş yükselmez, ikinci tık gerekmez.
    if (!activeDrag.hasMoved) {
      rememberRackJokerClick(press.tileId, event)
      resetDragState()
      clearPress()
      renderOwnHand()
      return
    }

    // Mouse bırakıldığı anda rack drop tek seferde tamamlanır.
    // Geçersiz / sığmayan yerde state değiştirilmez ve render eski güvenli
    // konuma geri döndürür.
    commitActiveDrag()

    resetDragState()
    clearPress()
    renderOwnHand()
  }

  renderer.domElement.addEventListener(
    'pointerup',
    event => finishPointer(event, false)
  )

  renderer.domElement.addEventListener(
    'pointercancel',
    event => finishPointer(event, true)
  )

  // Pointer pencere dışında bırakılırsa takılı kalmasın.
  window.addEventListener(
    'blur',
    () => {
      clearRackJokerClick()
      if (!activeDrag) return
      cancelCurrentInteraction()
    }
  )
}
