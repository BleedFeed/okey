export const TABLE_W = 7.6
export const TABLE_D = 7.6

export const TILE_WIDTH = 0.22
export const TILE_HEIGHT = 0.34
export const TILE_DEPTH = 0.065
export const TILE_FACE_Z = TILE_DEPTH / 2 + 0.001
export const NORMAL_TILE_GAP = 0.018
export const GROUP_GAP = 0.16
// =====================================================
// ISTAKA GENISLIK AYARLARI
// =====================================================
// Taslarin gercekte saga/sola hareket edebildigi toplam alan.
// Bu degeri buyutursen iki duvar da esit miktarda disa gider.
export const RACK_USABLE_WIDTH = 3.55

// 3D istaka modelinin sahnede gorunecek toplam genisligi.
// GLB/STL hangi kaynak kullanilirsa kullanilsin model X ekseninde bu genislige
// otomatik olceklenir. Modelin fiziksel kenarlari tas alanindan biraz genis
// olsun istiyorsan bunu RACK_USABLE_WIDTH'ten buyuk tut.
export const RACK_MODEL_TARGET_WIDTH = 3.85

// Yeni Blender modeli hazir oldugunda dosyayi
// client/public/models/rack.glb olarak koyup bu yolu aktif et.
// Dosya henuz yoksa yukleme basarisiz olur ve mevcut STL otomatik fallback olarak kullanilir.
// GLB'yi gecici kapatmak istersen bos string yapabilirsin.
export const RACK_MODEL_GLTF_URL = '/models/rack.glb'

// Modelin rack-local ince ayarlari. Genislikten bagimsizdir.
export const RACK_MODEL_Y_OFFSET = 0.00
export const RACK_MODEL_Z_OFFSET = 0.00

export const MAX_ROW_TILES = 11
export const RACK_LEFT_LIMIT = -RACK_USABLE_WIDTH / 2 + TILE_WIDTH / 2
export const RACK_RIGHT_LIMIT = RACK_USABLE_WIDTH / 2 - TILE_WIDTH / 2

// =====================================================
// DISCARD STACK
// =====================================================
// Her oyuncunun ıstakasının sağında TEK bir atık kulesi vardır.
// Taşlar yan yana dizilmez; aynı X/Z noktasında üst üste gelir.
// Drag önizlemesi ve gerçek atık modeli aynı helper'ı kullandığı için
// bırakılan taş sonradan başka bir konuma sıçramaz.

// Atık kulesi atan oyuncunun hemen yanında değil, taşı alan sağ oyuncunun
// bakış açısından ıstakanın biraz SOLUNDA ve biraz ÖNÜNDE (masa merkezine doğru)
// durur. Bu değerler atan oyuncunun rack-local koordinatındadır; aynı dönüşüm
// dört koltukta da simetrik olarak uygulanır.
export const DISCARD_STACK_X = 2.90
export const DISCARD_STACK_Z = -0.50
export const DISCARD_STACK_BASE_Y = 0.020
export const DISCARD_STACK_STEP_Y = 0.024

// Taş sağdaki oyuncu tarafından okunacak şekilde düz yatarken 90° döner.
// Discard root zaten atan oyuncunun rack koordinat sistemindedir; bu yüzden
// her koltukta aynı local Z dönüşü doğru oyuncuya bakar.
export const DISCARD_TILE_ROTATION_Z = Math.PI / 2

// Sadece tek kuleyi çevreleyen küçük, anlaşılır bir atma alanı.
export const DISCARD_ZONE_WIDTH = TILE_HEIGHT + 0.18
export const DISCARD_ZONE_DEPTH = TILE_WIDTH + 0.18
export const DISCARD_ZONE_CENTER_X = DISCARD_STACK_X
export const DISCARD_ZONE_CENTER_Z = DISCARD_STACK_Z

export function getDiscardSlotLocalPosition(discardIndex = 0) {
  const safeIndex = Math.max(0, Math.floor(discardIndex))

  return {
    x: DISCARD_STACK_X,
    y: DISCARD_STACK_BASE_Y + safeIndex * DISCARD_STACK_STEP_Y,
    z: DISCARD_STACK_Z,
    layer: safeIndex,
  }
}

export function colorToHex(color) {
  switch (color) {
    case 'red': return '#d62929'
    case 'blue': return '#1769c2'
    case 'black': return '#171717'
    case 'yellow': return '#d99a15'
    default: return '#333333'
  }
}
