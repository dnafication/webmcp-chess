import { Chess } from 'chess.js'
import type { PlayerColor, PromotionPiece } from './chess-helpers'

// Pure helpers for turning raw UCI engine output into something a human and a
// language model can both read. No worker, no React, no side effects — every
// function here is a plain transform, which is what makes them testable.

// A single evaluation, carried in both perspectives on purpose.
//
// UCI reports scores from the perspective of the side to move; every chess UI
// (and every human) reads them from White's. Conflating the two is the one bug
// in this feature that would ship silently and then confidently coach someone
// into a losing move, so both readings travel together and are named for it.
export type Score = {
  /** Centipawns from the side-to-move's perspective. Raw UCI value. */
  cp: number | null
  /** Moves to mate from the side-to-move's perspective. Raw UCI value. */
  mateIn: number | null
  /** Centipawns from White's perspective. Positive favours White. */
  cpWhite: number | null
  /** Moves to mate from White's perspective. Positive means White mates. */
  mateInWhite: number | null
  /** Human-readable, always from White's perspective: "+0.34", "-1.10", "M3", "-M2". */
  display: string
}

export type EngineLine = {
  /** MultiPV index; 1 is the engine's preferred move. */
  rank: number
  uci: string
  san: string
  from: string
  to: string
  promotion: PromotionPiece | null
  score: Score
  pvUci: string[]
  pvSan: string[]
}

export type AnalysisResult = {
  fen: string
  turn: PlayerColor
  depthReached: number
  timeMs: number
  nodes: number
  bestMoveUci: string | null
  lines: EngineLine[]
}

export type MoveClass =
  | 'best'
  | 'excellent'
  | 'good'
  | 'inaccuracy'
  | 'mistake'
  | 'blunder'

// The verdict on one played move. Shared by the review tool and the badge the
// move history renders, so the wording can't drift between them.
export type MoveReview = {
  moveSan: string
  moveUci: string
  playedBy: PlayerColor
  classification: MoveClass
  centipawnLoss: number
  /** Index into the game history, or null for a hypothetical move. */
  historyIndex: number | null
}

// A parsed UCI `info` line. Every field is optional because Stockfish emits
// plenty of partial lines (`info depth 1 seldepth 1 ...` with no pv at all).
export type InfoLine = {
  depth: number | null
  multipv: number
  cp: number | null
  mateIn: number | null
  nodes: number | null
  nps: number | null
  timeMs: number | null
  pv: string[]
}

export type EngineSettings = {
  /** UCI Skill Level, 0-20. Only ever applied to the agent's own play. */
  skillLevel: number
  /** Search depth used when no explicit depth is passed. */
  depth: number
  /** Wall-clock cap for a single search. */
  movetimeMs: number
}

export const DEFAULT_ENGINE_SETTINGS: EngineSettings = {
  skillLevel: 20,
  depth: 16,
  movetimeMs: 1500
}

export const MAX_SKILL_LEVEL = 20
export const MIN_ANALYSIS_DEPTH = 4
export const MAX_ANALYSIS_DEPTH = 22
export const DEFAULT_ANALYSIS_DEPTH = 16
export const DEFAULT_REVIEW_DEPTH = 14
export const MAX_MULTI_PV = 5
export const DEFAULT_MULTI_PV = 3
export const MIN_MOVETIME_MS = 100
export const MAX_MOVETIME_MS = 15_000

// Centipawn loss thresholds. These are a widely used convention (Lichess and
// friends land in the same neighbourhood), not an official standard — tool
// responses say so rather than presenting them as fact.
const CLASS_THRESHOLDS: { limit: number; label: MoveClass }[] = [
  { limit: 20, label: 'best' },
  { limit: 50, label: 'excellent' },
  { limit: 100, label: 'good' },
  { limit: 200, label: 'inaccuracy' },
  { limit: 300, label: 'mistake' }
]

export const CLASSIFICATION_NOTE =
  'Centipawn-loss thresholds are a common convention, not an official standard.'

export const PERSPECTIVE_NOTE =
  "display, cpWhite and mateInWhite are from White's perspective: positive favours White. " +
  'cp and mateIn are the raw UCI values, from the perspective of the side to move.'

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

// Coerces an agent-supplied number, falling back when it is missing or unusable.
export function asBoundedInt(
  value: unknown,
  min: number,
  max: number,
  fallback: number
): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return clamp(Math.round(parsed), min, max)
}

// "e7e8q" -> { from: 'e7', to: 'e8', promotion: 'q' }. Returns null for anything
// that isn't a well-formed UCI move, so callers never feed junk to chess.js.
export function splitUciMove(uci: string): {
  from: string
  to: string
  promotion: PromotionPiece | null
} | null {
  if (!/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(uci)) return null
  const promotion = uci.slice(4)
  return {
    from: uci.slice(0, 2),
    to: uci.slice(2, 4),
    promotion: promotion ? (promotion as PromotionPiece) : null
  }
}

export function toUciMove(
  from: string,
  to: string,
  promotion?: PromotionPiece | null
): string {
  return `${from}${to}${promotion ?? ''}`
}

// Flips a side-to-move score into White's frame and formats it the way every
// chess interface does. Mate scores keep their sign so "-M2" reads as "Black
// mates in 2", matching the eval bar.
export function normaliseScore(
  raw: { cp: number | null; mateIn: number | null },
  turn: PlayerColor
): Score {
  const sign = turn === 'w' ? 1 : -1
  const cpWhite = raw.cp === null ? null : raw.cp * sign
  const mateInWhite = raw.mateIn === null ? null : raw.mateIn * sign

  let display: string
  if (mateInWhite !== null) {
    display = mateInWhite < 0 ? `-M${Math.abs(mateInWhite)}` : `M${mateInWhite}`
  } else if (cpWhite !== null) {
    const pawns = cpWhite / 100
    display = `${pawns >= 0 ? '+' : '-'}${Math.abs(pawns).toFixed(2)}`
  } else {
    display = '—'
  }

  return {
    cp: raw.cp,
    mateIn: raw.mateIn,
    cpWhite,
    mateInWhite,
    display
  }
}

// Collapses a score to a single comparable number in White's frame, so evals
// before and after a move can be subtracted. Mate is mapped onto a large
// centipawn value that still ranks shorter mates ahead of longer ones.
const MATE_SCORE = 10_000

export function scoreToComparable(score: Score): number {
  if (score.mateInWhite !== null) {
    return score.mateInWhite >= 0
      ? MATE_SCORE - score.mateInWhite
      : -MATE_SCORE - score.mateInWhite
  }
  return score.cpWhite ?? 0
}

// Reads a value that follows `token` in a whitespace-split UCI line.
function tokenValue(parts: string[], token: string): string | null {
  const index = parts.indexOf(token)
  if (index === -1 || index + 1 >= parts.length) return null
  return parts[index + 1]
}

function tokenNumber(parts: string[], token: string): number | null {
  const raw = tokenValue(parts, token)
  if (raw === null) return null
  const parsed = Number(raw)
  return Number.isFinite(parsed) ? parsed : null
}

// Parses one `info ...` line. Returns null for lines with nothing useful in
// them, including the `info string ...` chatter the engine emits at startup.
export function parseInfoLine(line: string): InfoLine | null {
  if (!line.startsWith('info ')) return null
  const parts = line.split(/\s+/)
  if (parts[1] === 'string') return null

  const pvIndex = parts.indexOf('pv')
  const pv =
    pvIndex === -1
      ? []
      : parts.slice(pvIndex + 1).filter((move) => splitUciMove(move) !== null)

  const scoreIndex = parts.indexOf('score')
  let cp: number | null = null
  let mateIn: number | null = null
  if (scoreIndex !== -1) {
    const kind = parts[scoreIndex + 1]
    const value = Number(parts[scoreIndex + 2])
    if (Number.isFinite(value)) {
      if (kind === 'cp') cp = value
      else if (kind === 'mate') mateIn = value
    }
  }

  if (cp === null && mateIn === null && pv.length === 0) return null

  return {
    depth: tokenNumber(parts, 'depth'),
    multipv: tokenNumber(parts, 'multipv') ?? 1,
    cp,
    mateIn,
    nodes: tokenNumber(parts, 'nodes'),
    nps: tokenNumber(parts, 'nps'),
    timeMs: tokenNumber(parts, 'time'),
    pv
  }
}

// Replays a principal variation to get SAN, which is what a model reasons and
// writes in. Truncates rather than throwing if the engine's line and our board
// ever disagree, so one odd move can't sink a whole analysis.
export function uciPvToSan(fen: string, pvUci: string[]): string[] {
  let board: Chess
  try {
    board = new Chess(fen)
  } catch {
    return []
  }
  const san: string[] = []
  for (const uci of pvUci) {
    const parsed = splitUciMove(uci)
    if (!parsed) break
    try {
      const move = board.move({
        from: parsed.from,
        to: parsed.to,
        promotion: parsed.promotion ?? 'q'
      })
      san.push(move.san)
    } catch {
      break
    }
  }
  return san
}

export function isValidFen(fen: string): boolean {
  try {
    new Chess(fen)
    return true
  } catch {
    return false
  }
}

// Turns centipawn loss into a label. Losing a forced mate, or walking into one,
// is a blunder no matter what the centipawn arithmetic says — the scale stops
// being meaningful once mate is on the board.
export function classifyMove(
  centipawnLoss: number,
  options: { lostForcedMate?: boolean; allowedMate?: boolean } = {}
): MoveClass {
  if (options.lostForcedMate || options.allowedMate) return 'blunder'
  const loss = Math.max(0, centipawnLoss)
  for (const { limit, label } of CLASS_THRESHOLDS) {
    if (loss < limit) return label
  }
  return 'blunder'
}

// The annotation a chess book would put after the move, or null when the move
// was fine. Used for the badge in the move history.
export function classificationSymbol(moveClass: MoveClass): string | null {
  switch (moveClass) {
    case 'inaccuracy':
      return '?!'
    case 'mistake':
      return '?'
    case 'blunder':
      return '??'
    default:
      return null
  }
}

// Stockfish's Skill Level is not calibrated to Elo, and the mapping shifts
// between versions and hardware. Returning a band, always labelled approximate,
// is honest; quoting a precise rating would not be.
export function skillLevelToApproxElo(skillLevel: number): string {
  const level = clamp(Math.round(skillLevel), 0, MAX_SKILL_LEVEL)
  if (level <= 1) return 'roughly 800 or below'
  if (level <= 3) return 'roughly 900-1100'
  if (level <= 5) return 'roughly 1100-1300'
  if (level <= 8) return 'roughly 1300-1600'
  if (level <= 11) return 'roughly 1600-1900'
  if (level <= 14) return 'roughly 1900-2200'
  if (level <= 17) return 'roughly 2200-2500'
  return 'full strength, well above 2500'
}

// Builds the engine-line shape both the tools and the sidebar render from.
export function buildEngineLine(
  info: InfoLine,
  fen: string,
  turn: PlayerColor
): EngineLine | null {
  const firstMove = info.pv[0]
  if (!firstMove) return null
  const parsed = splitUciMove(firstMove)
  if (!parsed) return null

  const pvSan = uciPvToSan(fen, info.pv)
  if (pvSan.length === 0) return null

  return {
    rank: info.multipv,
    uci: firstMove,
    san: pvSan[0],
    from: parsed.from,
    to: parsed.to,
    promotion: parsed.promotion,
    score: normaliseScore({ cp: info.cp, mateIn: info.mateIn }, turn),
    pvUci: info.pv,
    pvSan
  }
}
