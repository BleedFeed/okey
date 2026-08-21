import { io } from 'socket.io-client'
import { state } from './state.js'
import { opponentTileGroups, scene } from './scene.js'
import { clearGroup } from './tiles.js'
import {
  beginStickyPickup,
  renderHiddenTilesForSeat,
  renderOwnHand,
  resetRackForNewRound,
  syncRackRows,
} from './rack.js'
import {
  playerAvatars,
  addOrUpdatePlayer,
  removeAvatar,
  setLocalSeat,
  setCurrentTurnSeat,
  showPlayerEmoji,
} from './avatars.js'
import {
  appendChatMessage,
  appendSystemChatMessage,
  setMessage,
  showDealingBanner,
  showRoundEndBanner,
  updateHUD,
} from './hud.js'
import {
  getSeatDistanceVolumeScale,
  getDiscardPlacementSoundType,
  playGameSound,
  playGameSoundCount,
} from './audio.js'
import { isTouchLayout } from './mobile.js'
import {
  attachTableActionsToSeat,
  resetTableVisualState,
  updateTableActionVisuals,
} from './table-actions.js'
import {
  handleTeaAction,
  resetTeaTransientVisuals,
  syncTeaLevelsFromPlayers,
} from './tea-actions.js'
import { resetMeldBoardVisualState } from './meld-board.js'

let observedTurnSerial = 0
let lastObservedTurnSeat = null
let lastObservedRound = null
let lastObservedPhase = null
let lastYourTurnSoundSerial = -1
let pendingRoundStartTurnSoundTimer = null

// Dağıtım sesi ~2.7 sn. İlk başlayan oyuncunun "sıra sende" zili aynı anda
// çalarsa dağıtım sesinin altında kalıyor. Yeni raundun ilk zili bu yüzden
// kısa bir gecikmeyle, yalnız hâlâ aynı oyuncunun sırasıysa çalınır.
const ROUND_START_TURN_SOUND_DELAY_MS = 2100

function clearPendingRoundStartTurnSound() {
  if (pendingRoundStartTurnSoundTimer === null) return
  window.clearTimeout(pendingRoundStartTurnSoundTimer)
  pendingRoundStartTurnSoundTimer = null
}

function scheduleRoundStartYourTurnSound(gameState) {
  if (
    !state.localSeat ||
    gameState?.phase !== 'playing' ||
    gameState?.currentSeat !== state.localSeat
  ) {
    return false
  }

  clearPendingRoundStartTurnSound()

  const scheduledSerial = observedTurnSerial
  const scheduledRound = gameState?.round ?? null

  // Aynı turn boundary için aradaki game-state broadcastları ikinci bir
  // immediate zil üretmesin; bu boundary'nin zilini timer üstleniyor.
  lastYourTurnSoundSerial = scheduledSerial

  pendingRoundStartTurnSoundTimer = window.setTimeout(() => {
    pendingRoundStartTurnSoundTimer = null

    const current = state.publicGameState
    if (
      observedTurnSerial !== scheduledSerial ||
      current?.round !== scheduledRound ||
      current?.phase !== 'playing' ||
      current?.currentSeat !== state.localSeat
    ) {
      return
    }

    playGameSound('your-turn')
  }, ROUND_START_TURN_SOUND_DELAY_MS)

  return true
}

function maybePlayYourTurnSound(gameState) {
  if (
    !state.localSeat ||
    gameState?.phase !== 'playing' ||
    gameState?.currentSeat !== state.localSeat
  ) {
    return
  }

  if (lastYourTurnSoundSerial === observedTurnSerial) return

  lastYourTurnSoundSerial = observedTurnSerial
  playGameSound('your-turn')
}

function resetTransientClientVisuals(nextRound = null) {
  // Server yeni round / yeni maç / roster-reset snapshot'ına geçtiğinde eski
  // client-only görseller authoritative state'in üstünde yaşamaya devam etmesin.
  state.privateHandState = null
  resetRackForNewRound()
  resetTableVisualState()
  resetMeldBoardVisualState(nextRound)
  resetTeaTransientVisuals()
  window.dispatchEvent(new Event('okey:transient-visual-reset'))
}

function clearHumanReadyFlagsLocally() {
  if (Array.isArray(state.connectedPlayers)) {
    state.connectedPlayers = state.connectedPlayers.map(player => ({
      ...player,
      ready: Boolean(player.isBot),
    }))
  }

  if (Array.isArray(state.publicGameState?.players)) {
    state.publicGameState = {
      ...state.publicGameState,
      players: state.publicGameState.players.map(player => ({
        ...player,
        ready: Boolean(player.isBot),
      })),
    }
  }
}


export function resetClientToMatchmaker() {
  clearPendingRoundStartTurnSound()

  state.currentTableId = null
  state.matchmakingMode = true
  state.returningToMatchmaker = false
  state.localPlayerId = null
  state.localSeat = null
  state.connectedPlayers = []
  state.publicGameState = null
  state.privateHandState = null
  state.selectedTileId = null
  state.pendingTablePickup = null
  state.isTableInteracting = false
  state.stockDrawHighlightTileId = null

  resetRackForNewRound()
  resetTableVisualState()
  resetMeldBoardVisualState(null)
  resetTeaTransientVisuals()

  for (const id of [...playerAvatars.keys()]) {
    removeAvatar(id)
  }

  for (const seat of Object.keys(opponentTileGroups)) {
    clearGroup(opponentTileGroups[seat])
  }

  setCurrentTurnSeat(null)
  updateHUD()
  window.dispatchEvent(new CustomEvent('okey:matchmaker-reset'))
}

export function createSocket(playerName) {
  const socket = io('https://site--sunucu--pjsj9fxyzfvl.code.run', {
    auth: {
      name: playerName,
    },
  })

  socket.on('connect', () => {
    setMessage('Sunucuya bağlandı.')
  })

  socket.on('you-joined', player => {
    state.localPlayerId = player.id
    state.localSeat = player.seat
    state.currentTableId = player.tableId || state.currentTableId
    state.matchmakingMode = false

    setLocalSeat(state.localSeat)
    attachTableActionsToSeat(state.localSeat)
    maybePlayYourTurnSound(state.publicGameState)
  })

  socket.on('players-state', players => {
    state.connectedPlayers = Array.isArray(players)
      ? players
      : []

    const localPlayer = state.connectedPlayers.find(
      player => player.id === state.localPlayerId
    )

    if (localPlayer?.seat && localPlayer.seat !== state.localSeat) {
      // Lobby koltuk takasında socket aynı kalır; yeni seat'i players-state'ten
      // alıp kamera, ıstaka ve masa etkileşim anchorlarını yeniden bağla.
      state.localSeat = localPlayer.seat
      setLocalSeat(state.localSeat)
      attachTableActionsToSeat(state.localSeat)
    }

    syncTeaLevelsFromPlayers(state.connectedPlayers)

    const activeIds = new Set(
      state.connectedPlayers.map(player => player.id)
    )

    for (const [id, avatar] of playerAvatars) {
      if (!activeIds.has(id) || id === state.localPlayerId) {
        scene.remove(avatar)
        playerAvatars.delete(id)
      }
    }

    for (const player of state.connectedPlayers) {
      addOrUpdatePlayer(player)
    }

    // game-state henüz gelmediyse 4/4 bağlantı durumunu gösterebilmek için.
    updateHUD()
  })

  socket.on('lobby-ready-reset', () => {
    // Roster degisimi snapshotlari gelmeden once bile eski yesil HAZIR
    // durumunun ekranda kalmasini engelle. Asil state hemen ardindan serverdan gelir.
    clearHumanReadyFlagsLocally()
    updateHUD()
  })

  socket.on('game-state', gameState => {
    const previousGameState = state.publicGameState
    const roundChanged =
      previousGameState?.round != null &&
      gameState?.round != null &&
      gameState.round !== previousGameState.round

    const enteredRoundEnd = Boolean(
      gameState?.phase === 'round-ended' &&
      previousGameState?.phase !== 'round-ended'
    )

    const dealStarted =
      gameState?.phase === 'playing' &&
      (
        roundChanged ||
        previousGameState?.phase !== 'playing'
      )

    const turnBoundary = Boolean(
      gameState?.phase === 'playing' &&
      (
        lastObservedPhase !== 'playing' ||
        gameState?.round !== lastObservedRound ||
        gameState?.currentSeat !== lastObservedTurnSeat
      )
    )

    if (turnBoundary) {
      observedTurnSerial++
    }

    lastObservedPhase = gameState?.phase || null
    lastObservedRound = gameState?.round ?? null
    lastObservedTurnSeat = gameState?.currentSeat || null

    if (dealStarted) {
      showDealingBanner()
      playGameSound('round-deal')
    }

    const enteredFreshLobby = Boolean(
      previousGameState &&
      gameState?.phase === 'waiting' &&
      previousGameState?.phase !== 'waiting'
    )

    if (roundChanged || enteredFreshLobby) {
      resetTransientClientVisuals(gameState?.round ?? null)
    }

    state.publicGameState = gameState

    // Mobilde balyadan çekilen taş yalnız oyuncunun o turu boyunca vurgulu
    // kalır. Discard ile sıra geçtiği anda marker temizlenir.
    if (
      state.stockDrawHighlightTileId &&
      (gameState?.phase !== 'playing' || gameState?.currentSeat !== state.localSeat)
    ) {
      state.stockDrawHighlightTileId = null
      renderOwnHand()
    }

    syncTeaLevelsFromPlayers(gameState?.players || [])

    if (enteredRoundEnd && gameState?.roundEndSummary) {
      showRoundEndBanner(
        gameState.roundEndSummary,
        gameState.roundEndDisplayMs
      )
    }

    if (dealStarted) {
      // Yeni raundda ilk sırayı alan yerel oyuncunun zili dağıtım sesiyle
      // üst üste binmesin. Diğer tüm normal tur geçişleri mevcut immediate
      // maybePlayYourTurnSound() davranışını kullanmaya devam eder.
      if (!scheduleRoundStartYourTurnSound(gameState)) {
        clearPendingRoundStartTurnSound()
        maybePlayYourTurnSound(gameState)
      }
    }
    else {
      // Aynı başlangıç turn'ü için araya başka bir game-state girerse
      // gecikmeli zili iptal etme. Turn gerçekten değiştiğinde eski timerı
      // temizleyip normal anlık zil akışına dön.
      const roundStartBellStillPending =
        pendingRoundStartTurnSoundTimer !== null &&
        lastYourTurnSoundSerial === observedTurnSerial

      if (!roundStartBellStillPending) {
        clearPendingRoundStartTurnSound()
        maybePlayYourTurnSound(gameState)
      }
    }

    for (const seat of Object.keys(opponentTileGroups)) {
      if (seat !== state.localSeat) {
        clearGroup(opponentTileGroups[seat])
      }
    }

    for (const player of gameState.players || []) {
      addOrUpdatePlayer(player)

      if (player.id === state.localPlayerId) {
        continue
      }

      renderHiddenTilesForSeat(
        player.seat,
        player.tileCount
      )
    }

    // Fiziksel deste / atık kuleleri game-state ile senkronlanır.
    // Bu çağrı eksik kalırsa stockTiles başlangıçtaki visible=false durumunda kalır.
    updateTableActionVisuals(gameState, previousGameState)
    setCurrentTurnSeat(gameState.currentSeat)
    updateHUD()
  })

  socket.on('hand-state', handState => {
    const pendingPickup = state.pendingTablePickup
    const beforeIds = new Set(
      pendingPickup?.beforeIds ||
      (state.privateHandState?.hand || []).map(tile => tile.id)
    )

    state.privateHandState = handState

    if (
      state.selectedTileId &&
      !handState.hand.some(tile => tile.id === state.selectedTileId)
    ) {
      state.selectedTileId = null
    }

    if (pendingPickup) {
      const addedTile = (handState?.hand || []).find(
        tile => !beforeIds.has(tile.id)
      )

      if (addedTile) {
        state.pendingTablePickup = null
        state.isTableInteracting = false

        // Telefonda balyadan çekilen taş parmağa yapışık kalmasın. Yeni taş
        // mevcut rack solver'ın boş gördüğü slota otomatik yerleşir ve tur
        // bitene kadar hafif bir çerçeveyle vurgulanır. Desktop davranışı
        // aynen sticky pickup olarak kalır.
        if (pendingPickup.source === 'stock' && isTouchLayout()) {
          state.stockDrawHighlightTileId = addedTile.id
          syncRackRows()
          renderOwnHand()
          setMessage('Yeni taş ıstakaya yerleştirildi. Parlayan taşı istersen sağdaki TAŞ AT alanına sürükleyebilirsin.')
          return
        }

        beginStickyPickup(addedTile.id, {
          source: pendingPickup.source,
          returnSeat: pendingPickup.sourceSeat || null,
          returnIndex: Number.isInteger(pendingPickup.sourceIndex)
            ? pendingPickup.sourceIndex
            : null,
        })

        setMessage(
          pendingPickup.source === 'discard'
            ? 'Atılan taş sende. Istakaya koyabilir veya geldiği kuleye geri bırakabilirsin.'
            : 'Yeni taş sende. Istakaya koyabilir veya doğrudan sağdaki atık alanına götürüp atabilirsin.'
        )

        return
      }
    }

    syncRackRows()
    renderOwnHand()
  })

  socket.on('game-sfx', data => {
    const type = String(data?.type || '')
    const distanceScaled = ['discard', 'discard-take', 'meld-place', 'tile-layoff', 'tea-sip', 'tea-refill'].includes(type)
    const volumeScale = distanceScaled
      ? getSeatDistanceVolumeScale(state.localSeat, data?.sourceSeat)
      : 1

    if (type === 'meld-place') {
      playGameSoundCount(
        'meld-place',
        data?.count || 1,
        Math.max(95, Number(data?.spacingMs) || 95),
        { volumeScale }
      )
      return
    }

    if (type === 'discard') {
      // Ses olayı game-state'ten önce gelir. Bu yüzden o anda sourceSeat'in
      // mevcut fiziksel atık sayısı, yeni taşın boş zemine mi yoksa eski
      // taşların üstüne mi bırakıldığını güvenilir biçimde söyler.
      const sourceSeat = data?.sourceSeat
      const previousDiscardCount = Number(
        state.discardCountsBySeat?.[sourceSeat] || 0
      )

      playGameSound(
        getDiscardPlacementSoundType(previousDiscardCount),
        { volumeScale }
      )
      return
    }

    if (type === 'okey-discard') {
      // Okey atışı masa çapında bir olaydır: atan kişinin uzaklığına göre
      // kısmadan bütün bağlı oyuncularda aynı özel sesi çal.
      playGameSound('okey-discard')
      return
    }

    if (type === 'tile-layoff' || type === 'tea-sip' || type === 'tea-refill') {
      playGameSound(type, { volumeScale })
      return
    }

    // stock-draw ve discard-take eventleri oyun state senkronu için serverdan
    // gelebilir; artık bu iki olay için ses çalmıyoruz.
  })

  socket.on('tea-action', data => {
    handleTeaAction(data)
  })

  socket.on('chat-message', data => {
    appendChatMessage(data)
  })

  socket.on('player-emoji', data => {
    showPlayerEmoji(data?.playerId, data?.emoji, data?.durationMs)
  })

  socket.on('player-poked', data => {
    showPlayerEmoji(data?.targetPlayerId, '👉', 1900)
    appendSystemChatMessage(
      `${data?.sourceName || 'Bir oyuncu'}, ${data?.targetName || 'oyuncuyu'} dürttü.`
    )

    if (data?.targetPlayerId === state.localPlayerId) {
      playGameSound('your-turn')
      setMessage(`${data?.sourceName || 'Bir oyuncu'} seni dürttü!`)
    }
  })

  socket.on('player-look', data => {
    if (data.id === state.localPlayerId) {
      return
    }

    const avatar = playerAvatars.get(data.id)
    if (!avatar) return

    avatar.userData.lookX = data.x
    avatar.userData.lookY = data.y
  })

  socket.on('player-left', data => {
    removeAvatar(data.id)

    // Server players-state/game-state snapshotindan bir event once gelir. Bu kisa
    // aralikta bile eski rosterin HAZIR gorunumu ekranda kalmasin.
    if (Array.isArray(state.connectedPlayers)) {
      state.connectedPlayers = state.connectedPlayers
        .filter(player => player.id !== data.id)
        .map(player => ({ ...player, ready: Boolean(player.isBot) }))
    }
    clearHumanReadyFlagsLocally()
    updateHUD()
  })

  socket.on('table-full', data => {
    alert(data.message)
  })

  return socket
}
