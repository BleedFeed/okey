import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'
import {
  TABLE_W,
  TABLE_D,
  RACK_MODEL_TARGET_WIDTH,
  RACK_MODEL_GLTF_URL,
  RACK_MODEL_Y_OFFSET,
  RACK_MODEL_Z_OFFSET,
} from './config.js'
import { getRendererPixelRatio, isTouchLayout } from './mobile.js'

export const scene = new THREE.Scene()
scene.background = new THREE.Color(0x171513)

export const camera = new THREE.PerspectiveCamera(
  55,
  window.innerWidth / window.innerHeight,
  0.1,
  100
)
camera.rotation.order = 'YXZ'

// Sabit oturma kamerası: biraz daha yukarıdan ve geriden,
// ıstakayı ve masa merkezini aynı anda rahat gösterecek açı.
export const FIXED_CAMERA_PITCH = -0.43

camera.rotation.x = FIXED_CAMERA_PITCH

const CAMERA_HEIGHT = 4.15
const CAMERA_DISTANCE = 6.55

export const seatCameraSettings = {
  'player-bottom': {
    position: new THREE.Vector3(0, CAMERA_HEIGHT, CAMERA_DISTANCE),
    yaw: 0,
  },
  'player-top': {
    position: new THREE.Vector3(0, CAMERA_HEIGHT, -CAMERA_DISTANCE),
    yaw: Math.PI,
  },
  'player-left': {
    position: new THREE.Vector3(-CAMERA_DISTANCE, CAMERA_HEIGHT, 0),
    yaw: -Math.PI / 2,
  },
  'player-right': {
    position: new THREE.Vector3(CAMERA_DISTANCE, CAMERA_HEIGHT, 0),
    yaw: Math.PI / 2,
  },
}

// Masaüstü kamera değerleri değişmeden kalır. Yalnız coarse-pointer telefon/
// tablet görünümünde portrait ekranın dar yatay FOV'u için kamera biraz geriye
// alınır; böylece ıstakanın iki ucu ve sağ discard alanı kadrajdan çıkmaz.
function updateResponsiveSeatCameraSettings() {
  let distance = CAMERA_DISTANCE
  let height = CAMERA_HEIGHT

  if (isTouchLayout()) {
    const aspect = window.innerWidth / Math.max(window.innerHeight, 1)

    if (aspect < 0.62) {
      distance = 8.35
      height = 4.55
    }
    else if (aspect < 0.82) {
      distance = 7.65
      height = 4.36
    }
    else if (aspect < 1.05) {
      distance = 7.05
      height = 4.24
    }
    else {
      // Landscape telefonda masaüstüne çok yakın kadraj korunur.
      distance = 6.72
      height = CAMERA_HEIGHT
    }
  }

  seatCameraSettings['player-bottom'].position.set(0, height, distance)
  seatCameraSettings['player-top'].position.set(0, height, -distance)
  seatCameraSettings['player-left'].position.set(-distance, height, 0)
  seatCameraSettings['player-right'].position.set(distance, height, 0)
}

updateResponsiveSeatCameraSettings()

export const renderer = new THREE.WebGLRenderer({ antialias: true })
renderer.setSize(window.innerWidth, window.innerHeight)
renderer.setPixelRatio(getRendererPixelRatio())
renderer.shadowMap.enabled = true
renderer.shadowMap.type = THREE.PCFShadowMap
// Cay seviyesi, liquid mesh'i world-horizontal clipping plane ile keser.
renderer.localClippingEnabled = true
document.body.appendChild(renderer.domElement)

// Yalnizca bardak/cay PBR materyallerinde kullanilan hafif oda yansimasi.
// Scene.environment degistirilmez; masa ve diger materyaller bundan etkilenmez.
const teaPmremGenerator = new THREE.PMREMGenerator(renderer)
const teaRoomEnvironment = new RoomEnvironment()
const TEA_ENV_MAP = teaPmremGenerator.fromScene(teaRoomEnvironment, 0.04).texture
teaRoomEnvironment.dispose()
teaPmremGenerator.dispose()

// Temiz cam tamamen kusursuz bir ayna gibi görünmez. Çok hafif üretim
// izleri / mikro çizikler, parlak yansımaları kırarak gerçek cam hissini artırır.
// Dış texture asset'i gerektirmemek için deterministik bir non-color texture
// üretiyoruz; roughnessMap + bumpMap olarak çok düşük şiddette kullanılır.
function createTeaMicroSurfaceTexture(size = 128) {
  const data = new Uint8Array(size * size * 4)
  let seed = 0x6d2b79f5

  const random = () => {
    seed ^= seed << 13
    seed ^= seed >>> 17
    seed ^= seed << 5
    return (seed >>> 0) / 4294967295
  }

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const index = (y * size + x) * 4
      const fineNoise = random()
      const longScratch = Math.sin((x * 0.31) + (y * 0.047)) * 0.5 + 0.5
      const verticalDraw = Math.sin((x * 0.08) + Math.sin(y * 0.035) * 2.4) * 0.5 + 0.5
      const value = THREE.MathUtils.clamp(
        0.58 + fineNoise * 0.28 + longScratch * 0.08 + verticalDraw * 0.06,
        0,
        1
      )
      const byte = Math.round(value * 255)

      data[index] = byte
      data[index + 1] = byte
      data[index + 2] = byte
      data[index + 3] = 255
    }
  }

  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat)
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.RepeatWrapping
  texture.repeat.set(3.5, 5.0)
  // Procedural micro-surface is tiny and close-range; avoid forcing a
  // mipmap generation pass that can trigger Firefox/WebGL lazy texture init.
  texture.minFilter = THREE.LinearFilter
  texture.magFilter = THREE.LinearFilter
  texture.generateMipmaps = false
  texture.anisotropy = Math.min(renderer.capabilities.getMaxAnisotropy(), 8)
  texture.colorSpace = THREE.NoColorSpace
  texture.needsUpdate = true
  return texture
}

const TEA_GLASS_MICRO_SURFACE_MAP = createTeaMicroSurfaceTexture()

scene.add(new THREE.HemisphereLight(0xfff4df, 0x29231e, 1.8))

const mainLight = new THREE.PointLight(0xffe2bd, 150, 25)
mainLight.position.set(0, 6.2, 1.5)
mainLight.castShadow = true
scene.add(mainLight)

const fillLight = new THREE.PointLight(0xaab8ff, 35, 18)
fillLight.position.set(-5, 3.5, -4)
scene.add(fillLight)

const floor = new THREE.Mesh(
  new THREE.PlaneGeometry(30, 30),
  new THREE.MeshStandardMaterial({ color: 0x241c17, roughness: 0.95 })
)
floor.rotation.x = -Math.PI / 2
floor.receiveShadow = true
scene.add(floor)

const woodMaterial = new THREE.MeshStandardMaterial({
  color: 0x4a2917,
  roughness: 0.65,
})

const darkWoodMaterial = new THREE.MeshStandardMaterial({
  color: 0x2f190d,
  roughness: 0.72,
})

const feltMaterial = new THREE.MeshStandardMaterial({
  color: 0x174b34,
  roughness: 0.88,
})

const tableGroup = new THREE.Group()
scene.add(tableGroup)

const tableBody = new THREE.Mesh(
  new THREE.BoxGeometry(TABLE_W, 0.38, TABLE_D),
  woodMaterial
)
tableBody.position.y = 0.95
tableBody.castShadow = true
tableBody.receiveShadow = true
tableGroup.add(tableBody)

const felt = new THREE.Mesh(
  new THREE.BoxGeometry(TABLE_W - 0.45, 0.08, TABLE_D - 0.45),
  feltMaterial
)
felt.position.y = 1.18
felt.receiveShadow = true
tableGroup.add(felt)

const frontEdge = new THREE.Mesh(
  new THREE.BoxGeometry(TABLE_W, 0.27, 0.20),
  darkWoodMaterial
)
frontEdge.position.set(0, 1.16, TABLE_D / 2)
tableGroup.add(frontEdge)

const backEdge = frontEdge.clone()
backEdge.position.z = -TABLE_D / 2
tableGroup.add(backEdge)

const leftEdge = new THREE.Mesh(
  new THREE.BoxGeometry(0.20, 0.27, TABLE_D),
  darkWoodMaterial
)
leftEdge.position.set(-TABLE_W / 2, 1.16, 0)
tableGroup.add(leftEdge)

const rightEdge = leftEdge.clone()
rightEdge.position.x = TABLE_W / 2
tableGroup.add(rightEdge)

const legGeometry = new THREE.BoxGeometry(0.34, 1.7, 0.34)
const legInsetX = TABLE_W / 2 - 0.55
const legInsetZ = TABLE_D / 2 - 0.55

const legPositions = [
  [-legInsetX, 0.1, -legInsetZ],
  [legInsetX, 0.1, -legInsetZ],
  [-legInsetX, 0.1, legInsetZ],
  [legInsetX, 0.1, legInsetZ],
]

for (const [x, y, z] of legPositions) {
  const leg = new THREE.Mesh(legGeometry, woodMaterial)
  leg.position.set(x, y, z)
  leg.castShadow = true
  tableGroup.add(leg)
}

// =====================================================
// GÖSTERGE TAŞI — İNCE AYAR
// =====================================================
// Gösterge fiziksel olarak bu anchor'a bağlanır. Yerini/rotasyonunu yalnız bu
// değerlerden değiştirebilirsin; table-actions.js koordinat tutmaz.
export const INDICATOR_POSITION_X = -0.62
export const INDICATOR_POSITION_Y = 1.285
export const INDICATOR_POSITION_Z = 0.34
export const INDICATOR_ROTATION_X = -Math.PI / 2
export const INDICATOR_ROTATION_Y = 0
export const INDICATOR_ROTATION_Z = 0
export const INDICATOR_SCALE = 1.00

export const indicatorAnchor = new THREE.Group()
indicatorAnchor.name = 'indicatorAnchor'
indicatorAnchor.position.set(
  INDICATOR_POSITION_X,
  INDICATOR_POSITION_Y,
  INDICATOR_POSITION_Z
)
indicatorAnchor.rotation.set(
  INDICATOR_ROTATION_X,
  INDICATOR_ROTATION_Y,
  INDICATOR_ROTATION_Z
)
scene.add(indicatorAnchor)

export const rackPlaceholders = {}

function createRackPlaceholder(id, position, rotationY) {
  const rack = new THREE.Group()
  rack.name = id
  rack.position.copy(position)
  // Istaka yalnizca masadaki koltugun yonune doner.
  // Ekstra X/Z egimi yok: saga/sola yatma veya roll olusmaz.
  rack.rotation.y = rotationY
  rackPlaceholders[id] = rack
  scene.add(rack)
  return rack
}

const rackBottom = createRackPlaceholder(
  'player-bottom',
  new THREE.Vector3(0, 1.24, 3.18),
  0
)

const rackTop = createRackPlaceholder(
  'player-top',
  new THREE.Vector3(0, 1.24, -3.18),
  Math.PI
)

const rackLeft = createRackPlaceholder(
  'player-left',
  new THREE.Vector3(-3.18, 1.24, 0),
  -Math.PI / 2
)

const rackRight = createRackPlaceholder(
  'player-right',
  new THREE.Vector3(3.18, 1.24, 0),
  Math.PI / 2
)

// Istaka modeli:
// Blender'dan gelen GLB (texture/material dahil) tek istaka kaynagidir.
// Eski STL/assets modeli artik aranmaz ve fallback olarak yuklenmez.
// GLB exportunda modelin uzun ekseni Blender X, derinligi Y, yuksekligi Z olmali.
// Blender glTF exporter bunu Three.js'in Y-up koordinatina uygun olarak aktarir.
// Koltuklarin mevcut konum/rotation degerlerine dokunulmuyor.

function configureRackModelShadows(root) {
  const maxAnisotropy = renderer.capabilities.getMaxAnisotropy()
  const textureSlots = [
    'map',
    'normalMap',
    'roughnessMap',
    'metalnessMap',
    'aoMap',
    'emissiveMap',
  ]

  root.traverse(node => {
    if (!node.isMesh) return

    // Rack meshleri masaya golge atabilir, ancak kendi uzerlerine shadow-map
    // almazlar. Eğimli on yuzeyde PointLight shadow-map kaynakli olusan
    // siyah yatay self-shadow / shadow-acne cizgilerini engeller.
    node.castShadow = true
    node.receiveShadow = false

    const materials = Array.isArray(node.material)
      ? node.material
      : [node.material]

    for (const material of materials) {
      if (!material) continue

      for (const slot of textureSlots) {
        const texture = material[slot]
        if (!texture) continue

        // GLTFLoader has already configured filtering/mipmaps. These textures
        // have not rendered yet, so anisotropy can be raised without forcing a
        // second upload or generateMipmap pass.
        texture.anisotropy = maxAnisotropy
      }

      material.needsUpdate = true
    }
  })
}

function addGlbRackModelMeshes(url) {
  const loader = new GLTFLoader()

  loader.load(
    url,
    gltf => {
      const source = gltf.scene
      if (!source) {
        console.error(`Istaka GLB sahnesi bos: ${url}`)
        return
      }

      source.updateMatrixWorld(true)
      const box = new THREE.Box3().setFromObject(source)
      if (box.isEmpty()) {
        console.error(`Istaka GLB boyutu okunamadi: ${url}`)
        return
      }

      const width = box.max.x - box.min.x
      if (width <= 1e-6) {
        console.error(`Istaka GLB X genisligi gecersiz: ${url}`)
        return
      }

      const center = box.getCenter(new THREE.Vector3())
      const scale = RACK_MODEL_TARGET_WIDTH / width

      for (const rack of [rackBottom, rackTop, rackLeft, rackRight]) {
        const wrapper = new THREE.Group()
        wrapper.name = `${rack.name}-glb-rack`

        const model = source.clone(true)
        configureRackModelShadows(model)
        model.scale.setScalar(scale)

        // Model origin'i Blender'da nerede olursa olsun X/Z merkezlenir ve
        // en alt noktasi rack-local Y=0'a oturur.
        model.position.set(
          -center.x * scale,
          -box.min.y * scale,
          -center.z * scale
        )

        wrapper.position.set(0, RACK_MODEL_Y_OFFSET, RACK_MODEL_Z_OFFSET)
        wrapper.add(model)
        rack.add(wrapper)
      }
    },
    undefined,
    error => {
      console.error(`Istaka GLB modeli yuklenemedi (${url}):`, error)
    }
  )
}

function addRackModelMeshes() {
  if (!RACK_MODEL_GLTF_URL) {
    console.error('Istaka GLB yolu bos. Beklenen dosya: /models/rack.glb')
    return
  }

  addGlbRackModelMeshes(RACK_MODEL_GLTF_URL)
}

addRackModelMeshes()


// =====================================================
// ORIS GLB — MASA ÜSTÜ DEKOR / MODEL İNCE AYAR
// =====================================================
// Beklenen dosya: client/public/models/oris.glb
// Model otomatik olarak ORIS_TARGET_SIZE değerine normalize edilir ve
// tabanı masanın keçe yüzeyine oturtulur. Konum/ölçek/rotasyonu yalnız
// aşağıdaki değerlerden değiştirebilirsin.
export const ORIS_MODEL_URL = '/models/oris.glb'
export const ORIS_POSITION_X = 1.65
export const ORIS_POSITION_Y = 1.22
export const ORIS_POSITION_Z = -1.25
export const ORIS_ROTATION_X = 0
export const ORIS_ROTATION_Y = 0
export const ORIS_ROTATION_Z = 0
export const ORIS_TARGET_SIZE = 0.58

function configureOrisModel(root) {
  const maxAnisotropy = renderer.capabilities.getMaxAnisotropy()
  const textureSlots = [
    'map',
    'normalMap',
    'roughnessMap',
    'metalnessMap',
    'aoMap',
    'emissiveMap',
  ]

  root.traverse(node => {
    if (!node.isMesh) return

    // Oris modeli masaya golge atabilir, ancak kendi uzerine shadow-map
    // almaz. Rack modelindeki shadow-acne duzeltmesiyle ayni davranis.
    node.castShadow = true
    node.receiveShadow = false

    const materials = Array.isArray(node.material)
      ? node.material
      : [node.material]

    for (const material of materials) {
      if (!material) continue

      for (const slot of textureSlots) {
        const texture = material[slot]
        if (!texture) continue

        // GLTFLoader has already configured filtering/mipmaps. These textures
        // have not rendered yet, so anisotropy can be raised without forcing a
        // second upload or generateMipmap pass.
        texture.anisotropy = maxAnisotropy
      }

      material.needsUpdate = true
    }
  })
}

function addOrisModel() {
  const loader = new GLTFLoader()

  loader.load(
    ORIS_MODEL_URL,
    gltf => {
      const model = gltf.scene
      if (!model) {
        console.error(`Oris GLB sahnesi bos: ${ORIS_MODEL_URL}`)
        return
      }

      configureOrisModel(model)
      model.updateMatrixWorld(true)

      const box = new THREE.Box3().setFromObject(model)
      if (box.isEmpty()) {
        console.error(`Oris GLB boyutu okunamadi: ${ORIS_MODEL_URL}`)
        return
      }

      const size = box.getSize(new THREE.Vector3())
      const largestAxis = Math.max(size.x, size.y, size.z)
      if (largestAxis <= 1e-6) {
        console.error(`Oris GLB boyutu gecersiz: ${ORIS_MODEL_URL}`)
        return
      }

      const center = box.getCenter(new THREE.Vector3())
      const scale = ORIS_TARGET_SIZE / largestAxis

      model.scale.setScalar(scale)
      model.position.set(
        -center.x * scale,
        -box.min.y * scale,
        -center.z * scale
      )

      const wrapper = new THREE.Group()
      wrapper.name = 'oris-table-model'
      wrapper.position.set(
        ORIS_POSITION_X,
        ORIS_POSITION_Y,
        ORIS_POSITION_Z
      )
      wrapper.rotation.set(
        ORIS_ROTATION_X,
        ORIS_ROTATION_Y,
        ORIS_ROTATION_Z
      )
      wrapper.add(model)
      scene.add(wrapper)
    },
    undefined,
    error => {
      console.error(`Oris GLB modeli yuklenemedi (${ORIS_MODEL_URL}):`, error)
    }
  )
}

addOrisModel()


// =====================================================
// ÇAY BARDAĞI + ÇAY GLB — HER OYUNCU İÇİN MASA ÜSTÜ
// =====================================================
// Beklenen dosyalar:
// - client/public/models/cay-bardagi.glb
// - client/public/models/cay.glb
// - client/public/models/caytabagi.glb
//
// Anchor konumu rack-localdir; dört oyuncuda da aynı mantıkta çalışır.
// X: sola/sağa, Y: yukarı/aşağı, Z: oyuncuya yakın/uzak.
// İstenen varsayılan: soldaki stackin biraz solu ve biraz gerisi.
export const TEA_CUP_MODEL_URL = '/models/cay-bardagi.glb'
export const TEA_LIQUID_MODEL_URL = '/models/cay.glb'
export const TEA_SAUCER_MODEL_URL = '/models/caytabagi.glb'

export const TEA_ANCHOR_X = -3.00
export const TEA_ANCHOR_Y = 0.00
export const TEA_ANCHOR_Z = -0.24
export const TEA_ANCHOR_ROTATION_X = 0
export const TEA_ANCHOR_ROTATION_Y = 0
export const TEA_ANCHOR_ROTATION_Z = 0

export const TEA_CUP_TARGET_SIZE = 0.34
export const TEA_LIQUID_TARGET_SIZE = 0.28
export const TEA_SAUCER_TARGET_SIZE = 0.46

// İki model aynı origin ile export edilmediyse bunlardan ince ayar ver.
export const TEA_CUP_LOCAL_X = 0.00
export const TEA_CUP_LOCAL_Y = 0.00
export const TEA_CUP_LOCAL_Z = 0.00

export const TEA_LIQUID_LOCAL_X = 0.00
export const TEA_LIQUID_LOCAL_Y = 0.01
export const TEA_LIQUID_LOCAL_Z = 0.00

// Çay tabağı ince ayarı. Model normalize edildikten sonra bu değerler uygulanır.
// X: sağ/sol, Y: yukarı/aşağı, Z: oyuncuya yakın/uzak.
// Varsayılan Y, bardağın tabanını tabağın içine çok hafif oturtur.
export const TEA_SAUCER_LOCAL_X = 0.00
export const TEA_SAUCER_LOCAL_Y = -0.012
export const TEA_SAUCER_LOCAL_Z = 0.00
export const TEA_SAUCER_ROTATION_X = 0
export const TEA_SAUCER_ROTATION_Y = 0
export const TEA_SAUCER_ROTATION_Z = 0
export const TEA_SAUCER_SCALE_X = 1.00
export const TEA_SAUCER_SCALE_Y = 1.00
export const TEA_SAUCER_SCALE_Z = 1.00

// Three.js physical-transmission yaklaşımı: opacity her zaman 1, görünürlük
// gerçek kırılma/Fresnel + IOR + kalınlık + environment reflection ile oluşur.
// Çok küçük dispersion yalnızca kenarlardaki optik ayrışmayı zenginleştirir;
// gökkuşağı/prizma efekti oluşturacak kadar yüksek değildir.
export const TEA_GLASS_OPACITY = 1.00
export const TEA_GLASS_TRANSMISSION = 1.00
export const TEA_GLASS_THICKNESS = 0.020
export const TEA_GLASS_IOR = 1.50
export const TEA_GLASS_ROUGHNESS = 0.028
export const TEA_GLASS_METALNESS = 0.00
export const TEA_GLASS_DISPERSION = 0.012
export const TEA_GLASS_CLEARCOAT = 0.00
export const TEA_GLASS_CLEARCOAT_ROUGHNESS = 0.00
export const TEA_GLASS_SPECULAR_INTENSITY = 1.00
export const TEA_GLASS_SPECULAR_COLOR = 0xffffff
export const TEA_GLASS_ENV_INTENSITY = 1.45
export const TEA_GLASS_ATTENUATION_COLOR = 0xffffff
export const TEA_GLASS_ATTENUATION_DISTANCE = 18.00
export const TEA_GLASS_COLOR = 0xffffff
export const TEA_GLASS_BUMP_SCALE = 0.00018

// Çay, built-in transmission pass'in arkasında çizilen yoğun amber PBR hacimdir.
// İkinci bir transparan/transmissive katman yapmıyoruz; bu sayede camın içinden
// doğru kırılırken reçine/jelibon görüntüsü oluşmaz. Clearcoat burada yalnızca
// sıvının üst yüzeyindeki keskin ışık yansımasını taklit edecek kadar düşüktür.
export const TEA_LIQUID_OPACITY = 1.00
export const TEA_LIQUID_IOR = 1.33
export const TEA_LIQUID_ROUGHNESS = 0.14
export const TEA_LIQUID_METALNESS = 0.00
export const TEA_LIQUID_COLOR = 0x541505
export const TEA_LIQUID_SPECULAR_INTENSITY = 0.92
export const TEA_LIQUID_SPECULAR_COLOR = 0xffdfc2
export const TEA_LIQUID_ENV_INTENSITY = 1.10
export const TEA_LIQUID_CLEARCOAT = 0.38
export const TEA_LIQUID_CLEARCOAT_ROUGHNESS = 0.045
export const TEA_LIQUID_EMISSIVE = 0x130300
export const TEA_LIQUID_EMISSIVE_INTENSITY = 0.055
export const TEA_LIQUID_LEVEL_BOTTOM_INSET = 0.004
export const TEA_LIQUID_LEVEL_TOP_INSET = 0.007
export const TEA_LIQUID_SURFACE_SCALE = 0.90

// Bardak içme animasyonu rack-local eksenlerde bütün koltuklara simetrik uygulanır.
// +Z oyuncuya doğru, +Y yukarıdır. Aşağıdaki değerler diğer oyuncuların gördüğü
// bardak hedefinin elle ince ayarıdır; local POV hedefi tea-actions.js içinde
// kamera koordinatından ayrıca hesaplanır.
export const TEA_DRINK_OFFSET_X = 3.00
export const TEA_DRINK_OFFSET_Y = 0.60
export const TEA_DRINK_OFFSET_Z = 0.61
export const TEA_DRINK_TILT_X = THREE.MathUtils.degToRad(48)

// Async GLB yüklendikten sonra tea-actions.js bu registry üzerinden bardaklara
// ulaşır. Her seat'in tabağı sabit, cupGroup'u hareketlidir.
export const teaSetsBySeat = {}

// Gönderilen Caustics demosundaki ana görsel ipucu, transmissive cismin altında
// oluşan kırılmış ışık desenidir. Ağır çok-pass raymarching eklemek yerine dört
// sabit çay seti için çok ucuz, statik procedural bir catcher kullanıyoruz.
// Raycast dışıdır; oyun etkileşimlerine karışmaz. İstersen aşağıdaki değerlerden
// şiddet/boyut/konumu kolayca ince ayarlayabilirsin.
export const TEA_CAUSTIC_ENABLED = true
export const TEA_CAUSTIC_SIZE = 0.58
export const TEA_CAUSTIC_LOCAL_X = 0.035
export const TEA_CAUSTIC_LOCAL_Y = 0.006
export const TEA_CAUSTIC_SURFACE_GAP = 0.0015
export const TEA_CAUSTIC_LOCAL_Z = -0.025
export const TEA_CAUSTIC_INTENSITY = 0.26
export const TEA_CAUSTIC_COLOR = 0xfff0d5

function applyHighQualityTextureFiltering(materials) {
  const maxAnisotropy = renderer.capabilities.getMaxAnisotropy()
  const textureSlots = [
    'map',
    'normalMap',
    'roughnessMap',
    'metalnessMap',
    'aoMap',
    'emissiveMap',
  ]

  for (const material of materials) {
    if (!material) continue

    for (const slot of textureSlots) {
      const texture = material[slot]
      if (!texture) continue

      // Preserve the filtering/mipmap state supplied by GLTFLoader. Forcing
      // needsUpdate here causes an unnecessary texture re-upload and may make
      // Firefox lazily initialise level 0 during generateMipmap.
      texture.anisotropy = maxAnisotropy
    }

    material.needsUpdate = true
  }
}

function createTeaGlassMaterial(sourceMaterial) {
  const material = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(TEA_GLASS_COLOR),
    transparent: true,
    opacity: TEA_GLASS_OPACITY,
    transmission: TEA_GLASS_TRANSMISSION,
    thickness: TEA_GLASS_THICKNESS,
    attenuationColor: new THREE.Color(TEA_GLASS_ATTENUATION_COLOR),
    attenuationDistance: TEA_GLASS_ATTENUATION_DISTANCE,
    ior: TEA_GLASS_IOR,
    roughness: TEA_GLASS_ROUGHNESS,
    roughnessMap: TEA_GLASS_MICRO_SURFACE_MAP,
    bumpMap: TEA_GLASS_MICRO_SURFACE_MAP,
    bumpScale: TEA_GLASS_BUMP_SCALE,
    metalness: TEA_GLASS_METALNESS,
    dispersion: TEA_GLASS_DISPERSION,
    specularIntensity: TEA_GLASS_SPECULAR_INTENSITY,
    specularColor: new THREE.Color(TEA_GLASS_SPECULAR_COLOR),
    clearcoat: TEA_GLASS_CLEARCOAT,
    clearcoatRoughness: TEA_GLASS_CLEARCOAT_ROUGHNESS,
    envMap: TEA_ENV_MAP,
    envMapIntensity: TEA_GLASS_ENV_INTENSITY,
    side: THREE.DoubleSide,
    depthWrite: false,
  })

  // Modelde varsa özgün UV/texturing bilgisi korunur. Camın rengi yine beyaz
  // tutulduğu için bu map yalnızca çok hafif yüzey varyasyonları taşıyorsa etkiler.
  if (sourceMaterial?.map) material.map = sourceMaterial.map
  return material
}

function createTeaLiquidMaterial(clippingPlane = null) {
  return new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(TEA_LIQUID_COLOR),
    transparent: false,
    opacity: TEA_LIQUID_OPACITY,
    transmission: 0,
    thickness: 0,
    ior: TEA_LIQUID_IOR,
    roughness: TEA_LIQUID_ROUGHNESS,
    metalness: TEA_LIQUID_METALNESS,
    specularIntensity: TEA_LIQUID_SPECULAR_INTENSITY,
    specularColor: new THREE.Color(TEA_LIQUID_SPECULAR_COLOR),
    clearcoat: TEA_LIQUID_CLEARCOAT,
    clearcoatRoughness: TEA_LIQUID_CLEARCOAT_ROUGHNESS,
    emissive: new THREE.Color(TEA_LIQUID_EMISSIVE),
    emissiveIntensity: TEA_LIQUID_EMISSIVE_INTENSITY,
    envMap: TEA_ENV_MAP,
    envMapIntensity: TEA_LIQUID_ENV_INTENSITY,
    side: THREE.DoubleSide,
    clippingPlanes: clippingPlane ? [clippingPlane] : null,
    clipShadows: false,
  })
}

function createTeaLiquidSurfaceMaterial() {
  return new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(TEA_LIQUID_COLOR),
    roughness: Math.max(0.055, TEA_LIQUID_ROUGHNESS * 0.58),
    metalness: 0,
    ior: TEA_LIQUID_IOR,
    specularIntensity: 1.0,
    specularColor: new THREE.Color(TEA_LIQUID_SPECULAR_COLOR),
    clearcoat: Math.max(0.55, TEA_LIQUID_CLEARCOAT),
    clearcoatRoughness: 0.028,
    emissive: new THREE.Color(TEA_LIQUID_EMISSIVE),
    emissiveIntensity: TEA_LIQUID_EMISSIVE_INTENSITY,
    envMap: TEA_ENV_MAP,
    envMapIntensity: TEA_LIQUID_ENV_INTENSITY * 1.12,
    side: THREE.DoubleSide,
  })
}

function createTeaCausticMaterial(seed = 0) {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
    uniforms: {
      uColor: { value: new THREE.Color(TEA_CAUSTIC_COLOR) },
      uIntensity: { value: TEA_CAUSTIC_INTENSITY },
      uSeed: { value: seed },
    },
    vertexShader: /* glsl */`
      varying vec2 vUv;

      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */`
      varying vec2 vUv;
      uniform vec3 uColor;
      uniform float uIntensity;
      uniform float uSeed;

      float hash21(vec2 p) {
        p = fract(p * vec2(123.34, 345.45));
        p += dot(p, p + 34.345 + uSeed);
        return fract(p.x * p.y);
      }

      float noise21(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        f = f * f * (3.0 - 2.0 * f);

        float a = hash21(i);
        float b = hash21(i + vec2(1.0, 0.0));
        float c = hash21(i + vec2(0.0, 1.0));
        float d = hash21(i + vec2(1.0, 1.0));
        return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
      }

      void main() {
        vec2 p = (vUv - 0.5) * 2.0;
        p.x *= 1.06;

        float r = length(p);
        if (r > 1.0) discard;

        float a = atan(p.y, p.x);
        float n1 = noise21(vUv * 13.0 + vec2(uSeed, 0.0));
        float n2 = noise21(vUv * 29.0 - vec2(0.0, uSeed));

        float distortedRadius = r
          + sin(a * 5.0 + r * 18.0 + uSeed * 2.7) * 0.035
          + (n1 - 0.5) * 0.045;

        float ringA = exp(-pow((distortedRadius - 0.50) / 0.055, 2.0));
        float ringB = exp(-pow((distortedRadius - 0.72) / 0.042, 2.0));
        float inner = exp(-pow((distortedRadius - 0.30) / 0.080, 2.0));

        float directional = 0.58
          + 0.42 * max(0.0, cos(a - 0.70 + uSeed * 0.31));
        float breakup = 0.58 + 0.42 * n2;
        float edgeFade = 1.0 - smoothstep(0.78, 1.0, r);

        float caustic = (ringA * 0.90 + ringB * 0.52 + inner * 0.20)
          * directional
          * breakup
          * edgeFade;

        // Merkezde bardağın tabanından gelen küçük odaklanmış parlaklık.
        float focus = exp(-dot(p + vec2(0.13, -0.08), p + vec2(0.13, -0.08)) * 19.0);
        caustic += focus * 0.18 * edgeFade;

        gl_FragColor = vec4(uColor, caustic * uIntensity);
      }
    `,
  })
}

function createTeaCausticMesh(seed = 0, localY = TEA_CAUSTIC_LOCAL_Y) {
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(TEA_CAUSTIC_SIZE, TEA_CAUSTIC_SIZE),
    createTeaCausticMaterial(seed)
  )
  mesh.name = 'tea-caustic-catcher'
  mesh.rotation.x = -Math.PI / 2
  mesh.rotation.z = 0.14 + seed * 0.11
  mesh.position.set(
    TEA_CAUSTIC_LOCAL_X,
    localY,
    TEA_CAUSTIC_LOCAL_Z
  )
  mesh.renderOrder = 6
  mesh.raycast = () => {}
  return mesh
}

function configureTeaGlassModel(root) {
  root.traverse(node => {
    if (!node.isMesh) return

    node.castShadow = false
    node.receiveShadow = false
    node.renderOrder = 30

    const sourceMaterials = Array.isArray(node.material)
      ? node.material
      : [node.material]

    const materials = sourceMaterials.map(sourceMaterial =>
      createTeaGlassMaterial(sourceMaterial)
    )

    applyHighQualityTextureFiltering(materials)
    node.material = Array.isArray(node.material) ? materials : materials[0]
  })
}

function configureTeaLiquidModel(root, clippingPlane) {
  root.traverse(node => {
    if (!node.isMesh) return

    node.castShadow = false
    node.receiveShadow = false
    node.renderOrder = 20

    const sourceMaterials = Array.isArray(node.material)
      ? node.material
      : [node.material]

    const materials = sourceMaterials.map(sourceMaterial =>
      createTeaLiquidMaterial(clippingPlane)
    )

    applyHighQualityTextureFiltering(materials)
    node.material = Array.isArray(node.material) ? materials : materials[0]
  })
}

function configureTeaSaucerModel(root) {
  root.traverse(node => {
    if (!node.isMesh) return

    node.castShadow = true
    node.receiveShadow = false
    node.renderOrder = 10

    const sourceMaterials = Array.isArray(node.material)
      ? node.material
      : [node.material]

    // GLB'nin kendi görünümünü koru; yalnızca her bardak için material instance'ı
    // ayır ve texture filtering'i sahnenin geri kalanıyla aynı kaliteye getir.
    const materials = sourceMaterials.map(sourceMaterial =>
      sourceMaterial?.clone ? sourceMaterial.clone() : sourceMaterial
    )

    applyHighQualityTextureFiltering(materials)
    node.material = Array.isArray(node.material) ? materials : materials[0]
  })
}

function buildNormalizedModelInstance(source, targetSize, configureModel) {
  const model = source.clone(true)
  configureModel(model)
  model.updateMatrixWorld(true)

  const box = new THREE.Box3().setFromObject(model)
  if (box.isEmpty()) return null

  const size = box.getSize(new THREE.Vector3())
  const largestAxis = Math.max(size.x, size.y, size.z)
  if (largestAxis <= 1e-6) return null

  const center = box.getCenter(new THREE.Vector3())
  const scale = targetSize / largestAxis
  model.scale.setScalar(scale)
  model.position.set(
    -center.x * scale,
    -box.min.y * scale,
    -center.z * scale
  )

  return model
}

function createTeaHitbox(seat) {
  const material = new THREE.MeshBasicMaterial({
    transparent: true,
    opacity: 0,
    depthWrite: false,
    depthTest: false,
  })
  material.colorWrite = false

  const hitbox = new THREE.Mesh(
    new THREE.BoxGeometry(
      TEA_CUP_TARGET_SIZE * 0.78,
      TEA_CUP_TARGET_SIZE * 1.16,
      TEA_CUP_TARGET_SIZE * 0.78
    ),
    material
  )

  hitbox.name = `${seat}-tea-hitbox`
  hitbox.position.set(
    TEA_CUP_LOCAL_X,
    TEA_CUP_LOCAL_Y + TEA_CUP_TARGET_SIZE * 0.51,
    TEA_CUP_LOCAL_Z
  )
  hitbox.userData.teaClickable = true
  hitbox.userData.teaSeat = seat
  return hitbox
}

function collectLiquidProfilePoints(liquidModel, container) {
  container.updateWorldMatrix(true, true)
  const inverseContainer = container.matrixWorld.clone().invert()
  const points = []
  const temp = new THREE.Vector3()
  const matrix = new THREE.Matrix4()

  liquidModel.traverse(node => {
    if (!node.isMesh || !node.geometry?.attributes?.position) return

    node.updateWorldMatrix(true, false)
    matrix.multiplyMatrices(inverseContainer, node.matrixWorld)
    const position = node.geometry.attributes.position
    const step = Math.max(1, Math.floor(position.count / 1800))

    for (let index = 0; index < position.count; index += step) {
      temp.fromBufferAttribute(position, index).applyMatrix4(matrix)
      points.push(temp.clone())
    }
  })

  return points
}

function buildTeaLiquidProfile(liquidModel, container) {
  const points = collectLiquidProfilePoints(liquidModel, container)
  const bounds = points.length > 0
    ? new THREE.Box3().setFromPoints(points)
    : new THREE.Box3().setFromObject(liquidModel)
  const size = bounds.getSize(new THREE.Vector3())
  const center = bounds.getCenter(new THREE.Vector3())
  const height = Math.max(size.y, 1e-5)
  const samples = []

  for (let sampleIndex = 0; sampleIndex <= 20; sampleIndex++) {
    const ratio = sampleIndex / 20
    const y = THREE.MathUtils.lerp(bounds.min.y, bounds.max.y, ratio)
    let band = height * 0.035
    let nearby = []

    for (let pass = 0; pass < 4 && nearby.length < 4; pass++) {
      nearby = points.filter(point => Math.abs(point.y - y) <= band)
      band *= 1.8
    }

    let halfWidth = size.x * 0.45
    let halfDepth = size.z * 0.45

    if (nearby.length > 0) {
      halfWidth = Math.max(
        size.x * 0.16,
        ...nearby.map(point => Math.abs(point.x - center.x))
      )
      halfDepth = Math.max(
        size.z * 0.16,
        ...nearby.map(point => Math.abs(point.z - center.z))
      )
    }

    samples.push({ ratio, halfWidth, halfDepth })
  }

  return { bounds, center, size, samples }
}

function getTeaProfileAtLevel(profile, level) {
  const clamped = THREE.MathUtils.clamp(level, 0, 1)
  const scaled = clamped * (profile.samples.length - 1)
  const lowerIndex = Math.floor(scaled)
  const upperIndex = Math.min(profile.samples.length - 1, lowerIndex + 1)
  const mix = scaled - lowerIndex
  const lower = profile.samples[lowerIndex]
  const upper = profile.samples[upperIndex]

  return {
    halfWidth: THREE.MathUtils.lerp(lower.halfWidth, upper.halfWidth, mix),
    halfDepth: THREE.MathUtils.lerp(lower.halfDepth, upper.halfDepth, mix),
  }
}

function createTeaLiquidSurface() {
  const surface = new THREE.Mesh(
    new THREE.CircleGeometry(0.5, 64),
    createTeaLiquidSurfaceMaterial()
  )
  surface.name = 'tea-liquid-surface'
  surface.rotation.x = -Math.PI / 2
  surface.renderOrder = 21
  surface.raycast = () => {}
  return surface
}

export function setTeaLevelForSeat(seat, level) {
  const teaSet = teaSetsBySeat[seat]
  if (!teaSet) return false

  const normalizedLevel = THREE.MathUtils.clamp(Number(level) || 0, 0, 1)
  teaSet.level = normalizedLevel

  if (!teaSet.liquidModel || !teaSet.surface || !teaSet.liquidBounds || !teaSet.liquidProfile) {
    return false
  }

  const hasTea = normalizedLevel > 0.002
  teaSet.liquidModel.visible = hasTea
  teaSet.surface.visible = hasTea

  if (!hasTea) {
    return true
  }

  const usableMin = teaSet.liquidBounds.min.y + TEA_LIQUID_LEVEL_BOTTOM_INSET
  const usableMax = teaSet.liquidBounds.max.y - TEA_LIQUID_LEVEL_TOP_INSET
  const localY = THREE.MathUtils.lerp(usableMin, usableMax, normalizedLevel)
  const cross = getTeaProfileAtLevel(teaSet.liquidProfile, normalizedLevel)

  teaSet.surface.position.set(
    teaSet.liquidProfile.center.x,
    localY + 0.0008,
    teaSet.liquidProfile.center.z
  )
  // Parent cupGroup X ekseninde içme yönüne eğilir. Sıvı yüzeyi ters açıyla
  // telafi edilerek dünya-yatay kalır; rack'in yalnız Y dönüşü bunu bozmaz.
  teaSet.surface.rotation.x = -Math.PI / 2 - teaSet.cupGroup.rotation.x
  teaSet.surface.scale.set(
    cross.halfWidth * 2 * TEA_LIQUID_SURFACE_SCALE,
    cross.halfDepth * 2 * TEA_LIQUID_SURFACE_SCALE,
    1
  )

  teaSet.cupGroup.updateWorldMatrix(true, true)
  const planePoint = new THREE.Vector3(
    teaSet.liquidProfile.center.x,
    localY,
    teaSet.liquidProfile.center.z
  ).applyMatrix4(teaSet.cupGroup.matrixWorld)

  teaSet.clippingPlane.setFromNormalAndCoplanarPoint(
    teaSet.clippingNormal,
    planePoint
  )

  return true
}

export function refreshTeaClippingPlanes() {
  for (const teaSet of Object.values(teaSetsBySeat)) {
    setTeaLevelForSeat(teaSet.seat, teaSet.level)
  }
}

function attachTeaGlassesToRacks(cupSource, liquidSource, saucerSource) {
  for (const [teaIndex, rack] of [rackBottom, rackTop, rackLeft, rackRight].entries()) {
    const seat = rack.name
    const anchor = new THREE.Group()
    anchor.name = `${seat}-tea-anchor`
    anchor.position.set(TEA_ANCHOR_X, TEA_ANCHOR_Y, TEA_ANCHOR_Z)
    anchor.rotation.set(
      TEA_ANCHOR_ROTATION_X,
      TEA_ANCHOR_ROTATION_Y,
      TEA_ANCHOR_ROTATION_Z
    )
    rack.add(anchor)

    let causticSurfaceY = TEA_CAUSTIC_LOCAL_Y
    let causticMesh = null

    if (saucerSource) {
      const saucerModel = buildNormalizedModelInstance(
        saucerSource,
        TEA_SAUCER_TARGET_SIZE,
        configureTeaSaucerModel
      )
      if (saucerModel) {
        saucerModel.position.x += TEA_SAUCER_LOCAL_X
        saucerModel.position.y += TEA_SAUCER_LOCAL_Y
        saucerModel.position.z += TEA_SAUCER_LOCAL_Z
        saucerModel.rotation.x += TEA_SAUCER_ROTATION_X
        saucerModel.rotation.y += TEA_SAUCER_ROTATION_Y
        saucerModel.rotation.z += TEA_SAUCER_ROTATION_Z
        saucerModel.scale.x *= TEA_SAUCER_SCALE_X
        saucerModel.scale.y *= TEA_SAUCER_SCALE_Y
        saucerModel.scale.z *= TEA_SAUCER_SCALE_Z
        anchor.add(saucerModel)

        anchor.updateWorldMatrix(true, true)
        const saucerBounds = new THREE.Box3().setFromObject(saucerModel)
        if (!saucerBounds.isEmpty()) {
          const worldTop = new THREE.Vector3(0, saucerBounds.max.y, 0)
          anchor.worldToLocal(worldTop)
          causticSurfaceY = worldTop.y + TEA_CAUSTIC_SURFACE_GAP
        }
      }
    }

    if (TEA_CAUSTIC_ENABLED) {
      causticMesh = createTeaCausticMesh(teaIndex + 1, causticSurfaceY)
      anchor.add(causticMesh)
    }

    const cupGroup = new THREE.Group()
    cupGroup.name = `${seat}-tea-cup-moving-group`
    anchor.add(cupGroup)

    const clippingPlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 0)
    let liquidModel = null
    let liquidBounds = null
    let liquidProfile = null
    let surface = null

    if (liquidSource) {
      liquidModel = buildNormalizedModelInstance(
        liquidSource,
        TEA_LIQUID_TARGET_SIZE,
        model => configureTeaLiquidModel(model, clippingPlane)
      )
      if (liquidModel) {
        liquidModel.position.x += TEA_LIQUID_LOCAL_X
        liquidModel.position.y += TEA_LIQUID_LOCAL_Y
        liquidModel.position.z += TEA_LIQUID_LOCAL_Z
        cupGroup.add(liquidModel)

        cupGroup.updateWorldMatrix(true, true)
        liquidProfile = buildTeaLiquidProfile(liquidModel, cupGroup)
        liquidBounds = liquidProfile.bounds.clone()
        surface = createTeaLiquidSurface()
        cupGroup.add(surface)
      }
    }

    let cupModel = null
    if (cupSource) {
      cupModel = buildNormalizedModelInstance(
        cupSource,
        TEA_CUP_TARGET_SIZE,
        configureTeaGlassModel
      )
      if (cupModel) {
        cupModel.position.x += TEA_CUP_LOCAL_X
        cupModel.position.y += TEA_CUP_LOCAL_Y
        cupModel.position.z += TEA_CUP_LOCAL_Z
        cupGroup.add(cupModel)
      }
    }

    const hitbox = createTeaHitbox(seat)
    cupGroup.add(hitbox)

    if (liquidModel && liquidBounds && liquidProfile && surface) {
      teaSetsBySeat[seat] = {
        seat,
        anchor,
        cupGroup,
        cupModel,
        liquidModel,
        liquidBounds,
        liquidProfile,
        surface,
        hitbox,
        causticMesh,
        clippingPlane,
        clippingNormal: new THREE.Vector3(0, -1, 0),
        level: 1,
        homePosition: cupGroup.position.clone(),
        homeRotation: cupGroup.rotation.clone(),
      }
      setTeaLevelForSeat(seat, 1)
    }
    else {
      // Çay modeli yüklenmese bile bardak tıklanabilir kalsın; interaction
      // kodu görsel level fonksiyonunu yalnız registry varsa kullanır.
      teaSetsBySeat[seat] = {
        seat,
        anchor,
        cupGroup,
        cupModel,
        liquidModel,
        liquidBounds,
        liquidProfile,
        surface,
        hitbox,
        causticMesh,
        clippingPlane,
        clippingNormal: new THREE.Vector3(0, -1, 0),
        level: liquidModel ? 1 : 0,
        homePosition: cupGroup.position.clone(),
        homeRotation: cupGroup.rotation.clone(),
      }
    }
  }
}

function loadGlbSceneAsync(loader, url) {
  return new Promise((resolve, reject) => {
    loader.load(
      url,
      gltf => resolve(gltf.scene || null),
      undefined,
      error => reject(error)
    )
  })
}

async function addTeaGlassModels() {
  const loader = new GLTFLoader()

  const [cupResult, liquidResult, saucerResult] = await Promise.allSettled([
    loadGlbSceneAsync(loader, TEA_CUP_MODEL_URL),
    loadGlbSceneAsync(loader, TEA_LIQUID_MODEL_URL),
    loadGlbSceneAsync(loader, TEA_SAUCER_MODEL_URL),
  ])

  const cupSource = cupResult.status === 'fulfilled' ? cupResult.value : null
  const liquidSource = liquidResult.status === 'fulfilled' ? liquidResult.value : null
  const saucerSource = saucerResult.status === 'fulfilled' ? saucerResult.value : null

  if (!cupSource && !liquidSource && !saucerSource) {
    console.error(
      `Çay seti modelleri yüklenemedi (${TEA_CUP_MODEL_URL}, ${TEA_LIQUID_MODEL_URL}, ${TEA_SAUCER_MODEL_URL}).`
    )
    if (cupResult.status === 'rejected') console.error(cupResult.reason)
    if (liquidResult.status === 'rejected') console.error(liquidResult.reason)
    if (saucerResult.status === 'rejected') console.error(saucerResult.reason)
    return
  }

  if (!cupSource) {
    console.error(`Çay bardağı GLB yüklenemedi (${TEA_CUP_MODEL_URL}).`)
  }

  if (!liquidSource) {
    console.error(`Çay GLB yüklenemedi (${TEA_LIQUID_MODEL_URL}).`)
  }

  if (!saucerSource) {
    console.error(`Çay tabağı GLB yüklenemedi (${TEA_SAUCER_MODEL_URL}).`)
  }

  attachTeaGlassesToRacks(cupSource, liquidSource, saucerSource)
}

void addTeaGlassModels()

export const ownTilesGroup = new THREE.Group()
ownTilesGroup.name = 'ownTilesGroup'

export const opponentTileGroups = {
  'player-bottom': new THREE.Group(),
  'player-top': new THREE.Group(),
  'player-left': new THREE.Group(),
  'player-right': new THREE.Group(),
}

for (const seat of Object.keys(opponentTileGroups)) {
  rackPlaceholders[seat].add(opponentTileGroups[seat])
}

export const rackDragPlane = new THREE.Mesh(
  new THREE.PlaneGeometry(8.0, 3.4),
  new THREE.MeshBasicMaterial({
    transparent: true,
    opacity: 0,
    depthWrite: false,
    side: THREE.DoubleSide,
  })
)
rackDragPlane.position.set(0, 0.48, 0.17)

export function resizeScene() {
  updateResponsiveSeatCameraSettings()
  camera.aspect = window.innerWidth / Math.max(window.innerHeight, 1)
  camera.updateProjectionMatrix()
  if (isTouchLayout()) {
    renderer.setPixelRatio(getRendererPixelRatio())
  }
  renderer.setSize(window.innerWidth, window.innerHeight)
}
