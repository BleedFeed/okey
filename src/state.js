export const state = {
  currentTableId: null,
  tableList: [],
  matchmakingMode: true,
  returningToMatchmaker: false,
  localPlayerId: null,
  localSeat: null,
  connectedPlayers: [],
  publicGameState: null,
  privateHandState: null,
  selectedTileId: null,

  rackRows: [[], []],
  manualTilePositions: new Map(),
  forcedGroupsByRow: [[], []],
  layoutMode: 'manual',

  isDraggingTile: false,
  dragStarted: false,
  draggedTileId: null,
  draggedObject: null,
  draggedSourceRow: null,

  // Masa üstündeki deste / atık taşı isteği sunucudan cevap beklerken.
  isTableInteracting: false,
  pendingTablePickup: null,

  // Ortadan veya atık kulesinden alınmış, henüz ıstakaya bırakılmamış taş.
  stickyPickupTileId: null,
  isStickyPickup: false,
  stickyPickupSource: null,
  stickyPickupReturnSeat: null,
  stickyPickupReturnIndex: null,

  // Yandan alınan taş ıstakaya konduktan sonra geldiği kuleye geri bırakılabilir.
  returnableDiscardTileId: null,
  returnableDiscardSeat: null,
  returnableDiscardIndex: null,
  returnDiscardDropReady: false,

  pointerClientX: 0,
  pointerClientY: 0,

  // Açma alanında henüz server'a gönderilmemiş gruplar.
  stagedOpenGroups: [],
  stagedOpenTileIds: new Set(),
  localOpenedFallbackGroups: [],
  openingInFlight: false,

  // Üst kamera + masa sürükleme ortak durumu.
  overviewProgress: 0,
  overviewFocusSeat: null,
  activeRackDragMode: null,
  activeRackDragKind: null,
  openBoardDragCaptured: false,
  openBoardDragReady: false,
  boardInspectorDragActive: false,

  // Her koltuğun bu raundda kaç taş attığını istemci tarafında izler.
  discardCountsBySeat: {
    'player-bottom': 0,
    'player-right': 0,
    'player-top': 0,
    'player-left': 0,
  },

  mouseX: 0,
  mouseY: 0,
  lastSentLook: 0,

  baseYaw: 0,
  currentYaw: 0,
  currentPitch: -0.48,
}
