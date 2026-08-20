import * as THREE from 'three'
import { state } from './state.js'
import {
  scene,
  camera,
  renderer,
  seatCameraSettings,
  opponentTileGroups,
} from './scene.js'
import { clearGroup } from './tiles.js'
import { attachOwnTilesToSeat, renderOwnHand } from './rack.js'

const eyeWhiteMaterial = new THREE.MeshStandardMaterial({
  color: 0xffffff,
  roughness: 0.25,
})

const pupilMaterial = new THREE.MeshStandardMaterial({
  color: 0x080808,
  roughness: 0.2,
})

const TURN_NAME_COLOR = '#67f29a'
const NORMAL_NAME_COLOR = '#ffffff'

function paintNameSprite(sprite, name, isCurrentTurn = false) {
  const canvas = sprite.userData.nameCanvas
  const ctx = sprite.userData.nameContext

  if (!canvas || !ctx) return

  ctx.clearRect(0, 0, canvas.width, canvas.height)

  ctx.fillStyle = 'rgba(0,0,0,0.68)'
  ctx.beginPath()

  if (ctx.roundRect) {
    ctx.roundRect(60, 25, 392, 78, 25)
  } else {
    ctx.rect(60, 25, 392, 78)
  }

  ctx.fill()
  ctx.fillStyle = isCurrentTurn
    ? TURN_NAME_COLOR
    : NORMAL_NAME_COLOR
  ctx.font = 'bold 48px Arial'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(name, 256, 64)

  sprite.userData.playerName = name
  sprite.userData.isCurrentTurn = isCurrentTurn
  sprite.material.map.needsUpdate = true
}

function createNameSprite(name) {
  const canvas = document.createElement('canvas')
  canvas.width = 512
  canvas.height = 128

  const ctx = canvas.getContext('2d')
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace

  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
    })
  )

  sprite.userData.nameCanvas = canvas
  sprite.userData.nameContext = ctx
  sprite.scale.set(1.7, 0.43, 1)

  paintNameSprite(sprite, name, false)

  return sprite
}

function paintPenaltySprite(sprite, amount = 0) {
  const canvas = sprite.userData.penaltyCanvas
  const ctx = sprite.userData.penaltyContext
  if (!canvas || !ctx) return

  ctx.clearRect(0, 0, canvas.width, canvas.height)

  const value = Math.max(0, Number(amount) || 0)
  sprite.visible = value > 0

  if (value <= 0) return

  ctx.font = '900 58px Arial'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.lineWidth = 10
  ctx.strokeStyle = 'rgba(25,0,0,0.82)'
  ctx.strokeText(`+${value}`, 256, 64)
  ctx.fillStyle = '#ff3b30'
  ctx.fillText(`+${value}`, 256, 64)
  sprite.material.map.needsUpdate = true
}

function createPenaltySprite() {
  const canvas = document.createElement('canvas')
  canvas.width = 512
  canvas.height = 128
  const ctx = canvas.getContext('2d')
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace

  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthTest: false,
    })
  )

  sprite.userData.penaltyCanvas = canvas
  sprite.userData.penaltyContext = ctx
  sprite.scale.set(1.52, 0.38, 1)
  paintPenaltySprite(sprite, 0)
  return sprite
}

const pendingPlayerEmojis = new Map()

function paintEmojiSprite(sprite, emoji = '') {
  const canvas = sprite.userData.emojiCanvas
  const ctx = sprite.userData.emojiContext
  if (!canvas || !ctx) return

  ctx.clearRect(0, 0, canvas.width, canvas.height)
  const value = String(emoji || '').trim()
  sprite.visible = Boolean(value)
  if (!value) return

  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.font = '168px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif'
  ctx.fillText(value, 128, 132)
  sprite.material.map.needsUpdate = true
}

function createEmojiSprite() {
  const canvas = document.createElement('canvas')
  canvas.width = 256
  canvas.height = 256
  const ctx = canvas.getContext('2d')
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace

  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    })
  )

  sprite.userData.emojiCanvas = canvas
  sprite.userData.emojiContext = ctx
  sprite.scale.set(0.82, 0.82, 1)
  sprite.visible = false
  paintEmojiSprite(sprite, '')
  return sprite
}

function applyPlayerEmoji(avatar, emoji, durationMs = 2600) {
  const sprite = avatar?.userData?.emojiSprite
  if (!sprite) return

  if (avatar.userData.emojiTimer) {
    window.clearTimeout(avatar.userData.emojiTimer)
  }

  paintEmojiSprite(sprite, emoji)
  avatar.userData.emojiTimer = window.setTimeout(() => {
    avatar.userData.emojiTimer = null
    paintEmojiSprite(sprite, '')
  }, Math.max(700, Number(durationMs) || 2600))
}

function createCartoonPlayer(player) {
  const avatar = new THREE.Group()
  avatar.userData.playerId = player.id

  const leftEye = new THREE.Mesh(
    new THREE.SphereGeometry(0.19, 28, 28),
    eyeWhiteMaterial
  )
  leftEye.scale.set(0.78, 1.15, 0.67)
  leftEye.position.x = -0.21
  avatar.add(leftEye)

  const rightEye = leftEye.clone()
  rightEye.position.x = 0.21
  avatar.add(rightEye)

  const leftPupil = new THREE.Mesh(
    new THREE.SphereGeometry(0.078, 24, 24),
    pupilMaterial
  )
  leftPupil.position.set(-0.21, 0, 0.148)
  avatar.add(leftPupil)

  const rightPupil = leftPupil.clone()
  rightPupil.position.x = 0.21
  avatar.add(rightPupil)

  for (const eyePart of [leftEye, rightEye, leftPupil, rightPupil]) {
    eyePart.userData.seatSwapEye = true
    eyePart.userData.seatSwapPlayerId = player.id
  }

  const nameSprite = createNameSprite(player.name)
  nameSprite.position.y = 0.62
  avatar.add(nameSprite)

  const penaltySprite = createPenaltySprite()
  penaltySprite.position.y = 1.06
  avatar.add(penaltySprite)

  const emojiSprite = createEmojiSprite()
  emojiSprite.position.y = 1.42
  avatar.add(emojiSprite)

  avatar.userData.leftEye = leftEye
  avatar.userData.rightEye = rightEye
  avatar.userData.leftPupil = leftPupil
  avatar.userData.rightPupil = rightPupil
  avatar.userData.nameSprite = nameSprite
  avatar.userData.penaltySprite = penaltySprite
  avatar.userData.emojiSprite = emojiSprite
  avatar.userData.playerSeat = player.seat
  avatar.userData.playerName = player.name
  avatar.userData.lookX = player.lookX || 0
  avatar.userData.lookY = player.lookY || 0

  return avatar
}

// Dört göz/avatar render'ı masa merkezine aynı uzaklıkta dursun. Önceden
// bottom/top 2.7 iken left/right 3.8 idi; iyi duran 3.8 referans alındı.
const AVATAR_TABLE_DISTANCE = 3.8
const AVATAR_HEIGHT = 2.45

const avatarSettings = {
  'player-bottom': {
    position: new THREE.Vector3(0, AVATAR_HEIGHT, AVATAR_TABLE_DISTANCE),
    rotationY: Math.PI,
  },
  'player-top': {
    position: new THREE.Vector3(0, AVATAR_HEIGHT, -AVATAR_TABLE_DISTANCE),
    rotationY: 0,
  },
  'player-left': {
    position: new THREE.Vector3(-AVATAR_TABLE_DISTANCE, AVATAR_HEIGHT, 0),
    rotationY: Math.PI / 2,
  },
  'player-right': {
    position: new THREE.Vector3(AVATAR_TABLE_DISTANCE, AVATAR_HEIGHT, 0),
    rotationY: -Math.PI / 2,
  },
}

export const playerAvatars = new Map()

export function removeAvatar(id) {
  const avatar = playerAvatars.get(id)
  if (!avatar) {
    pendingPlayerEmojis.delete(id)
    return
  }

  if (avatar.userData.emojiTimer) {
    window.clearTimeout(avatar.userData.emojiTimer)
    avatar.userData.emojiTimer = null
  }

  pendingPlayerEmojis.delete(id)
  scene.remove(avatar)
  playerAvatars.delete(id)
}

export function addOrUpdatePlayer(player) {
  if (player.id === state.localPlayerId) {
    removeAvatar(player.id)
    return
  }

  let avatar = playerAvatars.get(player.id)

  if (!avatar) {
    avatar = createCartoonPlayer(player)
    playerAvatars.set(player.id, avatar)
    scene.add(avatar)

    const pendingEmoji = pendingPlayerEmojis.get(player.id)
    if (pendingEmoji) {
      pendingPlayerEmojis.delete(player.id)
      applyPlayerEmoji(avatar, pendingEmoji.emoji, pendingEmoji.durationMs)
    }
  }

  const settings = avatarSettings[player.seat]
  if (!settings) return

  avatar.position.copy(settings.position)
  avatar.rotation.y = settings.rotationY
  avatar.userData.lookX = player.lookX || 0
  avatar.userData.lookY = player.lookY || 0
  avatar.userData.playerSeat = player.seat
  avatar.userData.playerName = player.name

  const nameSprite = avatar.userData.nameSprite
  if (nameSprite) {
    paintNameSprite(
      nameSprite,
      player.name,
      player.seat === state.publicGameState?.currentSeat
    )
  }

  const penaltySprite = avatar.userData.penaltySprite
  if (penaltySprite) {
    const penaltyAmount = Math.max(0, Number(player.roundPenalty) || 0)
    const previousPenalty = Math.max(
      0,
      Number(avatar.userData.lastRoundPenalty) || 0
    )
    const turnCounter = Number(state.publicGameState?.turnCounter)

    if (penaltyAmount <= 0) {
      avatar.userData.lastRoundPenalty = 0
      avatar.userData.penaltyDisplayVisible = false
      avatar.userData.penaltyShownAtTurnCounter = null
    }
    else if (penaltyAmount !== previousPenalty) {
      // Yeni bir ceza geldiğinde kırmızı toplamı yeniden göster. Aynı ceza
      // game-state'lerde tekrar yayınlansa bile görünürlüğü yeniden açma.
      avatar.userData.lastRoundPenalty = penaltyAmount
      avatar.userData.penaltyDisplayVisible = true
      avatar.userData.penaltyShownAtTurnCounter = Number.isFinite(turnCounter)
        ? turnCounter
        : null
    }

    const shownAtRaw = avatar.userData.penaltyShownAtTurnCounter
    const shownAt = Number(shownAtRaw)
    const isPlayersTurn =
      player.seat === state.publicGameState?.currentSeat

    if (
      avatar.userData.penaltyDisplayVisible &&
      isPlayersTurn &&
      Number.isFinite(turnCounter) &&
      shownAtRaw != null &&
      Number.isFinite(shownAt) &&
      turnCounter > shownAt
    ) {
      // Ceza bir sonraki kez aynı oyuncunun sırası geldiğinde kaybolur;
      // roundPenalty puan hesabında kalmaya devam eder, yalnız sprite gizlenir.
      avatar.userData.penaltyDisplayVisible = false
    }

    paintPenaltySprite(
      penaltySprite,
      avatar.userData.penaltyDisplayVisible
        ? penaltyAmount
        : 0
    )
  }
}

export function showPlayerEmoji(playerId, emoji, durationMs = 2600) {
  if (!playerId) return

  const avatar = playerAvatars.get(playerId)
  if (!avatar) {
    // Yerel oyuncunun avatarı kendi POV'unda render edilmez. Diğer oyuncu
    // avatarı henüz oluşmadıysa da kısa süreli eventi ilk render'a sakla.
    if (playerId !== state.localPlayerId) {
      pendingPlayerEmojis.set(playerId, { emoji, durationMs })
    }
    return
  }

  applyPlayerEmoji(avatar, emoji, durationMs)
}

export function setCurrentTurnSeat(currentSeat) {
  for (const avatar of playerAvatars.values()) {
    const nameSprite = avatar.userData.nameSprite
    if (!nameSprite) continue

    paintNameSprite(
      nameSprite,
      avatar.userData.playerName || '',
      avatar.userData.playerSeat === currentSeat
    )
  }
}

export function updateAvatarEyes(avatar) {
  const x = THREE.MathUtils.clamp(avatar.userData.lookX || 0, -1, 1)
  const y = THREE.MathUtils.clamp(avatar.userData.lookY || 0, -1, 1)

  // Avatar yerel X ekseni oyuncunun baktığı yöne göre ters hissediliyordu.
  const pupilX = -x * 0.075
  const pupilY = -y * 0.085

  avatar.userData.leftPupil.position.set(
    -0.21 + pupilX,
    pupilY,
    0.150
  )

  avatar.userData.rightPupil.position.set(
    0.21 + pupilX,
    pupilY,
    0.150
  )
}

const seatSwapRaycaster = new THREE.Raycaster()
const seatSwapPointer = new THREE.Vector2()
let seatSwapInteractionInstalled = false
let lastSeatSwapRequestAt = 0

function isSeatSwapLobbyPhase() {
  const phase = state.publicGameState?.phase
  return !phase || phase === 'waiting' || phase === 'match-ended'
}

function getLocalLobbyPlayer() {
  return Array.isArray(state.connectedPlayers)
    ? state.connectedPlayers.find(player => player.id === state.localPlayerId) || null
    : null
}

function getSeatSwapEyeTarget(clientX, clientY) {
  const rect = renderer.domElement.getBoundingClientRect()
  if (!rect.width || !rect.height) return null

  seatSwapPointer.x = ((clientX - rect.left) / rect.width) * 2 - 1
  seatSwapPointer.y = -((clientY - rect.top) / rect.height) * 2 + 1
  seatSwapRaycaster.setFromCamera(seatSwapPointer, camera)

  const eyeParts = []
  for (const [playerId, avatar] of playerAvatars) {
    if (playerId === state.localPlayerId || !avatar.visible) continue
    for (const part of [
      avatar.userData.leftEye,
      avatar.userData.rightEye,
      avatar.userData.leftPupil,
      avatar.userData.rightPupil,
    ]) {
      if (part?.visible !== false) eyeParts.push(part)
    }
  }

  const hit = seatSwapRaycaster.intersectObjects(eyeParts, false)[0]
  const playerId = hit?.object?.userData?.seatSwapPlayerId
  if (!playerId) return null

  return Array.isArray(state.connectedPlayers)
    ? state.connectedPlayers.find(player => player.id === playerId) || null
    : null
}

export function setupSeatSwapEyeInteractions(socket, setMessage = () => {}) {
  if (seatSwapInteractionInstalled) return
  seatSwapInteractionInstalled = true

  renderer.domElement.addEventListener(
    'pointerdown',
    event => {
      if (event.button !== 0 || !socket) return
      if (!isSeatSwapLobbyPhase()) return

      const localPlayer = getLocalLobbyPlayer()
      if (!localPlayer || localPlayer.isBot || localPlayer.ready) return

      const target = getSeatSwapEyeTarget(event.clientX, event.clientY)
      if (!target || target.id === localPlayer.id) return

      // Göz tıklaması koltuk değiştirme etkileşimidir; aynı pointerdown'ın rack,
      // masa veya başka 3D interaction handlerlarına düşmesini engelle.
      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation()

      const now = performance.now()
      if (now - lastSeatSwapRequestAt < 450) return
      lastSeatSwapRequestAt = now

      socket.emit('seat-swap-request', target.id, result => {
        if (!result?.ok) {
          setMessage(result?.message || 'Yer değiştirme isteği gönderilemedi.')
          return
        }

        if (result.autoAccepted) return

        setMessage(`${target.name} oyuncusuna yer değiştirme isteği gönderildi.`)
      })
    },
    { capture: true }
  )
}

export function setLocalSeat(seat) {
  const settings = seatCameraSettings[seat]
  if (!settings) return

  camera.position.copy(settings.position)

  state.baseYaw = settings.yaw
  state.currentYaw = state.baseYaw
  state.currentPitch = -0.48

  attachOwnTilesToSeat(seat)
  clearGroup(opponentTileGroups[seat])
  removeAvatar(state.localPlayerId)
  renderOwnHand()
}
