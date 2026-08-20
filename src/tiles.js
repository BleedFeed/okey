import * as THREE from 'three'
import {
  TILE_WIDTH,
  TILE_HEIGHT,
  TILE_DEPTH,
  colorToHex,
} from './config.js'

// =====================================================
// TILE APPEARANCE
// =====================================================
//
// Taş gövdesi tamamen kapalıdır.
// Ön yüzde konkav yarım-küre hissi veren küçük bir oyuk vardır.
// Arka yüz tamamen düz, opak ve beyazdır.
//
// Önemli:
// Ön yüzde artık texture'dan gerçek bir delik kesmiyoruz.
// Böylece arka yüzün "cam / saydam" görünmesi mümkün olmaz.
//

const DIMPLE_RADIUS = 0.041
const DIMPLE_CENTER_Y = -TILE_HEIGHT / 2 + 0.068

const TILE_FACE_WIDTH = 0.194
const TILE_FACE_HEIGHT = 0.304

const TILE_FRONT_Z = TILE_DEPTH / 2 + 0.006
const TILE_BACK_Z = -TILE_DEPTH / 2 - 0.004

function markShared(resource) {
  resource.userData = {
    ...(resource.userData || {}),
    sharedResource: true,
  }

  return resource
}

// =====================================================
// CLOSED TILE BODY
// =====================================================
//
// Gövdenin hem önü hem arkası kapalıdır.
// Ön yüzdeki oyuk, depth-test yapan ayrı bir decal mesh olarak çizilir.
//

function createClosedTileGeometry() {
  const halfW = TILE_WIDTH / 2
  const halfH = TILE_HEIGHT / 2

  const shape = new THREE.Shape()

  shape.moveTo(-halfW, -halfH)
  shape.lineTo(halfW, -halfH)
  shape.lineTo(halfW, halfH)
  shape.lineTo(-halfW, halfH)
  shape.closePath()

  const geometry = new THREE.ExtrudeGeometry(
    shape,
    {
      depth: TILE_DEPTH,
      bevelEnabled: true,
      bevelSegments: 2,
      bevelSize: 0.0035,
      bevelThickness: 0.003,
      curveSegments: 8,
    }
  )

  geometry.translate(
    0,
    0,
    -TILE_DEPTH / 2
  )

  geometry.computeVertexNormals()
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()

  return markShared(geometry)
}

const TILE_BODY_GEOMETRY =
  createClosedTileGeometry()

const TILE_FACE_GEOMETRY =
  markShared(
    new THREE.PlaneGeometry(
      TILE_FACE_WIDTH,
      TILE_FACE_HEIGHT
    )
  )

// Arka yüz gövdeye mümkün olduğunca tam oturur.
// Bevel nedeniyle kenarlardan çok az içeri alınmıştır.
const TILE_BACK_GEOMETRY =
  markShared(
    new THREE.PlaneGeometry(
      TILE_WIDTH - 0.008,
      TILE_HEIGHT - 0.008
    )
  )

// =====================================================
// DIMPLE RECESS DECAL
// =====================================================
//
// Eski sürümde yarım küre depthTest:false ile zorla en öne çiziliyordu.
// Bu nedenle taş başka bir objenin arkasında olsa bile oyuk görünmeye devam
// edebiliyordu. Yeni dimple taş yüzüne oturan, derinlik testi yapan küçük bir
// konkav decal. Yarım-küre hissi texture içindeki ışık/gölge ile korunur ama
// artık sahnedeki gerçek depth buffer'a saygı gösterir.

const DIMPLE_RECESS_GEOMETRY =
  markShared(
    new THREE.CircleGeometry(
      DIMPLE_RADIUS,
      48
    )
  )

function createDimpleTexture() {
  const canvas = document.createElement('canvas')
  canvas.width = 128
  canvas.height = 128

  const ctx = canvas.getContext('2d')

  const base = ctx.createRadialGradient(
    48,
    43,
    7,
    64,
    64,
    62
  )

  base.addColorStop(0.00, '#aaa296')
  base.addColorStop(0.45, '#bbb3a7')
  base.addColorStop(0.73, '#d5cec2')
  base.addColorStop(0.90, '#9c9489')
  base.addColorStop(1.00, '#777168')

  ctx.fillStyle = base
  ctx.fillRect(0, 0, 128, 128)

  // İçbükeylik hissi için üst-sol iç ışık ve alt-sağ gölge.
  const light = ctx.createRadialGradient(
    43,
    36,
    0,
    43,
    36,
    48
  )
  light.addColorStop(0, 'rgba(255,255,255,0.34)')
  light.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = light
  ctx.fillRect(0, 0, 128, 128)

  const shadow = ctx.createRadialGradient(
    83,
    88,
    2,
    79,
    82,
    52
  )
  shadow.addColorStop(0, 'rgba(55,48,42,0.32)')
  shadow.addColorStop(1, 'rgba(55,48,42,0)')
  ctx.fillStyle = shadow
  ctx.fillRect(0, 0, 128, 128)

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.needsUpdate = true

  return markShared(texture)
}

const DIMPLE_TEXTURE = createDimpleTexture()

const MELD_HANDLE_GEOMETRY =
  markShared(
    new THREE.CircleGeometry(
      DIMPLE_RADIUS * 0.90,
      32
    )
  )

const TILE_HITBOX_GEOMETRY =
  markShared(
    new THREE.PlaneGeometry(
      TILE_WIDTH + 0.006,
      TILE_HEIGHT + 0.006
    )
  )

// =====================================================
// MATERIALS
// =====================================================

const TILE_BODY_MATERIAL =
  new THREE.MeshStandardMaterial({
    color: 0xf0eadc,
    roughness: 0.32,
    metalness: 0,
  })

TILE_BODY_MATERIAL.userData.sharedResource = true

const TILE_BACK_MATERIAL =
  new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.44,
    metalness: 0,
    transparent: false,
    side: THREE.FrontSide,
  })

TILE_BACK_MATERIAL.userData.sharedResource = true

const DIMPLE_RECESS_MATERIAL =
  new THREE.MeshBasicMaterial({
    map: DIMPLE_TEXTURE,
    transparent: false,
    depthTest: true,
    depthWrite: true,
    side: THREE.FrontSide,
    polygonOffset: true,
    polygonOffsetFactor: -4,
    polygonOffsetUnits: -4,
  })

DIMPLE_RECESS_MATERIAL.userData.sharedResource = true

const MELD_HANDLE_MATERIAL =
  new THREE.MeshBasicMaterial({
    transparent: true,
    opacity: 0,
    depthWrite: false,
    depthTest: false,
    side: THREE.DoubleSide,
  })

MELD_HANDLE_MATERIAL.userData.sharedResource = true

const TILE_HITBOX_MATERIAL =
  new THREE.MeshBasicMaterial({
    transparent: true,
    opacity: 0,
    depthWrite: false,
    depthTest: false,
    side: THREE.DoubleSide,
  })

TILE_HITBOX_MATERIAL.userData.sharedResource = true

// =====================================================
// TILE FACE TEXTURE
// =====================================================

function createTileFaceTexture(tileData) {
  const canvas =
    document.createElement('canvas')

  canvas.width = 256
  canvas.height = 360

  const ctx =
    canvas.getContext('2d')

  // Ön yüz tamamen opak.
  ctx.fillStyle = '#f0eadc'

  ctx.fillRect(
    0,
    0,
    canvas.width,
    canvas.height
  )

  if (
    tileData.type ===
    'fake-joker'
  ) {
    ctx.fillStyle = '#c0392b'
    ctx.font = 'bold 118px Arial'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'

    ctx.fillText(
      '★',
      128,
      136
    )

    ctx.font = 'bold 31px Arial'

    ctx.fillText(
      'SAHTE',
      128,
      238
    )
  } else {
    ctx.fillStyle =
      colorToHex(
        tileData.color
      )

    ctx.font = 'bold 154px Arial'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'

    ctx.fillText(
      String(tileData.number),
      128,
      144
    )

    // Eski küçük renkli nokta kaldırıldı.
    // Bu nokta yarım-küre oyuğunun üstünde kırmızı/mavi/siyah/sarı
    // bir yay parçası gibi görünüyordu.
  }

  const texture =
    new THREE.CanvasTexture(
      canvas
    )

  texture.colorSpace =
    THREE.SRGBColorSpace

  texture.needsUpdate = true

  return texture
}

// =====================================================
// BODY / BACK
// =====================================================

function addBodyAndBack(group) {
  const body =
    new THREE.Mesh(
      TILE_BODY_GEOMETRY,
      TILE_BODY_MATERIAL
    )

  body.castShadow = true
  body.receiveShadow = true

  group.add(body)

  // ---------------------------------------------------
  // FULL OPAQUE WHITE BACK
  // ---------------------------------------------------
  //
  // Arka taraf ayrı ve opak beyaz bir kapaktır.
  // Burada dimple / delik / transparency yoktur.
  //

  const back =
    new THREE.Mesh(
      TILE_BACK_GEOMETRY,
      TILE_BACK_MATERIAL
    )

  back.position.set(
    0,
    0,
    TILE_BACK_Z
  )

  // Plane'in ön tarafını -Z yönüne çeviriyoruz.
  back.rotation.y = Math.PI

  back.renderOrder = 5

  group.add(back)

  return body
}

// =====================================================
// DIMPLE / MELD HANDLE
// =====================================================

function addDimple(
  group,
  tileId = null
) {
  const recess =
    new THREE.Mesh(
      DIMPLE_RECESS_GEOMETRY,
      DIMPLE_RECESS_MATERIAL
    )

  // Sayı yüzünden yalnızca birkaç mikron önde: z-fighting yapmaz ama
  // başka taşların arkasından da asla sızmaz çünkü depthTest açıktır.
  recess.position.set(
    0,
    DIMPLE_CENTER_Y,
    TILE_FRONT_Z + 0.0025
  )

  recess.renderOrder = 12

  group.add(recess)

  if (!tileId) {
    return
  }

  // Görünen dairenin içinde per tutma hitbox'ı.
  const meldHandle =
    new THREE.Mesh(
      MELD_HANDLE_GEOMETRY,
      MELD_HANDLE_MATERIAL
    )

  meldHandle.position.set(
    0,
    DIMPLE_CENTER_Y,
    TILE_FRONT_Z + 0.012
  )

  meldHandle.userData.tileId =
    tileId

  meldHandle.userData.meldHandle =
    true

  meldHandle.renderOrder = 100

  group.add(meldHandle)
}

// =====================================================
// VISIBLE TILE
// =====================================================

export function createTile(tileData) {
  const group =
    new THREE.Group()

  group.userData.tileId =
    tileData.id

  group.userData.tileData =
    tileData

  const body =
    addBodyAndBack(group)

  body.userData.tileId =
    tileData.id

  // ---------------------------------------------------
  // NUMBER FACE
  // ---------------------------------------------------

  const texture =
    createTileFaceTexture(
      tileData
    )

  const faceMaterial =
    new THREE.MeshBasicMaterial({
      map: texture,
      transparent: false,
      depthWrite: true,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    })

  const face =
    new THREE.Mesh(
      TILE_FACE_GEOMETRY,
      faceMaterial
    )

  face.position.set(
    0,
    0.010,
    TILE_FRONT_Z
  )

  face.userData.tileId =
    tileData.id

  face.renderOrder = 10

  group.add(face)

  // Çanak face'ten sonra eklenir ve onun üstünde görünür.
  addDimple(
    group,
    tileData.id
  )

  // ---------------------------------------------------
  // NORMAL TILE HITBOX
  // ---------------------------------------------------

  const tileHitbox =
    new THREE.Mesh(
      TILE_HITBOX_GEOMETRY,
      TILE_HITBOX_MATERIAL
    )

  tileHitbox.position.set(
    0,
    0,
    TILE_FRONT_Z + 0.008
  )

  tileHitbox.userData.tileId =
    tileData.id

  tileHitbox.userData.tileHitbox =
    true

  tileHitbox.renderOrder = 90

  group.add(tileHitbox)

  return group
}

// =====================================================
// HIDDEN / BACK-FACING TILE
// =====================================================
//
// Rakibin taşında bizim gördüğümüz taraf tamamen düz beyazdır.
// Ön yüzdeki yarım küre yalnız createTile() içinde eklenir.
// Burada dimple kesinlikle yoktur.
//

export function createHiddenTile() {
  const group =
    new THREE.Group()

  addBodyAndBack(group)

  return group
}

// =====================================================
// DISPOSE
// =====================================================

function disposeMaterial(material) {
  if (!material) return

  if (
    material.userData
      ?.sharedResource
  ) {
    return
  }

  if (
    material.map
  ) {
    material.map.dispose()
  }

  material.dispose()
}

function disposeObject(object) {
  if (!object) return

  if (
    object.geometry &&
    !object.geometry.userData
      ?.sharedResource
  ) {
    object.geometry.dispose()
  }

  if (
    Array.isArray(
      object.material
    )
  ) {
    object.material.forEach(
      disposeMaterial
    )
  } else {
    disposeMaterial(
      object.material
    )
  }
}

export function clearGroup(group) {
  while (
    group.children.length > 0
  ) {
    const child =
      group.children.pop()

    child.traverse(
      disposeObject
    )
  }
}
