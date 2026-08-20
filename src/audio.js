// =====================================================
// GAME SOUND EFFECTS
// =====================================================
// Ses dosyalarını Vite public klasöründe şu konuma koy:
//   client/public/sounds/
// Public içindeki dosyalar tarayıcıda /sounds/... olarak servis edilir.

const SOUND_PATHS = Object.freeze({
  'round-deal': '/sounds/round_deal.mp3',
  'rack-pickup': '/sounds/rack_pickup.mp3',
  'rack-place': '/sounds/rack_place.mp3',
  'discard-first': '/sounds/discard_first.mp3',
  'discard-stack': '/sounds/discard_stack.mp3',
  'meld-place': '/sounds/meld_place.mp3',
  // Mevcut açılmış pere tek taş işleme / okey değiştirme sesi.
  'tile-layoff': '/sounds/tile_layoff.mp3',
  // Sıra yerel oyuncuya geçtiğinde yalnız o clientta çalar.
  'your-turn': '/sounds/your_turn.mp3',
  // Normal ses dosyalari; client/public/sounds/ altina kullanici koyar.
  'tea-sip': '/sounds/tea_sip.mp3',
  'tea-refill': '/sounds/tea_refill.mp3',
})

const SOUND_VOLUMES = Object.freeze({
  'round-deal': 0.82,
  'rack-pickup': 0.56,
  'rack-place': 0.60,
  'discard-first': 0.78,
  'discard-stack': 0.78,
  'meld-place': 0.76,
  'tile-layoff': 0.72,
  'your-turn': 0.80,
  'tea-sip': 0.32,
  'tea-refill': 0.30,
})


const ROUND_DEAL_FADE_OUT_MS = 1400

function applyRoundDealFadeOut(audio, baseVolume) {
  if (!audio) return

  const fadeSeconds = ROUND_DEAL_FADE_OUT_MS / 1000
  let animationFrameId = null

  const stopFadeLoop = () => {
    if (animationFrameId !== null) {
      cancelAnimationFrame(animationFrameId)
      animationFrameId = null
    }
  }

  const updateVolume = () => {
    const duration = Number(audio.duration)
    const currentTime = Number(audio.currentTime)

    if (Number.isFinite(duration) && duration > 0 && Number.isFinite(currentTime)) {
      const effectiveFadeSeconds = Math.min(fadeSeconds, Math.max(0.25, duration * 0.35))
      const remaining = Math.max(0, duration - currentTime)
      if (remaining <= effectiveFadeSeconds) {
        const fadeRatio = Math.max(0, Math.min(1, remaining / effectiveFadeSeconds))
        audio.volume = baseVolume * fadeRatio
      }
      else {
        audio.volume = baseVolume
      }
    }

    if (!audio.paused && !audio.ended) {
      animationFrameId = requestAnimationFrame(updateVolume)
    }
    else {
      stopFadeLoop()
    }
  }

  audio.addEventListener('playing', () => {
    stopFadeLoop()
    animationFrameId = requestAnimationFrame(updateVolume)
  }, { once: true })

  audio.addEventListener('ended', stopFadeLoop, { once: true })
  audio.addEventListener('pause', stopFadeLoop, { once: true })
}

const templates = new Map()
const pendingPlayback = []
let unlockInstalled = false
let audioUnlocked = false

function isAutoplayBlock(error) {
  const name = String(error?.name || '')
  return name === 'NotAllowedError' || name === 'AbortError'
}

function flushPendingPlayback() {
  if (!audioUnlocked || pendingPlayback.length === 0) return

  const queue = pendingPlayback.splice(0, pendingPlayback.length)
  for (const item of queue) {
    playGameSound(item.type, { ...item.options, queueOnBlock: false })
  }
}

export function unlockGameAudio() {
  if (audioUnlocked) return
  audioUnlocked = true

  // Browser autoplay kilidini ilk gerçek kullanıcı etkileşiminde aç. Her sesi
  // sessiz ve çok kısa başlatıp hemen durdurmak, daha sonraki Socket.IO seslerinin
  // kullanıcı tıklaması dışında da çalabilmesini sağlar.
  for (const type of Object.keys(SOUND_PATHS)) {
    const template = getTemplate(type)
    if (!template) continue

    const probe = template.cloneNode(true)
    probe.muted = true
    probe.volume = 0
    probe.currentTime = 0

    try {
      const result = probe.play()
      if (result?.then) {
        result.then(() => {
          probe.pause()
          probe.currentTime = 0
        }).catch(() => {})
      }
    } catch {}
  }

  window.setTimeout(flushPendingPlayback, 0)
}

function installAudioUnlock() {
  if (unlockInstalled || typeof window === 'undefined') return
  unlockInstalled = true

  const unlock = () => {
    unlockGameAudio()
    window.removeEventListener('pointerdown', unlock, true)
    window.removeEventListener('keydown', unlock, true)
    window.removeEventListener('touchstart', unlock, true)
  }

  window.addEventListener('pointerdown', unlock, true)
  window.addEventListener('keydown', unlock, true)
  window.addEventListener('touchstart', unlock, true)
}

function getTemplate(type) {
  const path = SOUND_PATHS[type]
  if (!path) return null

  let template = templates.get(type)
  if (!template) {
    template = new Audio(path)
    template.preload = 'auto'
    template.volume = SOUND_VOLUMES[type] ?? 0.75
    templates.set(type, template)
  }

  return template
}

export function getDiscardPlacementSoundType(previousDiscardCount) {
  return Number(previousDiscardCount) > 0
    ? 'discard-stack'
    : 'discard-first'
}

export function getSeatDistanceVolumeScale(localSeat, sourceSeat) {
  const seats = [
    'player-bottom',
    'player-right',
    'player-top',
    'player-left',
  ]

  const localIndex = seats.indexOf(localSeat)
  const sourceIndex = seats.indexOf(sourceSeat)

  if (localIndex < 0 || sourceIndex < 0) return 1

  const rawDistance = Math.abs(localIndex - sourceIndex)
  const seatDistance = Math.min(rawDistance, seats.length - rawDistance)

  if (seatDistance === 0) return 1
  if (seatDistance === 1) return 0.72
  return 0.48
}

export function playGameSound(type, options = {}) {
  const template = getTemplate(type)
  if (!template) return false

  // cloneNode sayesinde arka arkaya gelen per/taş sesleri birbirini kesmez.
  const audio = template.cloneNode(true)
  const volumeScale = Math.max(0, Math.min(1, Number(options?.volumeScale ?? 1)))
  audio.volume = Math.max(0, Math.min(1, template.volume * volumeScale))
  audio.currentTime = 0

  if (type === 'round-deal') {
    applyRoundDealFadeOut(audio, audio.volume)
  }

  try {
    const playResult = audio.play()
    if (playResult?.catch) {
      playResult.catch(error => {
        if (isAutoplayBlock(error) && options?.queueOnBlock !== false) {
          pendingPlayback.push({
            type,
            options: {
              ...options,
              queueOnBlock: false,
            },
          })
          if (pendingPlayback.length > 12) pendingPlayback.shift()
          return
        }

        // Eksik/bozuk dosyayı artık tamamen sessiz yutma; console'da hangi
        // dosyanın yüklenemediği görülsün ama oyun akışı yine bozulmasın.
        console.warn(`[Audio] ${type} çalınamadı:`, error?.message || error)
      })
    }
  }
  catch (error) {
    console.warn(`[Audio] ${type} başlatılamadı:`, error?.message || error)
    return false
  }

  return true
}

export function playGameSoundCount(type, count = 1, spacingMs = 95, options = {}) {
  const safeCount = Math.max(0, Math.min(12, Math.floor(Number(count) || 0)))

  for (let index = 0; index < safeCount; index++) {
    if (index === 0) {
      playGameSound(type, options)
    }
    else {
      window.setTimeout(() => playGameSound(type, options), index * spacingMs)
    }
  }
}

installAudioUnlock()
