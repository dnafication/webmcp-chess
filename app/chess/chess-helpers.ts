import { Chess } from 'chess.js'

export type SupportStatus = 'checking' | 'ready' | 'unsupported' | 'error'
export type PlayerColor = 'w' | 'b'
export type PromotionPiece = 'q' | 'r' | 'b' | 'n'
export type PendingPromotion = { from: string; to: string }
export type MoveResult =
  | { ok: true; san: string }
  | { ok: false; reason: string }
export type StoredState = { pgn: string; humanColor: PlayerColor }
export type BoardSnapshot = {
  fen: string
  history: string[]
  statusText: string
}
// A coached move suggestion drawn as a colored arrow, with an optional reason shown in the panel below the board.
export type CoachSuggestion = {
  from: string
  to: string
  reason?: string
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

// Captured once per mutation (never read from render) so render stays pure.
export function snapshotOf(chess: Chess): BoardSnapshot {
  return {
    fen: chess.fen(),
    history: chess.history(),
    statusText: describeStatus(chess)
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
