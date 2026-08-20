import * as THREE from 'three'
import { state } from './state.js'
import {
  camera,
  renderer,
  teaSetsBySeat,
  setTeaLevelForSeat,
  TEA_DRINK_OFFSET_X,
  TEA_DRINK_OFFSET_Y,
  TEA_DRINK_OFFSET_Z,
  TEA_DRINK_TILT_X,
} from './scene.js'

const teaRaycaster = new THREE.Raycaster()
const teaPointer = new THREE.Vector2()
const desiredTeaLevels = new Map()
const activeTeaActions = new Map()

// Kendi POV'umuzda bardak masa koordinatına değil doğrudan kameraya göre
// konumlanır. Böylece hangi koltukta olursak olalım ağza götürme anında
// ekranın alt-ortasında, kameraya yakın ve belirgin/büyük görünür.
const LOCAL_POV_DRINK_CAMERA_OFFSET = new THREE.Vector3(0, -0.30, -0.62)
const teaDrinkTargetWorld = new THREE.Vector3()
const teaDrinkTargetLocal = new THREE.Vector3()

let teaSocket = null
let teaSetMessage = null
let interactionInstalled = false

function clamp01(value) {
  return THREE.MathUtils.clamp(Number(value) || 0, 0, 1)
}

function smooth01(value) {
  const t = clamp01(value)
  return t * t * (3 - 2 * t)
}

function getLocalTeaSet() {
  return state.localSeat ? teaSetsBySeat[state.localSeat] || null : null
}

function canClickLocalTea() {
  return Boolean(
    teaSocket &&
    state.localSeat &&
    state.publicGameState?.phase === 'playing' &&
    !state.isDraggingTile &&
    !state.isTableInteracting &&
    !state.isStickyPickup &&
    !state.openBoardDragCaptured &&
    !state.boardInspectorDragActive &&
    !activeTeaActions.has(state.localSeat)
  )
}

function pointTeaRayFromEvent(event) {
  const rect = renderer.domElement.getBoundingClientRect()
  if (!(rect.width > 0) || !(rect.height > 0)) return false

  teaPointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
  teaPointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1
  teaRaycaster.setFromCamera(teaPointer, camera)
  return true
}

function isLocalTeaHit(event) {
  const teaSet = getLocalTeaSet()
  if (!teaSet?.hitbox || !pointTeaRayFromEvent(event)) return false
  return teaRaycaster.intersectObject(teaSet.hitbox, false).length > 0
}

function resetCupTransform(teaSet) {
  if (!teaSet?.cupGroup) return
  teaSet.cupGroup.position.copy(teaSet.homePosition)
  teaSet.cupGroup.rotation.copy(teaSet.homeRotation)
}

export function syncTeaLevelsFromPlayers(players) {
  if (!Array.isArray(players)) return

  for (const player of players) {
    if (!player?.seat) continue
    const level = Number.isFinite(Number(player.teaLevel))
      ? clamp01(player.teaLevel)
      : 1
    desiredTeaLevels.set(player.seat, level)

    // Server snapshot bir animasyonun ortasında gelebilir. O sırada görseli
    // hedef seviyeye zıplatma; action bittikten sonra authoritative değer uygulanır.
    if (!activeTeaActions.has(player.seat)) {
      setTeaLevelForSeat(player.seat, level)
    }
  }
}

export function handleTeaAction(data) {
  const seat = String(data?.sourceSeat || '')
  const type = String(data?.type || '')
  if (!seat || (type !== 'drink' && type !== 'refill')) return

  const fromLevel = clamp01(data?.fromLevel)
  const toLevel = clamp01(data?.toLevel)
  const durationMs = Math.max(
    220,
    Number(data?.durationMs) || (type === 'drink' ? 2300 : 3000)
  )

  desiredTeaLevels.set(seat, toLevel)
  activeTeaActions.set(seat, {
    type,
    startTime: performance.now(),
    durationMs,
    fromLevel,
    toLevel,
  })

  const teaSet = teaSetsBySeat[seat]
  if (teaSet) {
    resetCupTransform(teaSet)
    setTeaLevelForSeat(seat, fromLevel)
  }
}

function getDrinkTargetPosition(teaSet) {
  if (teaSet?.seat === state.localSeat && teaSet?.cupGroup?.parent) {
    camera.updateMatrixWorld(true)
    teaSet.cupGroup.parent.updateWorldMatrix(true, false)

    teaDrinkTargetWorld
      .copy(LOCAL_POV_DRINK_CAMERA_OFFSET)
      .applyMatrix4(camera.matrixWorld)

    teaDrinkTargetLocal.copy(teaDrinkTargetWorld)
    teaSet.cupGroup.parent.worldToLocal(teaDrinkTargetLocal)
    return teaDrinkTargetLocal
  }

  teaDrinkTargetLocal.set(
    teaSet.homePosition.x + TEA_DRINK_OFFSET_X,
    teaSet.homePosition.y + TEA_DRINK_OFFSET_Y,
    teaSet.homePosition.z + TEA_DRINK_OFFSET_Z
  )
  return teaDrinkTargetLocal
}

function updateDrinkAction(teaSet, action, progress) {
  let lift
  if (progress < 0.22) {
    lift = smooth01(progress / 0.22)
  }
  else if (progress < 0.62) {
    lift = 1
  }
  else {
    lift = 1 - smooth01((progress - 0.62) / 0.38)
  }

  const sipPulse = progress >= 0.30 && progress <= 0.58
    ? Math.sin(((progress - 0.30) / 0.28) * Math.PI * 2) * 0.018
    : 0

  const drinkTarget = getDrinkTargetPosition(teaSet)
  teaSet.cupGroup.position.set(
    THREE.MathUtils.lerp(teaSet.homePosition.x, drinkTarget.x, lift),
    THREE.MathUtils.lerp(teaSet.homePosition.y, drinkTarget.y, lift) + Math.max(0, sipPulse),
    THREE.MathUtils.lerp(teaSet.homePosition.z, drinkTarget.z, lift)
  )

  const tiltEnvelope = progress < 0.28
    ? smooth01(progress / 0.28)
    : progress < 0.60
      ? 1
      : 1 - smooth01((progress - 0.60) / 0.40)

  teaSet.cupGroup.rotation.set(
    teaSet.homeRotation.x + TEA_DRINK_TILT_X * tiltEnvelope,
    teaSet.homeRotation.y,
    teaSet.homeRotation.z
  )

  // Çay miktarı ancak yudumdan sonra, bardak geri dönmeye başlarken azalır.
  // Böylece kullanıcı bardağı kaldırdığı anda seviyenin aniden düşmesini görmez.
  const levelProgress = progress <= 0.66
    ? 0
    : smooth01((progress - 0.66) / 0.27)

  const visualLevel = THREE.MathUtils.lerp(
    action.fromLevel,
    action.toLevel,
    levelProgress
  )
  setTeaLevelForSeat(teaSet.seat, visualLevel)
}

function updateRefillAction(teaSet, action, progress) {
  resetCupTransform(teaSet)
  teaSet.cupGroup.position.y += Math.sin(progress * Math.PI) * 0.045
  setTeaLevelForSeat(
    teaSet.seat,
    THREE.MathUtils.lerp(
      action.fromLevel,
      action.toLevel,
      smooth01(progress)
    )
  )
}


export function resetTeaTransientVisuals() {
  activeTeaActions.clear()

  for (const [seat, teaSet] of Object.entries(teaSetsBySeat)) {
    resetCupTransform(teaSet)
    const desired = desiredTeaLevels.get(seat)
    setTeaLevelForSeat(seat, desired ?? teaSet.level ?? 1)
  }
}

export function updateTeaAnimation(now = performance.now()) {
  for (const [seat, teaSet] of Object.entries(teaSetsBySeat)) {
    const action = activeTeaActions.get(seat)

    if (!action) {
      const desired = desiredTeaLevels.get(seat)
      if (desired != null && Math.abs((teaSet.level ?? 1) - desired) > 0.0005) {
        setTeaLevelForSeat(seat, desired)
      }
      else {
        // Cup hareket etmese bile GLB yeni yüklenmiş olabilir; clipping plane'i
        // güncel world transform'a sabitle.
        setTeaLevelForSeat(seat, teaSet.level ?? desired ?? 1)
      }
      continue
    }

    const progress = clamp01((now - action.startTime) / action.durationMs)

    if (action.type === 'drink') {
      updateDrinkAction(teaSet, action, progress)
    }
    else {
      updateRefillAction(teaSet, action, progress)
    }

    if (progress >= 1) {
      resetCupTransform(teaSet)
      setTeaLevelForSeat(seat, action.toLevel)
      activeTeaActions.delete(seat)
    }
  }
}

export function setupTeaInteractions(socket, setMessage) {
  teaSocket = socket
  teaSetMessage = setMessage

  if (interactionInstalled) return
  interactionInstalled = true

  renderer.domElement.addEventListener('pointerdown', event => {
    if (event.button !== 0) return
    if (!canClickLocalTea()) return
    if (!isLocalTeaHit(event)) return

    // Çay tıklaması rack/table pointerdown handlerlarına düşmesin.
    event.preventDefault()
    event.stopImmediatePropagation()

    const localTeaSet = getLocalTeaSet()
    if (!localTeaSet) return

    teaSocket.emit('drink-tea', result => {
      if (!result?.ok) {
        teaSetMessage?.(result?.message || 'Çay içilemedi.')
        return
      }

      if (result.type === 'refill') {
        teaSetMessage?.('Yeni çay geldi. Bardak tekrar dolu.')
      }
      else if (Number(result.teaLevel) <= 0) {
        teaSetMessage?.('Çayın bitti. Bardağa tekrar tıklarsan yeni çay gelir.')
      }
      else {
        teaSetMessage?.('Bir yudum çay içtin.')
      }
    })
  }, true)
}
