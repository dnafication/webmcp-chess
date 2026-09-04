import { Chess, type PieceSymbol } from 'chess.js'

export type SupportStatus = 'checking' | 'ready' | 'unsupported' | 'error'
export type PlayerColor = 'w' | 'b'
export type PromotionPiece = 'q' | 'r' | 'b' | 'n'
export type PendingPromotion = { from: string; to: string }
export type MoveResult =
  | { ok: true; san: string }
  | { ok: false; reason: string }
export type StoredState = { pgn: string; humanColor: PlayerColor }
export type CapturedPiece = Exclude<PieceSymbol, 'k'>
export type MaterialSummary = {
  // Pieces each side has captured, ordered by descending value.
  capturedByWhite: CapturedPiece[]
  capturedByBlack: CapturedPiece[]
  // Net material on the board, from White's perspective. 0 when level.
  advantage: number
}
export type BoardSnapshot = {
  fen: string
  history: string[]
  statusText: string
  checkSquare: string | null
  turn: PlayerColor
  isGameOver: boolean
  material: MaterialSummary
}
// A coached move suggestion drawn as a colored arrow, with an optional reason shown in the panel below the board.
export type CoachSuggestion = {
  from: string
  to: string
  reason?: string
  // Engine evaluation for this move, e.g. "+0.34" or "M3", shown beside the arrow's entry.
  evalText?: string
  color: string
}

export const STORAGE_KEY = 'webmcp-chess-state'
export const MAX_SUGGESTED_MOVES = 5
// One distinct, readable color per suggested move (cycled if there were ever more than the max).
export const ARROW_PALETTE = [
  '#2563eb', // blue
  '#dc2626', // red
  '#059669', // emerald
  '#d97706', // amber
  '#7c3aed' // violet
]

export function colorName(color: PlayerColor): string {
  return color === 'w' ? 'White' : 'Black'
}

export function opponentColor(color: PlayerColor): PlayerColor {
  return color === 'w' ? 'b' : 'w'
}

// Shared status text so the on-page label and the agent tool response stay identical.
export function describeStatus(chess: Chess): string {
  if (chess.isCheckmate()) {
    return `Checkmate — ${colorName(opponentColor(chess.turn()))} wins.`
  }
  if (chess.isStalemate()) return 'Stalemate — draw.'
  if (chess.isDraw()) return 'Draw.'
  if (chess.isCheck()) return `Check! ${colorName(chess.turn())} to move.`
  return `${colorName(chess.turn())} to move.`
}

// The square of the king currently in check, or null. Drives the check highlight and king shake.
export function findCheckedKingSquare(chess: Chess): string | null {
  if (!chess.isCheck()) return null
  const color = chess.turn()
  for (const row of chess.board()) {
    for (const cell of row) {
      if (cell && cell.type === 'k' && cell.color === color) return cell.square
    }
  }
  return null
}

export const PIECE_VALUES: Record<CapturedPiece, number> = {
  p: 1,
  n: 3,
  b: 3,
  r: 5,
  q: 9
}

// Outline for White, filled for Black, so the two sides read apart at text size.
export const PIECE_GLYPHS: Record<PlayerColor, Record<CapturedPiece, string>> = {
  w: { p: '♙', n: '♘', b: '♗', r: '♖', q: '♕' },
  b: { p: '♟', n: '♞', b: '♝', r: '♜', q: '♛' }
}

// Captures (for the strips) and net material on the board (for the +N figure) come from two
// different sources — the board total is the only one that reflects promotions correctly.
export function materialSummaryOf(chess: Chess): MaterialSummary {
  const capturedByWhite: CapturedPiece[] = []
  const capturedByBlack: CapturedPiece[] = []
  for (const move of chess.history({ verbose: true })) {
    if (!move.captured) continue
    const captured = move.captured as CapturedPiece
    if (move.color === 'w') capturedByWhite.push(captured)
    else capturedByBlack.push(captured)
  }
  const byValueDescending = (a: CapturedPiece, b: CapturedPiece) =>
    PIECE_VALUES[b] - PIECE_VALUES[a]
  capturedByWhite.sort(byValueDescending)
  capturedByBlack.sort(byValueDescending)

  let whiteTotal = 0
  let blackTotal = 0
  for (const row of chess.board()) {
    for (const cell of row) {
      if (!cell || cell.type === 'k') continue
      const value = PIECE_VALUES[cell.type as CapturedPiece]
      if (cell.color === 'w') whiteTotal += value
      else blackTotal += value
    }
  }

  return {
    capturedByWhite,
    capturedByBlack,
    advantage: whiteTotal - blackTotal
  }
}

// Captured once per mutation (never read from render) so render stays pure.
export function snapshotOf(chess: Chess): BoardSnapshot {
  return {
    fen: chess.fen(),
    history: chess.history(),
    statusText: describeStatus(chess),
    checkSquare: findCheckedKingSquare(chess),
    turn: chess.turn(),
    isGameOver: chess.isGameOver(),
    material: materialSummaryOf(chess)
  }
}

export function loadStoredState(): StoredState | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<StoredState>
    if (
      typeof parsed.pgn !== 'string' ||
      (parsed.humanColor !== 'w' && parsed.humanColor !== 'b')
    ) {
      return null
    }
    return { pgn: parsed.pgn, humanColor: parsed.humanColor }
  } catch {
    return null
  }
}

export function createGame(stored: StoredState | null): Chess {
  const chess = new Chess()
  if (stored?.pgn) {
    try {
      chess.loadPgn(stored.pgn)
    } catch {
      // Ignore a corrupted save and fall back to the starting position.
    }
  }
  return chess
}

export function asPromotion(value: unknown): PromotionPiece | undefined {
  return value === 'q' || value === 'r' || value === 'b' || value === 'n'
    ? value
    : undefined
}

export function asPlayerColor(value: unknown): PlayerColor | undefined {
  return value === 'w' || value === 'b' ? value : undefined
}
