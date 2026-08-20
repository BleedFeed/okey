import { state } from './state.js'
import { colorToHex } from './config.js'

const hud = document.createElement('div')
hud.id = 'game-hud'

hud.innerHTML = `
  <div id="turn-banner" aria-live="polite">SIRA SENDE</div>

  <button
    id="hud-panel-toggle"
    type="button"
    aria-expanded="true"
    aria-controls="hud-panel-content"
    title="Menüyü kapat"
  >
    <span class="hud-panel-toggle-left">
      <span class="hud-panel-status-dot" aria-hidden="true"></span>
      <span class="hud-panel-title">SALON 101</span>
      <span id="hud-panel-summary">LOBI</span>
    </span>
    <span class="hud-panel-chevron" aria-hidden="true">⌃</span>
  </button>

  <div id="hud-panel-content">
    <div id="hud-panel-content-inner">
    <div id="game-info">
      4 oyuncu bekleniyor...
    </div>

    <div id="lobby-ready-panel" aria-live="polite">
      <div id="lobby-ready-status"></div>
      <div class="lobby-ready-actions">
        <button id="rename-player-button" type="button">NICK DEĞİŞTİR</button>
        <button id="ready-player-button" type="button">HAZIR</button>
      </div>
    </div>

    <div id="score-board"></div>

    <div id="bot-controls">
      <button id="add-bot-button" type="button">BOT EKLE</button>
      <button id="remove-bot-button" type="button">BOT ÇIKAR</button>
    </div>

    <div id="kick-controls">
      <select id="kick-target-select" aria-label="Kick hedefi"></select>
      <button id="kick-start-button" type="button">OYUNCU AT</button>
    </div>

    <div id="kick-vote-panel" aria-live="polite">
      <div id="kick-vote-text"></div>
      <div class="kick-vote-actions">
        <button id="kick-vote-yes" type="button">EVET</button>
        <button id="kick-vote-no" type="button">HAYIR</button>
      </div>
    </div>

    <div id="control-hint">
      W: açma alanı
      &nbsp; • &nbsp;
      S: ıstakaya dön
      &nbsp; • &nbsp;
      D: açan oyuncuyu izle
      &nbsp; • &nbsp;
      Üstte AÇILAN TAŞLAR: işleme görünümü
    </div>

    <div id="game-message"></div>
    </div>
  </div>
`

document.body.appendChild(hud)

const dealingBanner = document.createElement('div')
dealingBanner.id = 'dealing-banner'
dealingBanner.textContent = 'TAŞLAR DAĞITILIYOR'
dealingBanner.setAttribute('aria-live', 'assertive')
document.body.appendChild(dealingBanner)

const roundEndBanner = document.createElement('div')
roundEndBanner.id = 'round-end-banner'
roundEndBanner.setAttribute('aria-live', 'assertive')
roundEndBanner.innerHTML = `
  <div class="round-end-banner-kicker">RAUND SONU</div>
  <div id="round-end-banner-text"></div>
`
document.body.appendChild(roundEndBanner)
const roundEndBannerText = document.getElementById('round-end-banner-text')
let roundEndBannerTimer = null

const roundEndBannerStyle = document.createElement('style')
roundEndBannerStyle.textContent = `
  #round-end-banner {
    position: fixed;
    left: 50%;
    top: 50%;
    z-index: 138;
    min-width: min(520px, calc(100vw - 36px));
    max-width: calc(100vw - 36px);
    box-sizing: border-box;
    transform: translate(-50%, -50%) scale(0.94);
    padding: 16px 24px 18px;
    border: 1px solid rgba(255,255,255,0.15);
    border-radius: 15px;
    background: linear-gradient(180deg, rgba(12,18,17,0.72), rgba(8,13,12,0.62));
    box-shadow: 0 18px 46px rgba(0,0,0,0.28), inset 0 1px 0 rgba(255,255,255,0.05);
    backdrop-filter: blur(16px) saturate(0.92);
    -webkit-backdrop-filter: blur(16px) saturate(0.92);
    color: #f5f7f6;
    text-align: center;
    font-family: Tahoma, Verdana, "Segoe UI", sans-serif;
    pointer-events: none;
    opacity: 0;
    transition: opacity 150ms ease, transform 150ms ease;
  }

  #round-end-banner.is-visible {
    opacity: 1;
    transform: translate(-50%, -50%) scale(1);
  }

  .round-end-banner-kicker {
    margin-bottom: 7px;
    color: rgba(255, 224, 141, 0.76);
    font-size: 10px;
    font-weight: 900;
    letter-spacing: 0.22em;
  }

  #round-end-banner-text {
    font-size: clamp(24px, 4.2vw, 46px);
    font-weight: 900;
    line-height: 1.08;
    letter-spacing: 0.055em;
    text-shadow: 0 4px 20px rgba(0,0,0,0.38);
  }
`
document.head.appendChild(roundEndBannerStyle)

const seatSwapOfferPanel = document.createElement('div')
seatSwapOfferPanel.id = 'seat-swap-offer-panel'
seatSwapOfferPanel.setAttribute('role', 'dialog')
seatSwapOfferPanel.setAttribute('aria-live', 'assertive')
seatSwapOfferPanel.innerHTML = `
  <div class="seat-swap-offer-kicker">KOLTUK DEĞİŞİMİ</div>
  <div id="seat-swap-offer-text"></div>
  <div class="seat-swap-offer-actions">
    <button id="seat-swap-accept" type="button">EVET</button>
    <button id="seat-swap-decline" type="button">HAYIR</button>
  </div>
`
document.body.appendChild(seatSwapOfferPanel)

const socialPanel = document.createElement('div')
socialPanel.id = 'social-panel'
socialPanel.innerHTML = `
  <div id="social-panel-header">
    <div class="social-panel-heading">
      <span class="social-panel-heading-dot" aria-hidden="true"></span>
      <span>SOHBET</span>
    </div>
    <button
      id="chat-minimize-button"
      type="button"
      aria-label="Sohbeti küçült"
      aria-controls="social-panel-body"
      aria-expanded="true"
      title="Sohbeti küçült"
    >−</button>
  </div>
  <div id="social-panel-body">
    <div id="chat-log" aria-live="polite"></div>
    <div id="emoji-drawer" aria-label="Emoji çekmecesi"></div>
    <form id="chat-form" autocomplete="off">
      <button id="emoji-toggle-button" type="button" aria-label="Emoji">😊</button>
      <input id="chat-input" type="text" maxlength="180" placeholder="Mesaj yaz..." aria-label="Sohbet mesajı">
      <button id="chat-send-button" type="submit">GÖNDER</button>
    </form>
    <button id="poke-current-button" type="button">DÜRT</button>
  </div>
`
document.body.appendChild(socialPanel)

const chatDockButton = document.createElement('button')
chatDockButton.id = 'chat-dock-button'
chatDockButton.type = 'button'
chatDockButton.setAttribute('aria-label', 'Sohbeti aç')
chatDockButton.title = 'Sohbeti aç'
chatDockButton.innerHTML = `
  <span class="chat-dock-icon" aria-hidden="true"></span>
  <span id="chat-unread-badge" aria-hidden="true"></span>
`
document.body.appendChild(chatDockButton)

const hudPanelToggle = document.getElementById('hud-panel-toggle')
const hudPanelContent = document.getElementById('hud-panel-content')
const hudPanelSummary = document.getElementById('hud-panel-summary')
const gameInfo = document.getElementById('game-info')
const scoreBoard = document.getElementById('score-board')
const gameMessage = document.getElementById('game-message')
const turnBanner = document.getElementById('turn-banner')
const lobbyReadyPanel = document.getElementById('lobby-ready-panel')
const lobbyReadyStatus = document.getElementById('lobby-ready-status')
const renamePlayerButton = document.getElementById('rename-player-button')
const readyPlayerButton = document.getElementById('ready-player-button')
const botControls = document.getElementById('bot-controls')
const addBotButton = document.getElementById('add-bot-button')
const removeBotButton = document.getElementById('remove-bot-button')
const kickControls = document.getElementById('kick-controls')
const kickTargetSelect = document.getElementById('kick-target-select')
const kickStartButton = document.getElementById('kick-start-button')
const kickVotePanel = document.getElementById('kick-vote-panel')
const kickVoteText = document.getElementById('kick-vote-text')
const kickVoteYes = document.getElementById('kick-vote-yes')
const kickVoteNo = document.getElementById('kick-vote-no')

const chatMinimizeButton = document.getElementById('chat-minimize-button')
const chatUnreadBadge = document.getElementById('chat-unread-badge')
const chatLog = document.getElementById('chat-log')
const emojiDrawer = document.getElementById('emoji-drawer')
const chatForm = document.getElementById('chat-form')
const chatInput = document.getElementById('chat-input')
const chatSendButton = document.getElementById('chat-send-button')
const emojiToggleButton = document.getElementById('emoji-toggle-button')
const pokeCurrentButton = document.getElementById('poke-current-button')
const seatSwapOfferText = document.getElementById('seat-swap-offer-text')
const seatSwapAcceptButton = document.getElementById('seat-swap-accept')
const seatSwapDeclineButton = document.getElementById('seat-swap-decline')

const SOCIAL_EMOJIS = ['😂', '😎', '😡', '😭', '❤️', '👍', '👏', '🔥', '🤔', '😴', '🎉', '👀']
const CHAT_MAX_VISIBLE_MESSAGES = 40

const TOP_UI_STYLE_ID = 'okey-top-ui-style'
let botSocket = null
let kickVoteState = null
let seatSwapOfferState = null
let dealingBannerTimer = null
let hudPanelCollapsed = false
let chatMinimized = false
let chatUnreadCount = 0

function ensureTopUiStyle() {
  if (document.getElementById(TOP_UI_STYLE_ID)) return

  const style = document.createElement('style')
  style.id = TOP_UI_STYLE_ID
  style.textContent = `
    #game-hud {
      position: fixed;
      top: 16px;
      left: 16px;
      z-index: 90;
      width: min(328px, calc(100vw - 32px));
      box-sizing: border-box;
      padding: 0;
      overflow: visible;
      border: 1px solid rgba(212, 169, 92, 0.36);
      border-radius: 18px;
      background:
        radial-gradient(circle at top left, rgba(216, 178, 104, 0.15), transparent 34%),
        linear-gradient(180deg, rgba(58, 42, 22, 0.96), rgba(27, 20, 11, 0.95) 52%, rgba(18, 13, 8, 0.97));
      box-shadow:
        0 22px 58px rgba(0, 0, 0, 0.40),
        inset 0 1px 0 rgba(255, 240, 204, 0.13),
        inset 0 0 0 1px rgba(100, 68, 26, 0.42);
      backdrop-filter: blur(10px) saturate(1.02);
      transition:
        width 260ms cubic-bezier(.22, 1, .36, 1),
        border-color 220ms ease,
        box-shadow 260ms ease,
        transform 240ms ease;
    }

    #game-hud::before {
      content: '';
      position: absolute;
      inset: 7px;
      border-radius: 12px;
      border: 1px solid rgba(244, 210, 147, 0.12);
      pointer-events: none;
      opacity: 0.95;
    }

    #game-hud.is-collapsed {
      width: min(262px, calc(100vw - 32px));
      border-color: rgba(206, 164, 92, 0.28);
      box-shadow:
        0 14px 38px rgba(0, 0, 0, 0.34),
        inset 0 1px 0 rgba(255, 238, 206, 0.10),
        inset 0 0 0 1px rgba(100, 68, 26, 0.28);
    }

    #hud-panel-toggle {
      position: relative;
      z-index: 2;
      width: 100%;
      min-height: 48px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      padding: 11px 13px 11px 14px;
      border: 0;
      border-radius: 17px 17px 10px 10px;
      outline: none;
      background:
        linear-gradient(180deg, rgba(255, 228, 170, 0.09), rgba(255, 228, 170, 0.02)),
        linear-gradient(180deg, rgba(129, 89, 35, 0.18), rgba(58, 40, 18, 0.08));
      color: #f4ead7;
      cursor: pointer;
      font-family: "Trebuchet MS", "Segoe UI", sans-serif;
      text-align: left;
      pointer-events: auto;
      transition: background 180ms ease, border-radius 260ms cubic-bezier(.22, 1, .36, 1), transform 180ms ease;
    }

    #game-hud.is-collapsed #hud-panel-toggle {
      border-radius: 13px;
    }

    #hud-panel-toggle:hover {
      background:
        linear-gradient(180deg, rgba(255, 228, 170, 0.14), rgba(255, 228, 170, 0.035)),
        linear-gradient(180deg, rgba(129, 89, 35, 0.24), rgba(58, 40, 18, 0.10));
      transform: translateY(-1px);
    }

    #hud-panel-toggle:focus-visible {
      box-shadow: inset 0 0 0 2px rgba(255, 214, 120, 0.46);
    }

    .hud-panel-toggle-left {
      min-width: 0;
      display: flex;
      align-items: center;
      gap: 7px;
    }

    .hud-panel-status-dot {
      width: 8px;
      height: 8px;
      flex: 0 0 8px;
      border-radius: 50%;
      background: #f5c96c;
      box-shadow: 0 0 0 3px rgba(245, 201, 108, 0.12), 0 0 12px rgba(245, 201, 108, 0.26);
    }

    .hud-panel-title {
      font: 900 12px/1 "Trebuchet MS", "Segoe UI", sans-serif;
      letter-spacing: 0.14em;
      color: #f7e8c8;
      text-shadow: 0 1px 0 rgba(46, 27, 8, 0.65);
    }

    #hud-panel-summary {
      min-width: 0;
      max-width: 150px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      padding-left: 9px;
      border-left: 1px solid rgba(245, 213, 150, 0.18);
      color: rgba(233, 214, 178, 0.82);
      font: 800 9px/1 "Trebuchet MS", "Segoe UI", sans-serif;
      letter-spacing: 0.09em;
      text-transform: uppercase;
    }

    .hud-panel-chevron {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 26px;
      height: 26px;
      flex: 0 0 26px;
      border: 1px solid rgba(245, 213, 150, 0.16);
      border-radius: 9px;
      background: rgba(255, 234, 195, 0.05);
      color: rgba(247, 234, 210, 0.84);
      font: 800 15px/1 "Trebuchet MS", "Segoe UI", sans-serif;
      transform: rotate(0deg);
      transition: transform 280ms cubic-bezier(.22, 1, .36, 1), background 180ms ease, border-color 180ms ease;
    }

    #game-hud.is-collapsed .hud-panel-chevron {
      transform: rotate(180deg);
    }

    #hud-panel-content {
      display: grid;
      grid-template-rows: 1fr;
      box-sizing: border-box;
      overflow: hidden;
      opacity: 1;
      pointer-events: auto;
      transition:
        grid-template-rows 300ms cubic-bezier(.22, 1, .36, 1),
        opacity 190ms ease;
    }

    #hud-panel-content-inner {
      min-height: 0;
      max-height: min(72vh, 640px);
      box-sizing: border-box;
      padding: 0 10px 10px;
      overflow-x: hidden;
      overflow-y: auto;
      opacity: 1;
      transform: translateY(0) scale(1);
      transform-origin: top center;
      transition:
        padding 260ms cubic-bezier(.22, 1, .36, 1),
        opacity 180ms ease 55ms,
        transform 300ms cubic-bezier(.22, 1, .36, 1);
      scrollbar-width: thin;
      scrollbar-color: rgba(255,255,255,0.16) transparent;
    }

    #game-hud.is-collapsed #hud-panel-content {
      grid-template-rows: 0fr;
      opacity: 0;
      pointer-events: none;
    }

    #game-hud.is-collapsed #hud-panel-content-inner {
      padding-top: 0;
      padding-bottom: 0;
      opacity: 0;
      transform: translateY(-8px) scale(0.985);
    }

    #game-info {
      margin: 0 0 8px;
      padding: 10px 11px;
      border: 1px solid rgba(218, 177, 102, 0.20);
      border-radius: 11px;
      background: linear-gradient(180deg, rgba(255, 235, 204, 0.04), rgba(255, 255, 255, 0.015));
      color: rgba(247, 237, 220, 0.95);
      box-shadow: inset 0 1px 0 rgba(255, 236, 208, 0.05);
    }

    #lobby-ready-panel {
      display: none;
      width: min(360px, calc(100vw - 28px));
      box-sizing: border-box;
      margin-top: 7px;
      padding: 10px;
      border: 1px solid rgba(214, 171, 94, 0.24);
      border-radius: 11px;
      background: linear-gradient(180deg, rgba(51, 37, 19, 0.92), rgba(25, 18, 10, 0.92));
      box-shadow: 0 10px 24px rgba(0,0,0,0.28);
      pointer-events: auto;
    }

    #lobby-ready-status {
      display: flex;
      flex-wrap: wrap;
      gap: 5px;
      min-height: 24px;
      align-items: center;
      font: 800 10px/1.15 "Trebuchet MS", "Segoe UI", sans-serif;
    }

    .lobby-ready-chip {
      padding: 5px 7px;
      border-radius: 999px;
      border: 1px solid rgba(255,255,255,0.15);
      background: rgba(255, 245, 220, 0.06);
      color: #eadfc8;
      white-space: nowrap;
    }

    .lobby-ready-chip.is-ready {
      border-color: rgba(86, 232, 145, 0.50);
      color: #91f1b6;
      background: rgba(44, 123, 75, 0.18);
    }

    .lobby-ready-chip.is-bot {
      color: #b9d9ff;
      border-color: rgba(104, 174, 255, 0.38);
    }

    .lobby-ready-actions {
      display: flex;
      gap: 6px;
      margin-top: 8px;
    }

    #lobby-ready-panel button {
      border: 1px solid rgba(234, 194, 125, 0.24);
      border-radius: 8px;
      padding: 8px 11px;
      background: linear-gradient(180deg, rgba(107, 74, 31, 0.28), rgba(52, 35, 18, 0.36));
      color: #f7ead0;
      box-shadow: 0 5px 13px rgba(0,0,0,0.24);
      font: 900 10px/1 "Trebuchet MS", "Segoe UI", sans-serif;
      letter-spacing: 0.08em;
      cursor: pointer;
    }

    #ready-player-button {
      border-color: rgba(83, 235, 145, 0.58) !important;
      color: #9cf5bd !important;
    }

    #ready-player-button.is-ready {
      border-color: rgba(255, 201, 80, 0.60) !important;
      color: #ffe19a !important;
    }

    #lobby-ready-panel button:disabled {
      opacity: 0.42;
      cursor: default;
    }

    #bot-controls {
      position: static;
      display: flex;
      gap: 5px;
      margin-top: 6px;
      margin-bottom: 6px;
      pointer-events: auto;
    }

    #bot-controls button {
      border: 1px solid rgba(234, 194, 125, 0.22);
      border-radius: 8px;
      padding: 7px 9px;
      background: linear-gradient(180deg, rgba(98, 68, 28, 0.26), rgba(47, 31, 16, 0.34));
      color: #f6e7c7;
      box-shadow: 0 4px 13px rgba(0,0,0,0.28);
      font: 800 10px/1 "Trebuchet MS", "Segoe UI", sans-serif;
      letter-spacing: 0.07em;
      cursor: pointer;
    }

    #bot-controls button:hover:not(:disabled) {
      transform: translateY(-1px);
      border-color: rgba(255, 216, 88, 0.65);
    }

    #bot-controls button:disabled {
      opacity: 0.42;
      cursor: default;
    }

    #kick-controls {
      position: static;
      display: none;
      gap: 5px;
      margin-top: 5px;
      margin-bottom: 5px;
      pointer-events: auto;
    }

    #kick-controls select,
    #kick-controls button,
    #kick-vote-panel button {
      border: 1px solid rgba(234, 194, 125, 0.22);
      border-radius: 8px;
      padding: 7px 9px;
      background: linear-gradient(180deg, rgba(98, 68, 28, 0.26), rgba(47, 31, 16, 0.34));
      color: #f6e7c7;
      box-shadow: 0 4px 13px rgba(0,0,0,0.28);
      font: 800 10px/1 "Trebuchet MS", "Segoe UI", sans-serif;
      cursor: pointer;
    }

    #kick-controls select {
      min-width: 112px;
      cursor: default;
    }

    #kick-start-button {
      border-color: rgba(255, 103, 103, 0.52) !important;
      color: #ffb0b0 !important;
    }

    #kick-vote-panel {
      position: static;
      width: 100%;
      box-sizing: border-box;
      display: none;
      padding: 10px;
      border: 1px solid rgba(255, 112, 112, 0.48);
      border-radius: 10px;
      background: rgba(28, 18, 18, 0.92);
      color: #ffecec;
      box-shadow: 0 7px 22px rgba(0,0,0,0.34);
      pointer-events: auto;
      font: 700 12px/1.35 "Segoe UI", sans-serif;
    }

    .kick-vote-actions {
      display: flex;
      gap: 7px;
      margin-top: 8px;
    }

    #kick-vote-yes { color: #ffb2b2 !important; }
    #kick-vote-no { color: #d4ded8 !important; }

    #kick-vote-panel button:disabled,
    #kick-controls button:disabled,
    #kick-controls select:disabled {
      opacity: 0.42;
      cursor: default;
    }

    #turn-banner {
      position: absolute;
      top: calc(100% + 10px);
      left: 0;
      right: auto;
      z-index: 69;
      transform: scale(0.97);
      transform-origin: left top;
      padding: 8px 14px 9px;
      border-radius: 11px;
      background: linear-gradient(180deg, rgba(74, 51, 19, 0.88), rgba(39, 28, 12, 0.88));
      border: 1px solid rgba(242, 205, 118, 0.28);
      color: #f8d577;
      text-shadow: 0 2px 10px rgba(65, 41, 6, 0.55);
      box-shadow: 0 10px 24px rgba(0,0,0,0.28);
      font: 900 18px/1 "Trebuchet MS", "Segoe UI", sans-serif;
      letter-spacing: 0.12em;
      white-space: nowrap;
      pointer-events: none;
      opacity: 0;
      transition: opacity 120ms ease, transform 120ms ease;
    }

    #turn-banner.is-visible {
      opacity: 1;
      transform: scale(1);
    }

    #dealing-banner {
      position: fixed;
      left: 50%;
      top: 50%;
      z-index: 120;
      transform: translate(-50%, -50%) scale(0.94);
      padding: 20px 31px;
      border-radius: 18px;
      border: 1px solid rgba(243, 204, 121, 0.26);
      background: linear-gradient(180deg, rgba(54, 38, 18, 0.92), rgba(23, 16, 9, 0.92));
      color: #f8dd93;
      text-shadow: 0 3px 16px rgba(71, 48, 10, 0.60);
      box-shadow: 0 18px 48px rgba(0, 0, 0, 0.36);
      font: 900 clamp(34px, 5.2vw, 72px)/1 "Trebuchet MS", "Segoe UI", sans-serif;
      letter-spacing: 0.14em;
      white-space: nowrap;
      pointer-events: none;
      opacity: 0;
      transition: opacity 130ms ease, transform 130ms ease;
    }

    #dealing-banner.is-visible {
      opacity: 1;
      transform: translate(-50%, -50%) scale(1);
    }

    #seat-swap-offer-panel {
      position: fixed;
      top: 74px;
      left: 50%;
      z-index: 132;
      width: min(360px, calc(100vw - 28px));
      box-sizing: border-box;
      display: none;
      transform: translate(-50%, -8px) scale(0.985);
      padding: 13px 14px 12px;
      border: 1px solid rgba(255,255,255,0.18);
      border-radius: 14px;
      background: rgba(14, 18, 16, 0.82);
      box-shadow: 0 16px 42px rgba(0,0,0,0.34);
      backdrop-filter: blur(14px) saturate(0.92);
      -webkit-backdrop-filter: blur(14px) saturate(0.92);
      color: #f7f2e7;
      pointer-events: auto;
      font-family: Tahoma, Verdana, "Segoe UI", sans-serif;
      opacity: 0;
      transition: opacity 150ms ease, transform 180ms cubic-bezier(.22,1,.36,1);
    }

    #seat-swap-offer-panel.is-visible {
      display: block;
      opacity: 1;
      transform: translate(-50%, 0) scale(1);
    }

    .seat-swap-offer-kicker {
      margin-bottom: 5px;
      color: rgba(255, 216, 137, 0.88);
      font-size: 9px;
      font-weight: 900;
      letter-spacing: 0.12em;
    }

    #seat-swap-offer-text {
      font-size: 13px;
      font-weight: 700;
      line-height: 1.35;
    }

    .seat-swap-offer-actions {
      display: flex;
      gap: 7px;
      margin-top: 11px;
    }

    .seat-swap-offer-actions button {
      flex: 1;
      border: 1px solid rgba(255,255,255,0.18);
      border-radius: 9px;
      padding: 8px 10px;
      background: rgba(255,255,255,0.07);
      color: #f6f1e7;
      font: 900 10px/1 Tahoma, Verdana, "Segoe UI", sans-serif;
      cursor: pointer;
    }

    #seat-swap-accept {
      border-color: rgba(90, 235, 146, 0.42);
      color: #9cf3bc;
    }

    #seat-swap-decline {
      border-color: rgba(255, 120, 120, 0.32);
      color: #ffc0c0;
    }

    #social-panel {
      position: fixed;
      right: 14px;
      bottom: 14px;
      z-index: 95;
      width: min(344px, calc(100vw - 28px));
      box-sizing: border-box;
      padding: 10px;
      border: 1px solid rgba(214, 171, 94, 0.26);
      border-radius: 15px;
      background: radial-gradient(circle at top right, rgba(202, 154, 76, 0.10), transparent 28%), linear-gradient(180deg, rgba(53, 37, 20, 0.94), rgba(22, 16, 9, 0.94));
      box-shadow: 0 14px 34px rgba(0,0,0,0.36), inset 0 1px 0 rgba(255, 235, 201, 0.08);
      backdrop-filter: blur(8px);
      color: #f4ead7;
      pointer-events: auto;
      font-family: "Trebuchet MS", "Segoe UI", sans-serif;
    }

    #social-panel.is-minimized {
      display: none;
    }

    #social-panel-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      margin: -2px -1px 7px;
      padding: 0 1px 7px 3px;
      border-bottom: 1px solid rgba(255,255,255,0.055);
    }

    .social-panel-heading {
      display: flex;
      align-items: center;
      gap: 7px;
      color: rgba(247,250,249,0.84);
      font: 800 10px/1 Tahoma, Verdana, "Segoe UI", sans-serif;
      letter-spacing: 0.10em;
    }

    .social-panel-heading-dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: rgba(121,217,255,0.92);
      box-shadow: 0 0 9px rgba(121,217,255,0.38);
    }

    #chat-minimize-button {
      width: 27px;
      height: 23px;
      display: grid;
      place-items: center;
      flex: 0 0 27px;
      padding: 0 !important;
      border-radius: 7px !important;
      font: 800 18px/1 Tahoma, Verdana, "Segoe UI", sans-serif !important;
      letter-spacing: 0 !important;
      color: rgba(245,248,247,0.72) !important;
    }

    #social-panel-body {
      min-width: 0;
    }

    #chat-dock-button {
      position: fixed;
      right: 14px;
      bottom: 14px;
      z-index: 96;
      width: 46px;
      height: 46px;
      display: none;
      place-items: center;
      padding: 0;
      border: 1px solid rgba(235,240,238,0.15);
      border-radius: 14px;
      outline: none;
      background: rgba(10,16,15,0.48);
      box-shadow: 0 8px 24px rgba(0,0,0,0.19), inset 0 1px 0 rgba(255,255,255,0.055);
      backdrop-filter: blur(16px) saturate(0.92);
      -webkit-backdrop-filter: blur(16px) saturate(0.92);
      cursor: pointer;
      pointer-events: auto;
      transition: transform 150ms ease, border-color 150ms ease, background 150ms ease, box-shadow 180ms ease;
    }

    #chat-dock-button.is-visible {
      display: grid;
    }

    #chat-dock-button:hover {
      transform: translateY(-2px);
      border-color: rgba(235,240,238,0.26);
      background: rgba(18,27,25,0.62);
    }

    #chat-dock-button:focus-visible {
      box-shadow: 0 0 0 2px rgba(121,217,255,0.22), 0 8px 24px rgba(0,0,0,0.20);
    }

    .chat-dock-icon {
      position: relative;
      width: 20px;
      height: 15px;
      box-sizing: border-box;
      border: 1.7px solid rgba(245,248,247,0.80);
      border-radius: 6px;
      transition: border-color 150ms ease, box-shadow 180ms ease;
    }

    .chat-dock-icon::before {
      content: '';
      position: absolute;
      left: 5px;
      right: 5px;
      top: 6px;
      height: 1.5px;
      border-radius: 2px;
      background: rgba(245,248,247,0.62);
      box-shadow: -3px -4px 0 -0.2px rgba(245,248,247,0.62), 3px -4px 0 -0.2px rgba(245,248,247,0.62);
    }

    .chat-dock-icon::after {
      content: '';
      position: absolute;
      left: 3px;
      bottom: -5px;
      width: 6px;
      height: 6px;
      box-sizing: border-box;
      border-left: 1.7px solid rgba(245,248,247,0.80);
      border-bottom: 1.7px solid rgba(245,248,247,0.80);
      background: rgba(10,16,15,0.82);
      transform: skewY(-35deg);
    }

    #chat-dock-button.has-unread .chat-dock-icon {
      border-color: rgba(121,217,255,0.98);
      box-shadow: 0 0 13px rgba(121,217,255,0.28);
    }

    #chat-unread-badge {
      position: absolute;
      top: -5px;
      right: -5px;
      min-width: 17px;
      height: 17px;
      display: none;
      align-items: center;
      justify-content: center;
      box-sizing: border-box;
      padding: 0 4px;
      border: 2px solid rgba(10,16,15,0.90);
      border-radius: 999px;
      background: #ff5f68;
      color: white;
      box-shadow: 0 3px 10px rgba(255,95,104,0.30);
      font: 900 9px/1 Tahoma, Verdana, "Segoe UI", sans-serif;
      letter-spacing: 0;
    }

    #chat-dock-button.has-unread #chat-unread-badge {
      display: flex;
      animation: chat-unread-pop 220ms cubic-bezier(.2,.8,.2,1);
    }

    @keyframes chat-unread-pop {
      0% { transform: scale(0.72); opacity: 0.25; }
      100% { transform: scale(1); opacity: 1; }
    }

    #chat-log {
      display: flex;
      flex-direction: column;
      gap: 4px;
      max-height: 142px;
      min-height: 34px;
      overflow-y: auto;
      padding: 2px 3px 7px;
      scrollbar-width: thin;
    }

    .chat-line {
      font-size: 11px;
      line-height: 1.35;
      overflow-wrap: anywhere;
      color: rgba(244, 233, 212, 0.94);
    }

    .chat-line-name {
      margin-right: 5px;
      color: #d8ddd9;
      font-weight: 900;
      text-shadow: 0 0 10px currentColor;
    }

    .chat-line-name.is-team-bottom-top {
      color: #67d7ff;
    }

    .chat-line-name.is-team-right-left {
      color: #ffb45f;
    }

    .chat-line.is-system {
      color: rgba(255, 221, 139, 0.86);
      font-style: italic;
    }

    #chat-form {
      display: grid;
      grid-template-columns: 36px minmax(0, 1fr) auto;
      gap: 5px;
      align-items: center;
    }

    #chat-input {
      min-width: 0;
      border: 1px solid rgba(233, 194, 126, 0.20);
      border-radius: 9px;
      padding: 8px 10px;
      outline: none;
      background: rgba(255, 242, 214, 0.05);
      color: #fff7e8;
      font: 600 11px/1 "Trebuchet MS", "Segoe UI", sans-serif;
    }

    #chat-input:focus {
      border-color: rgba(244, 201, 109, 0.58);
      box-shadow: 0 0 0 1px rgba(244, 201, 109, 0.22);
    }

    #social-panel button {
      border: 1px solid rgba(233, 194, 126, 0.22);
      border-radius: 9px;
      padding: 8px 9px;
      background: linear-gradient(180deg, rgba(104, 72, 30, 0.24), rgba(50, 35, 17, 0.34));
      color: #f6ead0;
      font: 900 10px/1 "Trebuchet MS", "Segoe UI", sans-serif;
      letter-spacing: 0.06em;
      cursor: pointer;
    }

    #social-panel button:hover:not(:disabled) {
      border-color: rgba(244, 201, 109, 0.58);
      background: linear-gradient(180deg, rgba(126, 88, 35, 0.32), rgba(58, 40, 18, 0.40));
    }

    #social-panel button:disabled {
      opacity: 0.36;
      cursor: default;
    }

    #emoji-toggle-button {
      padding: 5px !important;
      font-size: 18px !important;
    }

    #emoji-drawer {
      display: none;
      grid-template-columns: repeat(6, 1fr);
      gap: 4px;
      margin-bottom: 6px;
      padding: 7px;
      border-radius: 10px;
      border: 1px solid rgba(233, 194, 126, 0.12);
      background: rgba(20, 13, 8, 0.28);
    }

    #emoji-drawer.is-open {
      display: grid;
    }

    #emoji-drawer button {
      padding: 5px !important;
      font-size: 18px !important;
      line-height: 1 !important;
    }

    #poke-current-button {
      width: 100%;
      margin-top: 6px;
      border-color: rgba(255, 198, 91, 0.34) !important;
      color: #ffd98c !important;
    }
  `
  document.head.appendChild(style)
}

ensureTopUiStyle()

function setHudPanelCollapsed(collapsed) {
  hudPanelCollapsed = Boolean(collapsed)
  hud.classList.toggle('is-collapsed', hudPanelCollapsed)
  hudPanelToggle.setAttribute('aria-expanded', String(!hudPanelCollapsed))
  hudPanelToggle.title = hudPanelCollapsed ? 'Menüyü aç' : 'Menüyü kapat'
}

function updateHudPanelSummary() {
  const gameState = state.publicGameState

  if (!gameState) {
    const count = Array.isArray(state.connectedPlayers)
      ? state.connectedPlayers.length
      : 0
    hudPanelSummary.textContent = `${count}/4 oyuncu`
    return
  }

  if (gameState.phase === 'match-ended') {
    hudPanelSummary.textContent = 'Maç bitti'
    return
  }

  if (gameState.phase === 'waiting') {
    hudPanelSummary.textContent = 'Lobi'
    return
  }

  const round = Number(gameState.round) || 0
  const stock = Number(gameState.stockCount) || 0
  hudPanelSummary.textContent = `R${round} · ${stock} balya`
}

hudPanelToggle.addEventListener('click', () => {
  setHudPanelCollapsed(!hudPanelCollapsed)
})

function getLobbyPlayers() {
  // Lobby isim/hazir state'i players-state ile anlik gelir. Oyun waiting'deyken
  // publicGameState bir onceki roster snapshot'ini tasiyabilecegi icin once
  // connectedPlayers tercih edilir.
  if (Array.isArray(state.connectedPlayers) && state.connectedPlayers.length > 0) {
    return state.connectedPlayers
  }
  return Array.isArray(state.publicGameState?.players)
    ? state.publicGameState.players
    : []
}

function getLocalLobbyPlayer() {
  return getLobbyPlayers().find(player => player.id === state.localPlayerId) || null
}

function isLobbyPhase() {
  const phase = state.publicGameState?.phase
  return !phase || phase === 'waiting' || phase === 'match-ended'
}

function renderLobbyReadyControls() {
  const players = getLobbyPlayers()
  const localPlayer = getLocalLobbyPlayer()
  const show = Boolean(localPlayer && isLobbyPhase())

  lobbyReadyPanel.style.display = show ? 'block' : 'none'
  if (!show) {
    readyPlayerButton.classList.remove('is-ready')
    readyPlayerButton.disabled = true
    return
  }

  lobbyReadyStatus.innerHTML = players.map(player => {
    const ready = Boolean(player.isBot || player.ready)
    const classes = [
      'lobby-ready-chip',
      ready ? 'is-ready' : '',
      player.isBot ? 'is-bot' : '',
    ].filter(Boolean).join(' ')

    const suffix = player.isBot
      ? 'BOT · HAZIR'
      : ready
        ? 'HAZIR'
        : 'BEKLİYOR'

    return `<span class="${classes}">${escapeHtml(player.name)} · ${suffix}</span>`
  }).join('')

  const isReady = Boolean(localPlayer.ready)
  const tableIsFull = players.length === 4
  renamePlayerButton.disabled = !botSocket || isReady
  readyPlayerButton.disabled = !botSocket || !tableIsFull
  readyPlayerButton.classList.toggle('is-ready', isReady && tableIsFull)
  readyPlayerButton.textContent = !tableIsFull
    ? '4 OYUNCU BEKLENİYOR'
    : isReady
      ? 'HAZIRLIĞI İPTAL'
      : 'HAZIR'
}

function renderBotControls() {
  const players = getLobbyPlayers()
  const botCount = players.filter(player => player.isBot).length

  // Bot kontrolleri oyun sırasında da görünür ve kullanılabilir. Boş koltuk
  // yoksa yalnız EKLE, bot yoksa yalnız ÇIKAR pasif olur.
  addBotButton.disabled = !botSocket || players.length >= 4
  removeBotButton.disabled = !botSocket || botCount <= 0
  botControls.style.display = 'flex'
}

function renderKickControls() {
  const humans = getLobbyPlayers().filter(player => !player.isBot)
  const targets = humans.filter(player => player.id !== state.localPlayerId)
  const previousTarget = kickTargetSelect.value

  kickTargetSelect.innerHTML = ''

  for (const player of targets) {
    const option = document.createElement('option')
    option.value = player.id
    option.textContent = player.name
    kickTargetSelect.appendChild(option)
  }

  if (targets.some(player => player.id === previousTarget)) {
    kickTargetSelect.value = previousTarget
  }

  kickControls.style.display = targets.length > 0 ? 'flex' : 'none'
  kickTargetSelect.disabled = targets.length === 0 || Boolean(kickVoteState)
  kickStartButton.disabled =
    !botSocket ||
    targets.length === 0 ||
    Boolean(kickVoteState)

  if (!kickVoteState) {
    kickVotePanel.style.display = 'none'
    return
  }

  const alreadyVoted = Boolean(
    kickVoteState.yesVoterIds?.includes(state.localPlayerId) ||
    kickVoteState.noVoterIds?.includes(state.localPlayerId)
  )
  const isTarget = kickVoteState.targetId === state.localPlayerId

  kickVoteText.textContent =
    `${kickVoteState.targetName} için kick oylaması: ` +
    `${kickVoteState.yesVotes}/${kickVoteState.requiredVotes} EVET`

  kickVotePanel.style.display = 'block'
  kickVoteYes.disabled = !botSocket || isTarget || alreadyVoted
  kickVoteNo.disabled = !botSocket || isTarget || alreadyVoted
}

function getCurrentTurnPlayer() {
  const currentSeat = state.publicGameState?.currentSeat
  if (!currentSeat) return null

  return (state.publicGameState?.players || []).find(
    player => player.seat === currentSeat
  ) || null
}

function renderSocialControls() {
  const current = getCurrentTurnPlayer()
  const canPoke = Boolean(
    botSocket &&
    state.publicGameState?.phase === 'playing' &&
    current &&
    !current.isBot &&
    current.id !== state.localPlayerId
  )

  pokeCurrentButton.disabled = !canPoke
  pokeCurrentButton.textContent = canPoke
    ? `DÜRT ${current.name}`
    : state.publicGameState?.currentSeat === state.localSeat
      ? 'SIRA SENDE'
      : 'DÜRT'
}

function renderChatMinimizedState() {
  socialPanel.classList.toggle('is-minimized', chatMinimized)
  chatDockButton.classList.toggle('is-visible', chatMinimized)
  chatDockButton.classList.toggle('has-unread', chatUnreadCount > 0)

  const unreadLabel = chatUnreadCount > 9 ? '9+' : String(chatUnreadCount)
  chatUnreadBadge.textContent = chatUnreadCount > 0 ? unreadLabel : ''

  const openLabel = chatUnreadCount > 0
    ? `Sohbeti aç (${chatUnreadCount} okunmamış mesaj)`
    : 'Sohbeti aç'
  chatDockButton.setAttribute('aria-label', openLabel)
  chatDockButton.title = openLabel
  chatMinimizeButton.setAttribute('aria-expanded', String(!chatMinimized))
}

function setChatMinimized(minimized) {
  chatMinimized = Boolean(minimized)

  if (chatMinimized) {
    emojiDrawer.classList.remove('is-open')
  }
  else {
    chatUnreadCount = 0
  }

  renderChatMinimizedState()

  if (!chatMinimized) {
    requestAnimationFrame(() => {
      chatLog.scrollTop = chatLog.scrollHeight
    })
  }
}

function markChatUnread(isOwnMessage = false) {
  if (!chatMinimized || isOwnMessage) return
  chatUnreadCount = Math.min(99, chatUnreadCount + 1)
  renderChatMinimizedState()
}

chatMinimizeButton.onclick = () => setChatMinimized(true)
chatDockButton.onclick = () => setChatMinimized(false)
renderChatMinimizedState()

function appendChatNode(node) {
  chatLog.appendChild(node)
  while (chatLog.children.length > CHAT_MAX_VISIBLE_MESSAGES) {
    chatLog.firstElementChild?.remove()
  }
  chatLog.scrollTop = chatLog.scrollHeight
}

function getChatTeamClass(message = {}) {
  // Önce oyuncunun GÜNCEL seat'ini kullan. Lobby seat swap sonrası eski chat
  // satırlarının rengi de yeni takımını takip etsin; mesajın gönderildiği eski
  // seat yalnız roster henüz bilinmiyorsa fallback olarak kullanılır.
  const player = getLobbyPlayers().find(item => item.id === message.playerId)
  const liveSeat = String(player?.seat || '')
  const seat = liveSeat || String(message.seat || '')

  if (seat === 'player-bottom' || seat === 'player-top') {
    return 'is-team-bottom-top'
  }

  if (seat === 'player-right' || seat === 'player-left') {
    return 'is-team-right-left'
  }

  const teamId = String(player?.teamId || '')
  if (teamId === 'team-bottom-top') return 'is-team-bottom-top'
  if (teamId === 'team-right-left') return 'is-team-right-left'
  return ''
}

function refreshChatTeamColors() {
  for (const line of chatLog.querySelectorAll('.chat-line[data-player-id]')) {
    const name = line.querySelector('.chat-line-name')
    if (!name) continue

    name.classList.remove('is-team-bottom-top', 'is-team-right-left')
    const teamClass = getChatTeamClass({
      playerId: line.dataset.playerId || '',
      seat: line.dataset.seat || '',
    })
    if (teamClass) name.classList.add(teamClass)
  }
}

export function appendChatMessage(message = {}) {
  const text = String(message.text || '').trim()
  if (!text) return

  const line = document.createElement('div')
  line.className = 'chat-line'
  line.dataset.playerId = String(message.playerId || '')
  line.dataset.seat = String(message.seat || '')

  const name = document.createElement('span')
  name.className = 'chat-line-name'
  const teamClass = getChatTeamClass(message)
  if (teamClass) name.classList.add(teamClass)
  name.textContent = `${message.name || 'Oyuncu'}:`

  const body = document.createElement('span')
  body.textContent = text

  line.append(name, body)
  appendChatNode(line)

  const isOwnMessage = Boolean(
    message.playerId &&
    state.localPlayerId &&
    message.playerId === state.localPlayerId
  )
  markChatUnread(isOwnMessage)
}

export function appendSystemChatMessage(text) {
  const value = String(text || '').trim()
  if (!value) return

  const line = document.createElement('div')
  line.className = 'chat-line is-system'
  line.textContent = value
  appendChatNode(line)
}

function renderSeatSwapOffer() {
  const offer = seatSwapOfferState
  const visible = Boolean(offer?.requestId)

  seatSwapOfferPanel.classList.toggle('is-visible', visible)
  if (!visible) {
    seatSwapOfferText.textContent = ''
    seatSwapAcceptButton.disabled = false
    seatSwapDeclineButton.disabled = false
    return
  }

  seatSwapOfferText.textContent =
    `${offer.sourceName || 'Bir oyuncu'} sizinle yer değiştirmek istiyor.`
}

function clearSeatSwapOffer(requestId = null) {
  if (
    requestId &&
    seatSwapOfferState?.requestId &&
    seatSwapOfferState.requestId !== requestId
  ) {
    return
  }

  seatSwapOfferState = null
  renderSeatSwapOffer()
}

function renderTurnBanner() {
  const isMine = Boolean(
    state.publicGameState?.phase === 'playing' &&
    state.localSeat &&
    state.publicGameState?.currentSeat === state.localSeat
  )

  turnBanner.classList.toggle('is-visible', isMine)
}

export function setupBotControls(socket) {
  botSocket = socket

  seatSwapAcceptButton.onclick = () => {
    if (!botSocket || !seatSwapOfferState?.requestId) return

    const requestId = seatSwapOfferState.requestId
    seatSwapAcceptButton.disabled = true
    seatSwapDeclineButton.disabled = true

    botSocket.emit('seat-swap-response', { requestId, accept: true }, result => {
      if (!result?.ok) {
        setMessage(result?.message || 'Yer değiştirme isteği kabul edilemedi.')
      }
      clearSeatSwapOffer(requestId)
    })
  }

  seatSwapDeclineButton.onclick = () => {
    if (!botSocket || !seatSwapOfferState?.requestId) return

    const requestId = seatSwapOfferState.requestId
    seatSwapAcceptButton.disabled = true
    seatSwapDeclineButton.disabled = true

    botSocket.emit('seat-swap-response', { requestId, accept: false }, result => {
      if (!result?.ok) {
        setMessage(result?.message || 'Yer değiştirme isteği reddedilemedi.')
      }
      clearSeatSwapOffer(requestId)
    })
  }

  if (!emojiDrawer.dataset.initialized) {
    emojiDrawer.dataset.initialized = '1'
    for (const emoji of SOCIAL_EMOJIS) {
      const button = document.createElement('button')
      button.type = 'button'
      button.textContent = emoji
      button.dataset.emoji = emoji
      emojiDrawer.appendChild(button)
    }
  }

  emojiToggleButton.onclick = () => {
    emojiDrawer.classList.toggle('is-open')
  }

  emojiDrawer.onclick = event => {
    const button = event.target.closest('button[data-emoji]')
    if (!button || !botSocket) return

    const emoji = button.dataset.emoji
    botSocket.emit('player-emoji', emoji, result => {
      if (!result?.ok) {
        setMessage(result?.message || 'Emoji gönderilemedi.')
      }
    })
    emojiDrawer.classList.remove('is-open')
  }

  chatForm.onsubmit = event => {
    event.preventDefault()
    if (!botSocket) return

    const text = chatInput.value.trim()
    if (!text) return

    chatSendButton.disabled = true
    botSocket.emit('chat-message', text, result => {
      chatSendButton.disabled = false
      if (!result?.ok) {
        setMessage(result?.message || 'Mesaj gönderilemedi.')
        return
      }
      chatInput.value = ''
      chatInput.focus()
    })
  }

  pokeCurrentButton.onclick = () => {
    if (!botSocket || pokeCurrentButton.disabled) return
    pokeCurrentButton.disabled = true
    botSocket.emit('poke-current-player', result => {
      if (!result?.ok) {
        setMessage(result?.message || 'Oyuncu dürtülemedi.')
      }
      renderSocialControls()
    })
  }

  renamePlayerButton.onclick = () => {
    const localPlayer = getLocalLobbyPlayer()
    if (!botSocket || !localPlayer || localPlayer.ready) return

    const requested = window.prompt('Yeni nick:', localPlayer.name)
    if (requested == null) return

    renamePlayerButton.disabled = true
    botSocket.emit('rename-player', requested, result => {
      if (!result?.ok) {
        setMessage(result?.message || 'Nick değiştirilemedi.')
      }
      else {
        try {
          window.localStorage.setItem('okey101-player-name', result.name)
        } catch {}
        setMessage(`Nick değiştirildi: ${result.name}`)
      }
      renderLobbyReadyControls()
    })
  }

  readyPlayerButton.onclick = () => {
    const localPlayer = getLocalLobbyPlayer()
    if (!botSocket || !localPlayer) return

    readyPlayerButton.disabled = true
    botSocket.emit('set-ready', !localPlayer.ready, result => {
      if (!result?.ok) {
        setMessage(result?.message || 'Hazır durumu değiştirilemedi.')
      }
      else if (result.started) {
        setMessage('Herkes hazır. Oyun başlıyor.')
      }
      renderLobbyReadyControls()
    })
  }

  addBotButton.onclick = () => {
    if (!botSocket || addBotButton.disabled) return
    addBotButton.disabled = true

    const safetyTimer = window.setTimeout(() => {
      updateHUD()
    }, 1800)

    botSocket.emit('add-bot', result => {
      window.clearTimeout(safetyTimer)

      if (Array.isArray(result?.players)) {
        state.connectedPlayers = result.players
      }

      if (!result?.ok) {
        setMessage(result?.message || 'Bot eklenemedi.')
      }

      updateHUD()
    })
  }

  removeBotButton.onclick = () => {
    if (!botSocket || removeBotButton.disabled) return
    removeBotButton.disabled = true

    const safetyTimer = window.setTimeout(() => {
      updateHUD()
    }, 1800)

    botSocket.emit('remove-bot', result => {
      window.clearTimeout(safetyTimer)

      if (Array.isArray(result?.players)) {
        state.connectedPlayers = result.players
      }

      if (!result?.ok) {
        setMessage(result?.message || 'Bot çıkarılamadı.')
      }

      updateHUD()
    })
  }

  kickStartButton.onclick = () => {
    const targetId = kickTargetSelect.value
    if (!botSocket || !targetId) return

    kickStartButton.disabled = true
    botSocket.emit('start-kick-vote', targetId, result => {
      if (!result?.ok) {
        setMessage(result?.message || 'Kick oylaması başlatılamadı.')
      }
      renderKickControls()
    })
  }

  kickVoteYes.onclick = () => {
    if (!botSocket) return
    botSocket.emit('kick-vote', { yes: true }, result => {
      if (!result?.ok) setMessage(result?.message || 'Oy gönderilemedi.')
    })
  }

  kickVoteNo.onclick = () => {
    if (!botSocket) return
    botSocket.emit('kick-vote', { yes: false }, result => {
      if (!result?.ok) setMessage(result?.message || 'Oy gönderilemedi.')
    })
  }

  botSocket.on('seat-swap-offer', offer => {
    if (!offer?.requestId) return
    seatSwapOfferState = offer
    renderSeatSwapOffer()
  })

  botSocket.on('seat-swap-cancelled', data => {
    clearSeatSwapOffer(data?.requestId || null)

    if (data?.sourcePlayerId === state.localPlayerId) {
      if (data.reason === 'declined') {
        setMessage(`${data.targetName || 'Oyuncu'} yer değiştirme isteğini reddetti.`)
      }
      else if (data.reason === 'expired') {
        setMessage('Yer değiştirme isteğinin süresi doldu.')
      }
      else if (data.reason === 'requester-ready') {
        setMessage('Hazır verdiğin için yer değiştirme isteği iptal edildi.')
      }
    }
  })

  botSocket.on('seat-swap-completed', data => {
    clearSeatSwapOffer()
    const otherName = data?.sourcePlayerId === state.localPlayerId
      ? data?.targetName
      : data?.sourceName
    setMessage(`${otherName || 'Oyuncu'} ile yer değiştirdiniz.`)
  })

  botSocket.on('kick-vote-state', voteState => {
    kickVoteState = voteState || null
    renderKickControls()
  })

  botSocket.on('kick-vote-passed', data => {
    if (data?.targetName) {
      setMessage(`${data.targetName} çoğunluk oyuyla masadan çıkarıldı.`)
    }
  })

  botSocket.on('kicked', data => {
    setMessage(data?.message || 'Masa oylamasıyla oyundan çıkarıldın.')
  })

  renderLobbyReadyControls()
  renderBotControls()
  renderKickControls()
  renderSocialControls()
}

// =====================================================
// PUAN DEFTERI
// =====================================================

const NOTEBOOK_STYLE_ID = 'score-notebook-style'
const SEAT_ORDER = [
  'player-bottom',
  'player-right',
  'player-top',
  'player-left',
]

const TEAM_LAYOUT = [
  { id: 'team-bottom-top', seats: ['player-bottom', 'player-top'] },
  { id: 'team-right-left', seats: ['player-right', 'player-left'] },
]

const MATCH_RESULTS_STYLE_ID = 'match-results-style'

function ensureMatchResultsStyle() {
  if (document.getElementById(MATCH_RESULTS_STYLE_ID)) return

  const style = document.createElement('style')
  style.id = MATCH_RESULTS_STYLE_ID
  style.textContent = `
    #match-results-overlay {
      position: fixed;
      inset: 0;
      z-index: 140;
      display: none;
      place-items: center;
      padding: 24px;
      box-sizing: border-box;
      background: rgba(8, 10, 9, 0.52);
      backdrop-filter: blur(5px);
      pointer-events: auto;
    }

    #match-results-card {
      width: min(620px, calc(100vw - 40px));
      overflow: hidden;
      border: 1px solid rgba(255,255,255,0.22);
      border-radius: 20px;
      background: rgba(20, 24, 22, 0.96);
      box-shadow: 0 24px 70px rgba(0,0,0,0.46);
      color: #f5f0df;
      font-family: "Segoe UI", sans-serif;
    }

    .match-results-head {
      padding: 22px 24px 16px;
      border-bottom: 1px solid rgba(255,255,255,0.10);
      text-align: center;
    }

    .match-results-title {
      margin: 0;
      font-size: 25px;
      font-weight: 900;
      letter-spacing: 0.06em;
    }

    .match-results-subtitle {
      margin-top: 7px;
      color: rgba(255,255,255,0.62);
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }

    .match-results-list {
      display: grid;
      gap: 8px;
      padding: 14px;
    }

    .match-results-actions {
      display: flex;
      justify-content: center;
      padding: 0 14px 16px;
    }

    #match-results-continue {
      min-width: 150px;
      border: 1px solid rgba(104, 238, 159, 0.52);
      border-radius: 10px;
      padding: 10px 20px;
      background: rgba(35, 112, 68, 0.24);
      color: #a8f5c5;
      font: 900 12px/1 "Segoe UI", sans-serif;
      letter-spacing: 0.08em;
      cursor: pointer;
    }

    #match-results-continue:hover {
      background: rgba(42, 139, 82, 0.34);
    }

    .match-result-row {
      display: grid;
      grid-template-columns: 54px minmax(0, 1fr) auto;
      align-items: center;
      gap: 12px;
      min-height: 52px;
      padding: 9px 13px;
      border: 1px solid rgba(255,255,255,0.09);
      border-radius: 12px;
      background: rgba(255,255,255,0.035);
    }

    .match-result-row.is-winner {
      border-color: rgba(255, 218, 92, 0.52);
      background: rgba(255, 218, 92, 0.09);
    }

    .match-result-rank {
      color: rgba(255,255,255,0.66);
      font-size: 20px;
      font-weight: 900;
      text-align: center;
    }

    .match-result-name {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-size: 16px;
      font-weight: 800;
    }

    .match-result-winner {
      display: inline-block;
      margin-left: 8px;
      padding: 3px 7px;
      border-radius: 999px;
      background: #e8c95c;
      color: #201b08;
      font-size: 9px;
      font-weight: 900;
      letter-spacing: 0.08em;
      vertical-align: middle;
    }

    .match-result-score {
      min-width: 72px;
      text-align: right;
      font-size: 19px;
      font-weight: 900;
      font-variant-numeric: tabular-nums;
    }
  `
  document.head.appendChild(style)
}

ensureMatchResultsStyle()

const matchResultsOverlay = document.createElement('div')
matchResultsOverlay.id = 'match-results-overlay'
matchResultsOverlay.setAttribute('aria-live', 'polite')
matchResultsOverlay.innerHTML = '<div id="match-results-card"></div>'
document.body.appendChild(matchResultsOverlay)
const matchResultsCard = document.getElementById('match-results-card')
let matchResultsDismissed = false

function renderMatchResults() {
  const gameState = state.publicGameState
  if (!gameState || gameState.phase !== 'match-ended') {
    matchResultsDismissed = false
    matchResultsOverlay.style.display = 'none'
    matchResultsCard.innerHTML = ''
    return
  }

  if (matchResultsDismissed) {
    matchResultsOverlay.style.display = 'none'
    return
  }

  const teams = buildHudTeams(gameState)
    .filter(team => team.members.length > 0)
    .sort((a, b) => a.totalScore - b.totalScore)

  // Maç sonucu ekranda gösterilen takım toplamlarıyla aynı kaynaktan
  // hesaplanır. Böylece eski/stale matchWinners veya matchWinnerTeams
  // snapshot'ları ikinci sıradaki takımı yanlışlıkla kazanan yapamaz.
  const bestTeamScore = teams.length > 0
    ? Math.min(...teams.map(team => Number(team.totalScore) || 0))
    : null
  const winnerTeams = new Set(
    bestTeamScore === null
      ? []
      : teams
          .filter(team => (Number(team.totalScore) || 0) === bestTeamScore)
          .map(team => team.id)
  )

  matchResultsCard.innerHTML = `
    <div class="match-results-head">
      <h2 class="match-results-title">MAÇ TAMAMLANDI</h2>
      <div class="match-results-subtitle">${escapeHtml(gameState.maxRounds || 5)} raund · eşli oyun</div>
    </div>
    <div class="match-results-list">
      ${teams.map((team, index) => `
        <div class="match-result-row ${winnerTeams.has(team.id) ? 'is-winner' : ''}">
          <div class="match-result-rank">${index + 1}.</div>
          <div class="match-result-name">
            ${teamHasLocalPlayer(team) ? '★ ' : ''}${escapeHtml(teamDisplayName(team))}
            ${winnerTeams.has(team.id) ? '<span class="match-result-winner">KAZANAN TAKIM</span>' : ''}
          </div>
          <div class="match-result-score">${formatScore(team.totalScore)}</div>
        </div>
      `).join('')}
    </div>
    <div class="match-results-actions">
      <button id="match-results-continue" type="button">DEVAM ET</button>
    </div>
  `

  const continueButton = document.getElementById('match-results-continue')
  if (continueButton) {
    continueButton.onclick = () => {
      if (!botSocket || continueButton.disabled) return

      // Sonuç ekranını yalnız local olarak kapatmak yerine server'dan gerçek
      // lobby reset'i isteriz. Yeni waiting snapshot gelene kadar overlay açık
      // kalır; ağ hatasında oyuncu yarım-resetlenmiş bir ekranda kalmaz.
      continueButton.disabled = true
      continueButton.textContent = 'LOBİYE DÖNÜLÜYOR…'

      botSocket.emit('return-to-lobby', result => {
        if (!result?.ok) {
          continueButton.disabled = false
          continueButton.textContent = 'DEVAM ET'
          setMessage(result?.message || 'Lobiye dönülemedi.')
          return
        }

        setMessage('Lobiye dönüldü. Yeni maç için yeniden hazır verin.')
      })
    }
  }

  matchResultsOverlay.style.display = 'grid'
}

function ensureNotebookStyle() {
  if (document.getElementById(NOTEBOOK_STYLE_ID)) {
    return
  }

  const style = document.createElement('style')
  style.id = NOTEBOOK_STYLE_ID
  style.textContent = `
    #score-notebook {
      position: fixed;
      top: 14px;
      right: 14px;
      z-index: 60;
      width: min(760px, calc(100vw - 28px));
      max-height: min(76vh, 720px);
      border: 1px solid rgba(92, 67, 26, 0.62);
      border-radius: 10px 4px 12px 6px;
      box-shadow:
        0 12px 32px rgba(0, 0, 0, 0.34),
        inset 0 0 0 1px rgba(255, 255, 255, 0.42);
      color: #342712;
      overflow: hidden;
      transform-origin: top right;
      transition:
        width 160ms ease,
        max-height 180ms ease,
        box-shadow 180ms ease;
      font-family:
        "Trebuchet MS",
        "Segoe UI",
        sans-serif;
    }

    #score-notebook:not(.is-open) {
      width: 178px;
      max-height: 42px;
      box-shadow:
        0 7px 20px rgba(0, 0, 0, 0.27),
        inset 0 0 0 1px rgba(255, 255, 255, 0.36);
    }

    #score-notebook-toggle {
      position: relative;
      width: 100%;
      height: 42px;
      border: 0;
      border-bottom: 1px solid rgba(95, 70, 31, 0.34);
      padding: 0 42px 0 19px;
      background:
        linear-gradient(
          90deg,
          rgba(184, 59, 48, 0.25) 0,
          rgba(184, 59, 48, 0.25) 2px,
          transparent 2px
        ) 28px 0 / 2px 100% no-repeat,
        #e6c873;
      color: #35260f;
      font: inherit;
      font-size: 14px;
      font-weight: 800;
      letter-spacing: 0.02em;
      text-align: left;
      cursor: pointer;
      user-select: none;
    }

    #score-notebook-toggle:hover {
      background-color: #eed588;
    }

    #score-notebook-toggle::after {
      content: "▾";
      position: absolute;
      right: 15px;
      top: 10px;
      font-size: 18px;
      line-height: 20px;
      transform: rotate(0deg);
      transition: transform 160ms ease;
    }

    #score-notebook.is-open
    #score-notebook-toggle::after {
      transform: rotate(180deg);
    }

    #score-notebook-body {
      position: relative;
      box-sizing: border-box;
      max-height: calc(min(76vh, 720px) - 42px);
      overflow: auto;
      padding: 14px 14px 18px 42px;
      background:
        linear-gradient(
          90deg,
          transparent 0 31px,
          rgba(196, 69, 63, 0.36) 31px 33px,
          transparent 33px
        ),
        repeating-linear-gradient(
          0deg,
          rgba(98, 127, 153, 0.14) 0,
          rgba(98, 127, 153, 0.14) 1px,
          transparent 1px,
          transparent 25px
        ),
        #f5e9bd;
    }

    #score-notebook:not(.is-open)
    #score-notebook-body {
      display: none;
    }

    #score-notebook-body::before {
      content: "";
      position: absolute;
      left: 9px;
      top: 7px;
      bottom: 7px;
      width: 14px;
      background:
        radial-gradient(
          circle,
          rgba(64, 52, 28, 0.72) 0 2px,
          transparent 2.5px
        )
        50% 4px / 12px 24px repeat-y;
      opacity: 0.65;
      pointer-events: none;
    }

    .score-notebook-summary,
    .score-notebook-round-grid {
      --score-player-count: 4;
      display: grid;
      grid-template-columns:
        repeat(
          var(--score-player-count),
          minmax(0, 1fr)
        );
      gap: 8px;
    }

    .score-notebook-summary {
      position: sticky;
      top: -14px;
      z-index: 3;
      margin: -2px 0 14px;
      padding: 8px 0 10px;
      background:
        linear-gradient(
          180deg,
          rgba(245, 233, 189, 0.98) 75%,
          rgba(245, 233, 189, 0)
        );
    }

    .score-notebook-player-head {
      min-width: 0;
      padding: 7px 7px 6px;
      border-bottom: 2px solid rgba(82, 61, 29, 0.46);
      text-align: center;
    }

    .score-notebook-player-name {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-size: 13px;
      font-weight: 900;
    }

    .score-notebook-player-total {
      margin-top: 3px;
      font-size: 18px;
      font-weight: 900;
      font-variant-numeric: tabular-nums;
    }

    .score-notebook-round {
      margin-top: 13px;
      padding-top: 8px;
      border-top: 1px dashed rgba(76, 54, 22, 0.38);
    }

    .score-notebook-round-title {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 12px;
      margin: 0 0 7px;
      font-size: 12px;
      font-weight: 900;
      letter-spacing: 0.04em;
      text-transform: uppercase;
    }

    .score-notebook-round-title small {
      opacity: 0.65;
      font-size: 10px;
      font-weight: 700;
      text-transform: none;
    }

    .score-notebook-cell {
      min-width: 0;
      min-height: 72px;
      padding: 6px 7px;
      border-left: 1px solid rgba(83, 62, 31, 0.20);
    }

    .score-notebook-cell:first-child {
      border-left: 0;
    }

    .score-notebook-line {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 6px;
      margin: 0 0 5px;
      font-size: 11px;
      line-height: 1.24;
    }

    .score-notebook-line-label {
      min-width: 0;
      overflow-wrap: anywhere;
    }

    .score-notebook-amount {
      font-weight: 900;
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
    }

    .score-notebook-line.is-penalty {
      color: #9d2c24;
      font-weight: 700;
    }

    .score-notebook-line.is-empty {
      display: block;
      opacity: 0.52;
      font-style: italic;
    }

    .score-notebook-round-total {
      display: flex;
      justify-content: space-between;
      gap: 6px;
      margin-top: 7px;
      padding-top: 6px;
      border-top: 1px solid rgba(77, 56, 27, 0.30);
      font-size: 12px;
      font-weight: 900;
      font-variant-numeric: tabular-nums;
    }

    .score-notebook-empty {
      padding: 15px 5px 9px;
      opacity: 0.60;
      font-size: 12px;
      text-align: center;
    }

    @media (max-width: 760px) {
      #score-notebook {
        top: 8px;
        right: 8px;
        width: calc(100vw - 16px);
      }

      #score-notebook:not(.is-open) {
        width: 166px;
      }

      #score-notebook-body {
        padding-left: 32px;
      }

      .score-notebook-summary,
      .score-notebook-round-grid {
        gap: 4px;
      }

      .score-notebook-player-head,
      .score-notebook-cell {
        padding-left: 4px;
        padding-right: 4px;
      }

      .score-notebook-player-name {
        font-size: 11px;
      }

      .score-notebook-player-total {
        font-size: 15px;
      }

      .score-notebook-line {
        display: block;
        font-size: 10px;
      }

      .score-notebook-amount {
        display: block;
        margin-top: 1px;
      }
    }
  `

  document.head.appendChild(style)
}

ensureNotebookStyle()

const ALT_RETRO_STYLE_ID = 'okey-alt-retro-ui-style'

function ensureAltRetroStyle() {
  if (document.getElementById(ALT_RETRO_STYLE_ID)) return

  const style = document.createElement('style')
  style.id = ALT_RETRO_STYLE_ID
  style.textContent = `
    :root {
      --retro-ink: #101614;
      --retro-panel: #182421;
      --retro-panel-deep: #0f1816;
      --retro-cream: #f7f2e7;
      --retro-muted: #c7d0cb;
      --retro-amber: #ffd166;
      --retro-red: #ff8f7d;
      --retro-green: #9be27d;
      --retro-line: rgba(247, 242, 231, 0.28);
      --retro-dark-line: rgba(0, 0, 0, 0.52);
    }

    #game-hud {
      position: fixed;
      top: 16px;
      left: 16px;
      z-index: 90;
      width: min(326px, calc(100vw - 32px));
      border: 2px solid #0b1311;
      border-radius: 8px;
      background-color: var(--retro-panel);
      background-image:
        repeating-linear-gradient(0deg, rgba(255,255,255,0.018) 0 1px, transparent 1px 4px),
        repeating-linear-gradient(90deg, rgba(0,0,0,0.026) 0 1px, transparent 1px 5px),
        linear-gradient(180deg, rgba(255,255,255,0.026), transparent 38%);
      box-shadow:
        5px 6px 0 rgba(0, 0, 0, 0.62),
        0 18px 40px rgba(0,0,0,0.28),
        inset 0 0 0 1px rgba(234,223,189,0.14);
      backdrop-filter: none;
    }

    #game-hud::before {
      content: '';
      position: absolute;
      inset: 5px;
      border: 1px solid rgba(234,223,189,0.10);
      border-radius: 4px;
      pointer-events: none;
    }

    #game-hud::after {
      content: '';
      position: absolute;
      inset: 0;
      border-radius: 6px;
      pointer-events: none;
      opacity: 0.22;
      background-image: radial-gradient(rgba(234,223,189,0.16) 0.55px, transparent 0.7px);
      background-size: 4px 4px;
      mix-blend-mode: soft-light;
    }

    #game-hud.is-collapsed {
      width: min(270px, calc(100vw - 32px));
      border-color: #0b1311;
      box-shadow: 4px 5px 0 rgba(8,15,14,0.66), 0 12px 28px rgba(0,0,0,0.25), inset 0 0 0 1px rgba(234,223,189,0.11);
    }

    #hud-panel-toggle {
      min-height: 49px;
      padding: 10px 11px 10px 13px;
      border-radius: 6px 6px 2px 2px;
      background: rgba(10, 24, 21, 0.42);
      border-bottom: 1px solid rgba(234,223,189,0.16);
      color: var(--retro-cream);
      font-family: "Tahoma", "Verdana", "Segoe UI", sans-serif;
      transition: background 150ms ease, transform 180ms ease;
    }

    #game-hud.is-collapsed #hud-panel-toggle { border-radius: 6px; }
    #hud-panel-toggle:hover { background: rgba(7, 20, 18, 0.60); transform: none; }
    #hud-panel-toggle:focus-visible { box-shadow: inset 0 0 0 2px rgba(224,180,90,0.56); }

    .hud-panel-status-dot {
      width: 9px;
      height: 9px;
      flex-basis: 9px;
      background: var(--retro-amber);
      border-radius: 2px;
      box-shadow: 0 0 0 1px rgba(21,36,32,0.9), 0 0 9px rgba(224,180,90,0.34);
    }

    .hud-panel-title {
      color: var(--retro-cream);
      font: 900 12px/1 "Tahoma", "Verdana", "Segoe UI", sans-serif;
      letter-spacing: 0.14em;
      text-shadow: 1px 1px 0 rgba(0,0,0,0.45);
    }

    #hud-panel-summary {
      max-width: 145px;
      color: #d9dfdc;
      border-left-color: rgba(234,223,189,0.18);
      font: 700 9px/1 "Tahoma", "Verdana", "Segoe UI", sans-serif;
      letter-spacing: 0.08em;
    }

    .hud-panel-chevron {
      width: 25px;
      height: 25px;
      flex-basis: 25px;
      border-radius: 3px;
      border: 1px solid rgba(234,223,189,0.22);
      background: #22332f;
      color: var(--retro-cream);
      box-shadow: 2px 2px 0 rgba(5,12,11,0.45);
      font-family: "Tahoma", "Verdana", "Segoe UI", sans-serif;
    }

    #hud-panel-content-inner {
      padding: 8px 9px 10px;
      scrollbar-color: rgba(224,180,90,0.38) transparent;
    }

    #game-hud.is-collapsed #hud-panel-content-inner { padding-top: 0; padding-bottom: 0; }

    #game-info,
    #lobby-ready-panel,
    #kick-vote-panel {
      border-radius: 4px;
      border: 1px solid rgba(234,223,189,0.18);
      background-color: rgba(10, 24, 21, 0.38);
      background-image: repeating-linear-gradient(0deg, rgba(255,255,255,0.012) 0 1px, transparent 1px 3px);
      color: var(--retro-cream);
      box-shadow: inset 0 0 0 1px rgba(4,12,10,0.20);
    }

    #game-info {
      font-family: "Tahoma", "Verdana", "Segoe UI", sans-serif;
      line-height: 1.45;
    }

    #lobby-ready-status {
      font-family: "Tahoma", "Verdana", "Segoe UI", sans-serif;
    }

    .lobby-ready-chip {
      border-radius: 3px;
      border: 1px solid rgba(234,223,189,0.18);
      background: rgba(233,222,188,0.045);
      color: #eee7d7;
      box-shadow: 1px 1px 0 rgba(0,0,0,0.20);
    }

    .lobby-ready-chip.is-ready {
      color: #b8f09a;
      border-color: rgba(155,226,125,0.62);
      background: rgba(88,132,70,0.26);
    }

    .lobby-ready-chip.is-bot {
      color: #cde5df;
      border-color: rgba(135,169,158,0.42);
    }

    #lobby-ready-panel button,
    #bot-controls button,
    #kick-controls select,
    #kick-controls button,
    #kick-vote-panel button,
    #social-panel button {
      border-radius: 3px;
      border: 1px solid #12231f;
      border-top-color: rgba(234,223,189,0.24);
      border-left-color: rgba(234,223,189,0.18);
      background: #2b403b;
      color: var(--retro-cream);
      box-shadow: 2px 2px 0 rgba(4,11,10,0.45);
      font: 900 10px/1 "Tahoma", "Verdana", "Segoe UI", sans-serif;
      letter-spacing: 0.055em;
      text-transform: uppercase;
      transition: transform 80ms ease, background 120ms ease, color 120ms ease;
    }

    #lobby-ready-panel button:hover:not(:disabled),
    #bot-controls button:hover:not(:disabled),
    #kick-controls button:hover:not(:disabled),
    #kick-vote-panel button:hover:not(:disabled),
    #social-panel button:hover:not(:disabled) {
      transform: translate(-1px, -1px);
      background: #3a5750;
      border-color: #172b27;
    }

    #lobby-ready-panel button:active:not(:disabled),
    #bot-controls button:active:not(:disabled),
    #kick-controls button:active:not(:disabled),
    #kick-vote-panel button:active:not(:disabled),
    #social-panel button:active:not(:disabled) {
      transform: translate(1px, 1px);
      box-shadow: none;
    }

    #ready-player-button { color: #b8f09a !important; border-top-color: rgba(167,198,136,0.42) !important; }
    #ready-player-button.is-ready { color: #ffd978 !important; border-top-color: rgba(224,180,90,0.50) !important; }
    #kick-start-button, #kick-vote-yes { color: #ff9f91 !important; }

    #control-hint {
      color: rgba(230, 234, 230, 0.78) !important;
      font-family: "Tahoma", "Verdana", "Segoe UI", sans-serif !important;
      letter-spacing: 0.01em;
    }

    #game-message {
      color: #ffe08b !important;
      font-family: "Tahoma", "Verdana", "Segoe UI", sans-serif !important;
    }

    #turn-banner {
      top: calc(100% + 9px);
      padding: 8px 12px;
      border-radius: 3px;
      border: 1px solid #263b35;
      background: #ffd166;
      color: #101614;
      text-shadow: none;
      box-shadow: 3px 4px 0 rgba(5,13,11,0.52), 0 8px 18px rgba(0,0,0,0.20);
      font: 900 16px/1 "Tahoma", "Verdana", "Segoe UI", sans-serif;
      letter-spacing: 0.13em;
    }

    #dealing-banner {
      border-radius: 4px;
      border: 2px solid #0b1311;
      background-color: #203632;
      background-image: repeating-linear-gradient(0deg, rgba(255,255,255,0.018) 0 1px, transparent 1px 4px);
      color: #ffe79a;
      text-shadow: none;
      box-shadow: 6px 7px 0 rgba(4,12,10,0.62), 0 20px 42px rgba(0,0,0,0.32);
      font-family: "Tahoma", "Verdana", "Segoe UI", sans-serif;
      letter-spacing: 0.12em;
    }

    #social-panel {
      width: min(348px, calc(100vw - 28px));
      border: 2px solid #0b1311;
      border-radius: 7px;
      background-color: #203632;
      background-image:
        repeating-linear-gradient(0deg, rgba(255,255,255,0.016) 0 1px, transparent 1px 4px),
        repeating-linear-gradient(90deg, rgba(0,0,0,0.018) 0 1px, transparent 1px 5px);
      color: var(--retro-cream);
      box-shadow: 4px 5px 0 rgba(5,13,11,0.60), 0 14px 30px rgba(0,0,0,0.25), inset 0 0 0 1px rgba(234,223,189,0.10);
      backdrop-filter: none;
      font-family: "Tahoma", "Verdana", "Segoe UI", sans-serif;
    }

    #chat-log {
      border-bottom: 1px dashed rgba(234,223,189,0.16);
      margin-bottom: 7px;
      padding-bottom: 8px;
    }

    .chat-line {
      color: #f0eadc;
      font-family: "Tahoma", "Verdana", "Segoe UI", sans-serif;
      font-size: 11px;
    }

    .chat-line-name {
      text-shadow: none;
      font-weight: 900;
    }

    .chat-line-name.is-team-bottom-top { color: #79d9ff; }
    .chat-line-name.is-team-right-left { color: #ffb66e; }
    .chat-line.is-system { color: #ffe08a; font-style: normal; }

    #chat-input {
      border-radius: 3px;
      border: 1px solid rgba(234,223,189,0.20);
      background: #111c19;
      color: #fffaf0;
      font: 700 11px/1 "Tahoma", "Verdana", "Segoe UI", sans-serif;
      box-shadow: inset 1px 1px 0 rgba(0,0,0,0.22);
    }

    #chat-input::placeholder { color: rgba(235, 238, 233, 0.55); }
    #chat-input:focus { border-color: rgba(224,180,90,0.58); box-shadow: inset 1px 1px 0 rgba(0,0,0,0.22), 0 0 0 1px rgba(224,180,90,0.16); }

    #emoji-drawer {
      border-radius: 3px;
      border: 1px dashed rgba(234,223,189,0.18);
      background: rgba(8,19,17,0.32);
    }

    #poke-current-button {
      color: #ffd166 !important;
      border-top-color: rgba(224,180,90,0.42) !important;
    }

    @media (max-width: 640px) {
      #game-hud { top: 10px; left: 10px; width: min(316px, calc(100vw - 20px)); }
      #social-panel { right: 10px; bottom: 10px; width: min(340px, calc(100vw - 20px)); }
      #chat-dock-button { right: 10px; bottom: 10px; }
    }
  `
  document.head.appendChild(style)
}

ensureAltRetroStyle()

const LIGHT_GLASS_UI_STYLE_ID = 'okey-light-glass-ui-style'

function ensureLightGlassUiStyle() {
  if (document.getElementById(LIGHT_GLASS_UI_STYLE_ID)) return

  const style = document.createElement('style')
  style.id = LIGHT_GLASS_UI_STYLE_ID
  style.textContent = `
    #game-hud {
      border: 1px solid rgba(235, 240, 238, 0.14);
      border-radius: 13px;
      background: rgba(13, 19, 18, 0.52);
      background-image: linear-gradient(180deg, rgba(255,255,255,0.035), rgba(255,255,255,0.008));
      box-shadow: 0 10px 28px rgba(0,0,0,0.20), inset 0 1px 0 rgba(255,255,255,0.055);
      backdrop-filter: blur(14px) saturate(0.92);
      -webkit-backdrop-filter: blur(14px) saturate(0.92);
    }

    #game-hud::before {
      inset: 4px;
      border-radius: 9px;
      border-color: rgba(255,255,255,0.045);
    }

    #game-hud::after { display: none; }

    #game-hud.is-collapsed {
      border-color: rgba(235,240,238,0.12);
      box-shadow: 0 8px 22px rgba(0,0,0,0.17), inset 0 1px 0 rgba(255,255,255,0.045);
    }

    #hud-panel-toggle {
      min-height: 45px;
      border-radius: 12px 12px 7px 7px;
      border-bottom-color: rgba(255,255,255,0.07);
      background: rgba(255,255,255,0.018);
    }

    #game-hud.is-collapsed #hud-panel-toggle { border-radius: 12px; }
    #hud-panel-toggle:hover { background: rgba(255,255,255,0.045); }

    .hud-panel-status-dot {
      border-radius: 50%;
      background: #f1c96f;
      box-shadow: 0 0 8px rgba(241,201,111,0.26);
    }

    .hud-panel-chevron {
      border-radius: 7px;
      border-color: rgba(255,255,255,0.10);
      background: rgba(255,255,255,0.04);
      box-shadow: none;
    }

    #hud-panel-content-inner { padding: 7px 9px 9px; }

    #game-info,
    #lobby-ready-panel,
    #kick-vote-panel {
      border-radius: 8px;
      border-color: rgba(255,255,255,0.085);
      background: rgba(8, 14, 13, 0.26);
      background-image: none;
      box-shadow: none;
      backdrop-filter: blur(5px);
      -webkit-backdrop-filter: blur(5px);
    }

    .lobby-ready-chip {
      border-radius: 999px;
      border-color: rgba(255,255,255,0.10);
      background: rgba(255,255,255,0.045);
      box-shadow: none;
    }

    #lobby-ready-panel button,
    #bot-controls button,
    #kick-controls select,
    #kick-controls button,
    #kick-vote-panel button {
      border-radius: 7px;
      border: 1px solid rgba(255,255,255,0.10);
      background: rgba(255,255,255,0.055);
      color: #f5f7f6;
      box-shadow: none;
      text-transform: none;
    }

    #lobby-ready-panel button:hover:not(:disabled),
    #bot-controls button:hover:not(:disabled),
    #kick-controls button:hover:not(:disabled),
    #kick-vote-panel button:hover:not(:disabled) {
      transform: none;
      border-color: rgba(255,255,255,0.18);
      background: rgba(255,255,255,0.09);
    }

    #turn-banner {
      border-radius: 8px;
      border: 1px solid rgba(255, 218, 127, 0.20);
      background: rgba(19, 20, 14, 0.72);
      color: #ffe08d;
      box-shadow: 0 8px 20px rgba(0,0,0,0.18);
      backdrop-filter: blur(9px);
      -webkit-backdrop-filter: blur(9px);
    }

    #dealing-banner {
      border-radius: 12px;
      border: 1px solid rgba(255,255,255,0.12);
      background: rgba(12, 18, 17, 0.58);
      box-shadow: 0 12px 30px rgba(0,0,0,0.20);
      backdrop-filter: blur(14px);
      -webkit-backdrop-filter: blur(14px);
    }

    #social-panel {
      width: min(344px, calc(100vw - 28px));
      padding: 9px;
      border: 1px solid rgba(235, 240, 238, 0.12);
      border-radius: 13px;
      background: rgba(10, 16, 15, 0.38);
      background-image: linear-gradient(180deg, rgba(255,255,255,0.022), rgba(255,255,255,0.004));
      color: #f3f6f5;
      box-shadow: 0 8px 24px rgba(0,0,0,0.16), inset 0 1px 0 rgba(255,255,255,0.04);
      backdrop-filter: blur(16px) saturate(0.90);
      -webkit-backdrop-filter: blur(16px) saturate(0.90);
    }

    #chat-log {
      border-bottom: 1px solid rgba(255,255,255,0.055);
      margin-bottom: 6px;
      padding-bottom: 7px;
    }

    .chat-line { color: rgba(245,248,247,0.90); }
    .chat-line.is-system { color: rgba(255,224,151,0.90); }

    #chat-input {
      border-radius: 8px;
      border: 1px solid rgba(255,255,255,0.09);
      background: rgba(255,255,255,0.045);
      color: #fff;
      box-shadow: none;
    }

    #chat-input:focus {
      border-color: rgba(255,255,255,0.20);
      box-shadow: 0 0 0 1px rgba(255,255,255,0.05);
    }

    #social-panel button {
      border-radius: 8px;
      border: 1px solid rgba(255,255,255,0.09);
      background: rgba(255,255,255,0.045);
      color: #f5f7f6;
      box-shadow: none;
      text-transform: none;
    }

    #social-panel button:hover:not(:disabled) {
      transform: none;
      border-color: rgba(255,255,255,0.17);
      background: rgba(255,255,255,0.08);
    }

    #emoji-drawer {
      border-radius: 9px;
      border: 1px solid rgba(255,255,255,0.07);
      background: rgba(0,0,0,0.14);
    }

    #poke-current-button {
      color: #ffe19a !important;
      border-color: rgba(255,225,154,0.13) !important;
      background: rgba(255,225,154,0.045) !important;
    }

    #social-panel-header {
      border-bottom-color: rgba(255,255,255,0.055);
    }

    #chat-minimize-button {
      border: 1px solid rgba(255,255,255,0.075) !important;
      background: rgba(255,255,255,0.035) !important;
      color: rgba(245,248,247,0.70) !important;
      box-shadow: none !important;
    }

    #chat-minimize-button:hover {
      border-color: rgba(255,255,255,0.16) !important;
      background: rgba(255,255,255,0.075) !important;
      color: #fff !important;
    }
  `

  document.head.appendChild(style)
}

ensureLightGlassUiStyle()

const scoreNotebook = document.createElement('aside')
scoreNotebook.id = 'score-notebook'
scoreNotebook.setAttribute(
  'aria-label',
  'Puan defteri'
)

scoreNotebook.innerHTML = `
  <button
    id="score-notebook-toggle"
    type="button"
    aria-expanded="false"
  >
    📒 Puan Defteri
  </button>

  <div id="score-notebook-body"></div>
`

document.body.appendChild(scoreNotebook)

const notebookToggle =
  document.getElementById(
    'score-notebook-toggle'
  )

const notebookBody =
  document.getElementById(
    'score-notebook-body'
  )

let notebookOpen = false

function setNotebookOpen(open) {
  notebookOpen = Boolean(open)

  scoreNotebook.classList.toggle(
    'is-open',
    notebookOpen
  )

  notebookToggle.setAttribute(
    'aria-expanded',
    String(notebookOpen)
  )
}

notebookToggle.addEventListener(
  'click',
  () => {
    setNotebookOpen(
      !notebookOpen
    )
  }
)

window.addEventListener(
  'keydown',
  event => {
    if (
      event.key === 'Escape' &&
      notebookOpen
    ) {
      setNotebookOpen(false)
    }
  }
)

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

function formatTileColorTurkish(color) {
  const normalized = String(color || '').toLowerCase()

  const names = {
    black: 'Siyah',
    red: 'Kırmızı',
    blue: 'Mavi',
    yellow: 'Sarı'
  }

  return names[normalized] || color || '-'
}

function formatScore(amount) {
  const number = Number(amount) || 0

  if (number > 0) {
    return `+${number}`
  }

  return String(number)
}

function buildHudTeams(gameState) {
  const players = gameState?.players || []
  const playerById = new Map(players.map(player => [player.id, player]))
  const playerBySeat = new Map(players.map(player => [player.seat, player]))
  const publicTeamById = new Map(
    (gameState?.teams || []).map(team => [team.id, team])
  )

  return TEAM_LAYOUT.map(layout => {
    const publicTeam = publicTeamById.get(layout.id)
    const members = publicTeam?.playerIds?.length
      ? publicTeam.playerIds.map(id => playerById.get(id)).filter(Boolean)
      : layout.seats.map(seat => playerBySeat.get(seat)).filter(Boolean)

    const totalScore = Number.isFinite(Number(publicTeam?.totalScore))
      ? Number(publicTeam.totalScore)
      : members.reduce(
          (sum, player) => sum + (Number(player.totalScore) || 0),
          0
        )

    return {
      id: layout.id,
      seats: layout.seats,
      members,
      totalScore,
      roundScores: Array.isArray(publicTeam?.roundScores)
        ? publicTeam.roundScores
        : [],
    }
  })
}

function teamDisplayName(team) {
  const names = team.members.map(member => member.name).filter(Boolean)
  return names.length ? names.join(' + ') : 'Takım bekleniyor'
}

function teamHasLocalPlayer(team) {
  return team.members.some(member => member.id === state.localPlayerId)
}

function prefixPlayerScoreItems(player, items) {
  return (Array.isArray(items) ? items : []).map(item => ({
    ...item,
    label: `${player.name} — ${item.label}`,
  }))
}

function getTeamLedgerEntry(team, ledgerIndex) {
  const memberEntries = team.members
    .map(player => ({
      player,
      entry: player.scoreLedger?.[ledgerIndex] || null,
    }))
    .filter(({ entry }) => Boolean(entry))

  if (!memberEntries.length) return null

  const representative = memberEntries[0].entry
  return {
    round: representative.round,
    reason: representative.reason,
    cancelled: memberEntries.every(({ entry }) => Boolean(entry.cancelled)),
    total: memberEntries.reduce(
      (sum, { entry }) => sum + (Number(entry.total) || 0),
      0
    ),
    items: memberEntries.flatMap(({ player, entry }) =>
      prefixPlayerScoreItems(player, entry.items)
    ),
  }
}

function sortNotebookPlayers(players) {
  return [...players].sort(
    (a, b) =>
      SEAT_ORDER.indexOf(a.seat) -
      SEAT_ORDER.indexOf(b.seat)
  )
}

function reasonText(reason) {
  switch (reason) {
    case 'player-finished':
      return 'Oyuncu bitirdi'
    case 'elden-finished':
      return 'Elden bitiş'
    case 'stock-exhausted':
      return 'Balya bitti'
    case 'all-four-opened-pairs':
      return 'Tur iptal'
    default:
      return ''
  }
}

function renderNotebookLines(items) {
  if (!Array.isArray(items) || items.length === 0) {
    return `
      <div class="score-notebook-line is-empty">
        Ceza / puan kalemi yok
      </div>
    `
  }

  return items
    .map(item => `
      <div
        class="
          score-notebook-line
          ${
            item.kind === 'penalty'
              ? 'is-penalty'
              : ''
          }
        "
      >
        <span class="score-notebook-line-label">
          ${escapeHtml(item.label)}
        </span>

        <span class="score-notebook-amount">
          ${formatScore(item.amount)}
        </span>
      </div>
    `)
    .join('')
}

function renderScoreNotebook() {
  const gameState = state.publicGameState
  const teams = buildHudTeams(gameState)

  if (!teams.some(team => team.members.length > 0)) {
    notebookBody.innerHTML = `
      <div class="score-notebook-empty">
        Oyuncular bekleniyor...
      </div>
    `
    return
  }

  const teamCount = 2

  const summary = `
    <div
      class="score-notebook-summary"
      style="--score-player-count:${teamCount}"
    >
      ${teams.map(team => `
        <div class="score-notebook-player-head">
          <div class="score-notebook-player-name">
            ${teamHasLocalPlayer(team) ? '★ ' : ''}${escapeHtml(teamDisplayName(team))}
          </div>

          <div class="score-notebook-player-total">
            ${formatScore(team.totalScore)}
          </div>
        </div>
      `).join('')}
    </div>
  `

  const currentRoundHasPenalty =
    gameState?.phase === 'playing' &&
    teams.some(team =>
      team.members.some(player =>
        Array.isArray(player.currentPenaltyEntries) &&
        player.currentPenaltyEntries.length > 0
      )
    )

  let currentRoundHtml = ''

  if (currentRoundHasPenalty) {
    currentRoundHtml = `
      <section class="score-notebook-round">
        <div class="score-notebook-round-title">
          <span>Tur ${gameState.round} · Bu tur</span>
          <small>Henüz takım toplamına eklenmedi</small>
        </div>

        <div
          class="score-notebook-round-grid"
          style="--score-player-count:${teamCount}"
        >
          ${teams.map(team => {
            const entries = team.members.flatMap(player =>
              prefixPlayerScoreItems(
                player,
                (player.currentPenaltyEntries || []).map(entry => ({
                  ...entry,
                  kind: 'penalty',
                }))
              )
            )

            const pending = entries.reduce(
              (total, entry) => total + (Number(entry.amount) || 0),
              0
            )

            return `
              <div class="score-notebook-cell">
                ${
                  entries.length
                    ? renderNotebookLines(entries)
                    : `
                      <div class="score-notebook-line is-empty">
                        Ceza yok
                      </div>
                    `
                }

                <div class="score-notebook-round-total">
                  <span>Takım cezası</span>
                  <span>${formatScore(pending)}</span>
                </div>
              </div>
            `
          }).join('')}
        </div>
      </section>
    `
  }

  const maxLedgerLength = teams.reduce(
    (max, team) => Math.max(
      max,
      ...team.members.map(player => player.scoreLedger?.length || 0)
    ),
    0
  )

  const completedRounds = []

  for (let ledgerIndex = maxLedgerLength - 1; ledgerIndex >= 0; ledgerIndex--) {
    const entries = teams.map(team => getTeamLedgerEntry(team, ledgerIndex))
    const representative = entries.find(Boolean)

    if (!representative) continue

    completedRounds.push(`
      <section class="score-notebook-round">
        <div class="score-notebook-round-title">
          <span>
            Tur ${escapeHtml(representative.round)}
            ${representative.cancelled ? ' · İptal' : ''}
          </span>

          <small>${escapeHtml(reasonText(representative.reason))}</small>
        </div>

        <div
          class="score-notebook-round-grid"
          style="--score-player-count:${teamCount}"
        >
          ${entries.map(entry => `
            <div class="score-notebook-cell">
              ${
                entry
                  ? renderNotebookLines(entry.items)
                  : `
                    <div class="score-notebook-line is-empty">
                      Kayıt yok
                    </div>
                  `
              }

              <div class="score-notebook-round-total">
                <span>Takım tur toplamı</span>
                <span>${entry ? formatScore(entry.total) : '-'}</span>
              </div>
            </div>
          `).join('')}
        </div>
      </section>
    `)
  }

  notebookBody.innerHTML = `
    ${summary}
    ${currentRoundHtml}
    ${
      completedRounds.length
        ? completedRounds.join('')
        : `
          <div class="score-notebook-empty">
            Tamamlanmış tur henüz yok.
          </div>
        `
    }
  `
}

export function showRoundEndBanner(text, durationMs = 1050) {
  const message = String(text || '').trim()
  if (!message) return

  if (roundEndBannerTimer) {
    clearTimeout(roundEndBannerTimer)
  }

  roundEndBannerText.textContent = message
  roundEndBanner.classList.remove('is-visible')
  // Aynı frame'de yeni round-end gelirse transition'ın tekrar tetiklenebilmesi için.
  void roundEndBanner.offsetWidth
  roundEndBanner.classList.add('is-visible')

  roundEndBannerTimer = setTimeout(() => {
    roundEndBanner.classList.remove('is-visible')
    roundEndBannerTimer = null
  }, Math.max(700, Number(durationMs) || 1050))
}

export function showDealingBanner(durationMs = 4050) {
  if (dealingBannerTimer) {
    clearTimeout(dealingBannerTimer)
  }

  dealingBanner.classList.add('is-visible')
  dealingBannerTimer = setTimeout(() => {
    dealingBanner.classList.remove('is-visible')
    dealingBannerTimer = null
  }, Math.max(450, Number(durationMs) || 4050))
}

export function setMessage(text) {
  gameMessage.textContent =
    text || ''
}

export function updateHUD() {
  updateHudPanelSummary()
  renderLobbyReadyControls()
  renderBotControls()
  renderKickControls()
  renderSocialControls()
  refreshChatTeamColors()
  renderTurnBanner()
  renderScoreNotebook()
  renderMatchResults()

  if (!state.publicGameState) {
    const connectedCount = Array.isArray(state.connectedPlayers)
      ? state.connectedPlayers.length
      : 0

    const humans = getLobbyPlayers().filter(player => !player.isBot)
    const readyHumans = humans.filter(player => player.ready).length
    gameInfo.innerHTML = connectedCount >= 4
      ? `<b>4/4 oyuncu</b> · hazır bekleniyor (${readyHumans}/${humans.length})`
      : `<b>${connectedCount}/4 oyuncu</b> bekleniyor…`
    return
  }

  if (state.publicGameState.phase === 'waiting' || state.publicGameState.phase === 'match-ended') {
    const lobbyPlayers = getLobbyPlayers()
    const humans = lobbyPlayers.filter(player => !player.isBot)
    const readyHumans = humans.filter(player => player.ready).length
    gameInfo.innerHTML = `<b>${lobbyPlayers.length}/4 oyuncu</b> · hazır bekleniyor (${readyHumans}/${humans.length})`
    scoreBoard.innerHTML = ''
    return
  }

  const currentPlayer =
    state.publicGameState.players?.find(
      player =>
        player.seat ===
        state.publicGameState.currentSeat
    )

  const joker =
    state.publicGameState.joker

  gameInfo.innerHTML = `
    <b>Raund:</b>
    ${state.publicGameState.round}
    /
    ${state.publicGameState.maxRounds}

    &nbsp; | &nbsp;

    <b>Sıra:</b>
    <span style="color:#67f29a;font-weight:900">
      ${escapeHtml(currentPlayer?.name || '-')}
    </span>

    &nbsp; | &nbsp;

    <b>Balya:</b>
    ${state.publicGameState.stockCount}

    <br>

    <b>Okey:</b>
    ${
      joker
        ? `${formatTileColorTurkish(joker.color)} ${joker.number}`
        : '-'
    }
  `

  // Sol üst HUD'u kompakt tutuyoruz. Oyuncu isimleri zaten avatarların
  // üzerinde ve puan defterinde mevcut; burada ikinci bir oyuncu listesi yok.
  scoreBoard.innerHTML = ''
}
