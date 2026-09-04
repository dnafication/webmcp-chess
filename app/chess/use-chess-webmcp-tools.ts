'use client'

import { useEffect, useState } from 'react'
import type { RefObject } from 'react'
import { Chess } from 'chess.js'
import {
  ARROW_PALETTE,
  MAX_SUGGESTED_MOVES,
  asPlayerColor,
  asPromotion,
  colorName,
  describeStatus,
  materialSummaryOf,
  opponentColor,
  type CoachSuggestion,
  type MoveResult,
  type PlayerColor,
  type PromotionPiece,
  type SupportStatus
} from './chess-helpers'
import {
  CLASSIFICATION_NOTE,
  DEFAULT_ANALYSIS_DEPTH,
  DEFAULT_MULTI_PV,
  DEFAULT_REVIEW_DEPTH,
  MAX_ANALYSIS_DEPTH,
  MAX_MOVETIME_MS,
  MAX_MULTI_PV,
  MAX_SKILL_LEVEL,
  MIN_ANALYSIS_DEPTH,
  MIN_MOVETIME_MS,
  PERSPECTIVE_NOTE,
  asBoundedInt,
  classifyMove,
  isValidFen,
  normaliseScore,
  scoreToComparable,
  skillLevelToApproxElo,
  type AnalysisResult,
  type EngineLine,
  type EngineSettings,
  type MoveReview,
  type Score
} from './chess-analysis'
import type { AnalyseRequest } from './stockfish-engine'

export const TOOL_NAMES = [
  'chess-get-board-state',
  'chess-make-move',
  'chess-wait-for-human-move',
  'chess-analyze-position',
  'chess-evaluate-move',
  'chess-set-engine-strength',
  'chess-suggest-move',
  'chess-new-game'
] as const

const HUMAN_MOVE_WAIT_TIMEOUT_MS = 120_000

type WaitStatus = 'idle' | 'waiting' | 'timed-out'
type GameEvent = 'human-move' | 'reset'

type ChessWebMcpToolsOptions = {
  chessGameRef: RefObject<Chess>
  humanColorRef: RefObject<PlayerColor>
  applyMove: (
    from: string,
    to: string,
    promotion?: PromotionPiece
  ) => MoveResult
  startNewGame: (nextHumanColor?: PlayerColor) => void
  onAgentMove: () => void
  onSuggestion: (suggestions: CoachSuggestion[], note: string | null) => void
  subscribeToGameEvent: (listener: (event: GameEvent) => void) => () => void
  onWaitStatusChange: (status: WaitStatus) => void
  analyse: (request: AnalyseRequest) => Promise<AnalysisResult>
  engineSettingsRef: RefObject<EngineSettings>
  updateEngineSettings: (next: Partial<EngineSettings>) => EngineSettings
  onMoveReview: (review: MoveReview | null) => void
}

function agentState(chess: Chess, humanColor: PlayerColor) {
  const agentColor = opponentColor(humanColor)
  const material = materialSummaryOf(chess)
  return {
    fen: chess.fen(),
    turn: chess.turn(),
    humanColor,
    agentColor,
    legalMoves: chess.moves(),
    history: chess.history(),
    isCheck: chess.isCheck(),
    isCheckmate: chess.isCheckmate(),
    isStalemate: chess.isStalemate(),
    isDraw: chess.isDraw(),
    isGameOver: chess.isGameOver(),
    status: describeStatus(chess),
    capturedByWhite: material.capturedByWhite,
    capturedByBlack: material.capturedByBlack,
    materialAdvantage: material.advantage, // positive = White ahead, negative = Black ahead
    nextAction: chess.isGameOver()
      ? 'game-over'
      : chess.turn() === agentColor
        ? 'agent-move'
        : 'wait-for-human-move'
  }
}

function textContent(value: unknown) {
  return {
    content: [{ type: 'text', text: JSON.stringify(value, null, 2) }]
  }
}

function plainText(text: string) {
  return { content: [{ type: 'text', text }] }
}

// Engine failures are ordinary here: the human may simply not have loaded the
// 7 MB binary yet, or the browser may not run it. The agent gets a sentence it
// can relay rather than a rejected tool call, and every other tool keeps working.
function engineFailure(error: unknown) {
  const detail =
    error instanceof Error ? error.message : 'The chess engine is unavailable.'
  return plainText(
    `Engine unavailable: ${detail} The board, move and coaching tools still work without it.`
  )
}

// Flattens an engine line into the shape the agent consumes, with from/to/promotion
// broken out so a recommendation can be passed straight to chess-make-move.
function describeLine(line: EngineLine) {
  return {
    rank: line.rank,
    san: line.san,
    uci: line.uci,
    from: line.from,
    to: line.to,
    promotion: line.promotion,
    display: line.score.display,
    cpWhite: line.score.cpWhite,
    mateInWhite: line.score.mateInWhite,
    pvSan: line.pvSan
  }
}

function describeScore(score: Score) {
  return {
    display: score.display,
    cpWhite: score.cpWhite,
    mateInWhite: score.mateInWhite
  }
}

// A terminal position has no search to run: `go` would return `bestmove (none)`
// with no info lines, so the score is derived from the outcome instead.
function terminalScore(board: Chess): Score | null {
  if (board.isCheckmate()) {
    // The side to move is mated, so the winner is the other side.
    const winner = opponentColor(board.turn())
    return normaliseScore({ cp: null, mateIn: 0 }, winner)
  }
  if (board.isGameOver()) return normaliseScore({ cp: 0, mateIn: null }, 'w')
  return null
}

type PositionEvaluation = { score: Score; best: EngineLine | null }

// Evaluates one position, short-circuiting when the game has already ended
// there so callers never have to special-case checkmate themselves.
async function evaluatePosition(
  analyse: (request: AnalyseRequest) => Promise<AnalysisResult>,
  fen: string,
  depth: number,
  signal?: AbortSignal
): Promise<PositionEvaluation> {
  const board = new Chess(fen)
  const terminal = terminalScore(board)
  if (terminal) return { score: terminal, best: null }

  const result = await analyse({ fen, depth, multiPv: 1, signal })
  const best = result.lines[0] ?? null
  return {
    score: best
      ? best.score
      : normaliseScore({ cp: 0, mateIn: null }, result.turn),
    best
  }
}

// Resolves the move a review should be about: an explicit from/to, an explicit
// SAN, or — with no arguments at all — the move that was just played.
type ReviewTarget = {
  fenBefore: string
  from: string
  to: string
  promotion: PromotionPiece | null
  historyIndex: number | null
}

function resolveReviewTarget(
  chess: Chess,
  input: {
    from?: unknown
    to?: unknown
    promotion?: unknown
    san?: unknown
    fen?: unknown
  }
): ReviewTarget | string {
  const explicitFen = typeof input.fen === 'string' ? input.fen : null
  if (explicitFen && !isValidFen(explicitFen)) {
    return `Not a valid FEN: ${explicitFen}`
  }

  const hasSquares =
    typeof input.from === 'string' && typeof input.to === 'string'
  const hasSan = typeof input.san === 'string' && input.san.trim().length > 0

  if (!hasSquares && !hasSan) {
    const history = chess.history({ verbose: true })
    const last = history.at(-1)
    if (!last) {
      return 'No move has been played yet, so there is nothing to review. Pass from/to or san to evaluate a hypothetical move.'
    }
    return {
      fenBefore: last.before,
      from: last.from,
      to: last.to,
      promotion: (last.promotion as PromotionPiece | undefined) ?? null,
      historyIndex: history.length - 1
    }
  }

  const fenBefore = explicitFen ?? chess.fen()

  if (hasSan) {
    // Let chess.js resolve the SAN against the position it was played in.
    const board = new Chess(fenBefore)
    try {
      const move = board.move(String(input.san))
      return {
        fenBefore,
        from: move.from,
        to: move.to,
        promotion: (move.promotion as PromotionPiece | undefined) ?? null,
        historyIndex: null
      }
    } catch {
      return `"${String(input.san)}" is not a legal move in that position.`
    }
  }

  return {
    fenBefore,
    from: String(input.from),
    to: String(input.to),
    promotion: asPromotion(input.promotion) ?? null,
    historyIndex: null
  }
}

// Registers the WebMCP tools an agent uses to read the board, move, coach, and reset the game.
// Kept separate from the component so ChessGame only has to deal with UI + local interaction state.
export function useChessWebMcpTools({
  chessGameRef,
  humanColorRef,
  applyMove,
  startNewGame,
  onAgentMove,
  onSuggestion,
  subscribeToGameEvent,
  onWaitStatusChange,
  analyse,
  engineSettingsRef,
  updateEngineSettings,
  onMoveReview
}: ChessWebMcpToolsOptions): SupportStatus {
  const [status, setStatus] = useState<SupportStatus>('checking')

  useEffect(() => {
    const controller = new AbortController()
    let cancelled = false
    let waitInProgress = false
    let cancelActiveWait: (() => void) | null = null

    async function register() {
      if (typeof document === 'undefined' || !document.modelContext) {
        if (!cancelled) setStatus('unsupported')
        return
      }

      try {
        await document.modelContext.registerTool(
          {
            name: 'chess-get-board-state',
            description:
              'Returns the current chess position (FEN), whose turn it is, which color the human and the agent are playing, legal moves, move history, game-over status, captured pieces for each side, and the net material advantage (materialAdvantage: positive favours White, negative favours Black, 0 when level).',
            inputSchema: { type: 'object', properties: {}, required: [] },
            annotations: { readOnlyHint: true },
            execute() {
              const chess = chessGameRef.current
              return textContent(agentState(chess, humanColorRef.current))
            }
          },
          { signal: controller.signal }
        )

        await document.modelContext.registerTool(
          {
            name: 'chess-make-move',
            description:
              "Makes a chess move on behalf of the agent's assigned color (the side the human isn't playing). Rejects with an explanation if it isn't the agent's turn, the move is illegal, or the game is over.",
            inputSchema: {
              type: 'object',
              properties: {
                from: {
                  type: 'string',
                  description: 'Source square, e.g. "e2".'
                },
                to: {
                  type: 'string',
                  description: 'Destination square, e.g. "e4".'
                },
                promotion: {
                  type: 'string',
                  enum: ['q', 'r', 'b', 'n'],
                  description:
                    'Piece to promote a pawn to, if applicable. Defaults to queen.'
                }
              },
              required: ['from', 'to']
            },
            execute({ from, to, promotion }) {
              const chess = chessGameRef.current
              const agentColor = opponentColor(humanColorRef.current)
              if (chess.isGameOver()) {
                return {
                  content: [{ type: 'text', text: 'The game is already over.' }]
                }
              }
              if (chess.turn() !== agentColor) {
                return {
                  content: [
                    {
                      type: 'text',
                      text: `It isn't the agent's turn yet — ${colorName(chess.turn())} moves next.`
                    }
                  ]
                }
              }
              const result = applyMove(
                String(from),
                String(to),
                asPromotion(promotion)
              )
              if (!result.ok) {
                return { content: [{ type: 'text', text: result.reason }] }
              }
              onAgentMove()
              return textContent({
                outcome: 'move-played',
                move: result.san,
                state: agentState(chess, humanColorRef.current)
              })
            }
          },
          { signal: controller.signal }
        )

        await document.modelContext.registerTool(
          {
            name: 'chess-wait-for-human-move',
            description:
              "Waits for the human to make a move, then returns the updated board state so the same agent run can continue. Call this after making the agent's move, passing the latest FEN as afterFen. If the position already changed, it returns immediately.",
            inputSchema: {
              type: 'object',
              properties: {
                afterFen: {
                  type: 'string',
                  description:
                    'The FEN most recently observed by the agent. Used to avoid missing a human move made just before this call.'
                }
              },
              required: ['afterFen']
            },
            annotations: { readOnlyHint: true },
            execute({ afterFen }, options) {
              const signal = options?.signal ?? controller.signal
              const currentChess = chessGameRef.current
              const lastSeenFen = String(afterFen)
              if (currentChess.fen() !== lastSeenFen) {
                onWaitStatusChange('idle')
                return textContent({
                  outcome: 'position-changed',
                  state: agentState(currentChess, humanColorRef.current)
                })
              }
              if (currentChess.isGameOver()) {
                onWaitStatusChange('idle')
                return textContent({
                  outcome: 'game-over',
                  state: agentState(currentChess, humanColorRef.current)
                })
              }
              if (currentChess.turn() !== humanColorRef.current) {
                onWaitStatusChange('idle')
                return textContent({
                  outcome: 'not-human-turn',
                  state: agentState(currentChess, humanColorRef.current)
                })
              }
              if (waitInProgress) {
                return textContent({
                  outcome: 'already-waiting',
                  message: 'A human-move wait is already active.',
                  state: agentState(currentChess, humanColorRef.current)
                })
              }

              waitInProgress = true
              onWaitStatusChange('waiting')
              return new Promise((resolve, reject) => {
                let settled = false
                let unsubscribe = () => {}

                const finish = (result: unknown) => {
                  if (settled) return
                  settled = true
                  window.clearTimeout(timeoutId)
                  signal.removeEventListener('abort', handleAbort)
                  unsubscribe()
                  waitInProgress = false
                  cancelActiveWait = null
                  resolve(textContent(result))
                }
                const handleAbort = () => {
                  if (settled) return
                  settled = true
                  window.clearTimeout(timeoutId)
                  unsubscribe()
                  waitInProgress = false
                  cancelActiveWait = null
                  onWaitStatusChange('idle')
                  reject(signal.reason)
                }
                const timeoutId = window.setTimeout(() => {
                  onWaitStatusChange('timed-out')
                  finish({
                    outcome: 'timeout',
                    message:
                      'No human move was made before the wait timed out.',
                    state: agentState(
                      chessGameRef.current,
                      humanColorRef.current
                    )
                  })
                }, HUMAN_MOVE_WAIT_TIMEOUT_MS)

                unsubscribe = subscribeToGameEvent((event) => {
                  onWaitStatusChange('idle')
                  finish({
                    outcome:
                      event === 'human-move' ? 'human-moved' : 'game-reset',
                    state: agentState(
                      chessGameRef.current,
                      humanColorRef.current
                    )
                  })
                })
                signal.addEventListener('abort', handleAbort, { once: true })
                cancelActiveWait = handleAbort
                if (signal.aborted) handleAbort()
              })
            }
          },
          { signal: controller.signal }
        )

        await document.modelContext.registerTool(
          {
            name: 'chess-analyze-position',
            description:
              'Runs the Stockfish engine on a position and returns its best moves with evaluations and principal variations. ' +
              'Use this before recommending or playing a move — legal moves from chess-get-board-state say nothing about whether a move is good. ' +
              "Scores in `display`, `cpWhite` and `mateInWhite` are from White's perspective, where positive favours White. " +
              'Each line includes from/to/promotion so it can be passed straight to chess-make-move. ' +
              'The first call downloads roughly 7 MB of engine and takes a few seconds; later calls are fast.',
            inputSchema: {
              type: 'object',
              properties: {
                fen: {
                  type: 'string',
                  description:
                    'Position to analyse. Defaults to the current game position.'
                },
                depth: {
                  type: 'number',
                  description: `Search depth, ${MIN_ANALYSIS_DEPTH}-${MAX_ANALYSIS_DEPTH}. Defaults to ${DEFAULT_ANALYSIS_DEPTH}. Deeper is stronger and slower.`
                },
                multiPv: {
                  type: 'number',
                  description: `How many candidate lines to return, 1-${MAX_MULTI_PV}. Defaults to ${DEFAULT_MULTI_PV}.`
                },
                movetimeMs: {
                  type: 'number',
                  description: `Hard time budget in milliseconds, ${MIN_MOVETIME_MS}-${MAX_MOVETIME_MS}. Overrides depth when given.`
                },
                purpose: {
                  type: 'string',
                  enum: ['coach', 'play'],
                  description:
                    "'coach' (default) always analyses at full strength, so advice given to the human is honest. " +
                    "'play' analyses at the skill level set by chess-set-engine-strength, for choosing the agent's own move — use it so the agent can be a beatable opponent."
                }
              },
              required: []
            },
            annotations: { readOnlyHint: true },
            async execute(
              { fen, depth, multiPv, movetimeMs, purpose },
              options
            ) {
              const chess = chessGameRef.current
              const targetFen = typeof fen === 'string' ? fen : chess.fen()
              if (!isValidFen(targetFen)) {
                return plainText(`Not a valid FEN: ${targetFen}`)
              }

              const board = new Chess(targetFen)
              if (board.isGameOver()) {
                return textContent({
                  outcome: 'game-over',
                  message:
                    'That position is already finished, so there is nothing to search.',
                  status: describeStatus(board),
                  fen: targetFen
                })
              }

              const forPlay = purpose === 'play'
              const settings = engineSettingsRef.current
              const request: AnalyseRequest = {
                fen: targetFen,
                depth: asBoundedInt(
                  depth,
                  MIN_ANALYSIS_DEPTH,
                  MAX_ANALYSIS_DEPTH,
                  forPlay ? settings.depth : DEFAULT_ANALYSIS_DEPTH
                ),
                multiPv: forPlay
                  ? 1
                  : asBoundedInt(multiPv, 1, MAX_MULTI_PV, DEFAULT_MULTI_PV),
                // Full strength for coaching; the configured level only ever
                // weakens the engine when it is picking the agent's own move.
                skillLevel: forPlay ? settings.skillLevel : MAX_SKILL_LEVEL,
                signal: options?.signal
              }
              if (movetimeMs !== undefined) {
                request.movetimeMs = asBoundedInt(
                  movetimeMs,
                  MIN_MOVETIME_MS,
                  MAX_MOVETIME_MS,
                  settings.movetimeMs
                )
              }

              try {
                const result = await analyse(request)
                const best = result.lines[0] ?? null
                return textContent({
                  fen: result.fen,
                  turn: result.turn,
                  turnName: colorName(result.turn),
                  depthReached: result.depthReached,
                  timeMs: result.timeMs,
                  nodes: result.nodes,
                  purpose: forPlay ? 'play' : 'coach',
                  skillLevel: request.skillLevel,
                  perspectiveNote: PERSPECTIVE_NOTE,
                  evaluation: best ? describeScore(best.score) : null,
                  lines: result.lines.map(describeLine),
                  bestMove: best
                    ? {
                        san: best.san,
                        uci: best.uci,
                        from: best.from,
                        to: best.to,
                        promotion: best.promotion
                      }
                    : null
                })
              } catch (error) {
                if (options?.signal?.aborted) throw error
                return engineFailure(error)
              }
            }
          },
          { signal: controller.signal }
        )

        await document.modelContext.registerTool(
          {
            name: 'chess-evaluate-move',
            description:
              'Asks Stockfish how good a move was: the evaluation before and after it, how much it gave away in centipawns, a blunder/mistake/good classification, the move the engine preferred, and the line that refutes it. ' +
              'Called with no arguments it reviews the move just played, which is the usual way to coach after a human moves. ' +
              'Use the refutation line to explain the mistake in words rather than only quoting the number.',
            inputSchema: {
              type: 'object',
              properties: {
                from: { type: 'string', description: 'Source square, e.g. "e2".' },
                to: {
                  type: 'string',
                  description: 'Destination square, e.g. "e4".'
                },
                promotion: {
                  type: 'string',
                  enum: ['q', 'r', 'b', 'n'],
                  description: 'Promotion piece, if the move is a promotion.'
                },
                san: {
                  type: 'string',
                  description:
                    'The move in algebraic notation, e.g. "Nf3". An alternative to from/to.'
                },
                fen: {
                  type: 'string',
                  description:
                    'The position the move is played from. Defaults to the current position, or to the position before the last move when reviewing it.'
                },
                depth: {
                  type: 'number',
                  description: `Search depth, ${MIN_ANALYSIS_DEPTH}-${MAX_ANALYSIS_DEPTH}. Defaults to ${DEFAULT_REVIEW_DEPTH}.`
                }
              },
              required: []
            },
            annotations: { readOnlyHint: true },
            async execute({ from, to, promotion, san, fen, depth }, options) {
              const chess = chessGameRef.current
              const target = resolveReviewTarget(chess, {
                from,
                to,
                promotion,
                san,
                fen
              })
              if (typeof target === 'string') return plainText(target)

              const beforeBoard = new Chess(target.fenBefore)
              const playedBy = beforeBoard.turn()
              let played
              try {
                played = beforeBoard.move({
                  from: target.from,
                  to: target.to,
                  promotion: target.promotion ?? 'q'
                })
              } catch {
                return plainText(
                  `${target.from}-${target.to} is not a legal move in that position.`
                )
              }
              const fenAfter = beforeBoard.fen()
              const searchDepth = asBoundedInt(
                depth,
                MIN_ANALYSIS_DEPTH,
                MAX_ANALYSIS_DEPTH,
                DEFAULT_REVIEW_DEPTH
              )

              try {
                const before = await evaluatePosition(
                  analyse,
                  target.fenBefore,
                  searchDepth,
                  options?.signal
                )
                const after = await evaluatePosition(
                  analyse,
                  fenAfter,
                  searchDepth,
                  options?.signal
                )

                // Both evaluations arrive in White's frame; flip them into the
                // mover's so "loss" means what it says regardless of colour.
                const moverSign = playedBy === 'w' ? 1 : -1
                const beforeForMover =
                  scoreToComparable(before.score) * moverSign
                const afterForMover = scoreToComparable(after.score) * moverSign
                const centipawnLoss = Math.max(
                  0,
                  Math.round(beforeForMover - afterForMover)
                )

                const hadMate =
                  before.score.mateInWhite !== null &&
                  before.score.mateInWhite * moverSign > 0
                const keptMate =
                  after.score.mateInWhite !== null &&
                  after.score.mateInWhite * moverSign >= 0
                const nowLosingToMate =
                  after.score.mateInWhite !== null &&
                  after.score.mateInWhite * moverSign < 0
                const wasLosingToMate =
                  before.score.mateInWhite !== null &&
                  before.score.mateInWhite * moverSign < 0

                const classification = classifyMove(centipawnLoss, {
                  lostForcedMate: hadMate && !keptMate,
                  allowedMate: nowLosingToMate && !wasLosingToMate
                })

                const wasEngineChoice = before.best?.uci === played.lan
                const review: MoveReview = {
                  moveSan: played.san,
                  moveUci: played.lan,
                  playedBy,
                  classification,
                  centipawnLoss,
                  historyIndex: target.historyIndex
                }
                onMoveReview(review)

                return textContent({
                  move: {
                    san: played.san,
                    uci: played.lan,
                    from: played.from,
                    to: played.to
                  },
                  playedBy,
                  playedByName: colorName(playedBy),
                  reviewedLastMove: target.historyIndex !== null,
                  depth: searchDepth,
                  perspectiveNote: PERSPECTIVE_NOTE,
                  evalBefore: describeScore(before.score),
                  evalAfter: describeScore(after.score),
                  centipawnLoss,
                  classification,
                  classificationNote: CLASSIFICATION_NOTE,
                  wasEngineChoice,
                  engineBest: before.best
                    ? {
                        san: before.best.san,
                        uci: before.best.uci,
                        from: before.best.from,
                        to: before.best.to,
                        promotion: before.best.promotion,
                        pvSan: before.best.pvSan
                      }
                    : null,
                  // The best continuation from the resulting position is exactly
                  // the punishment, which is the part worth explaining.
                  refutationPvSan: after.best?.pvSan ?? []
                })
              } catch (error) {
                if (options?.signal?.aborted) throw error
                return engineFailure(error)
              }
            }
          },
          { signal: controller.signal }
        )

        await document.modelContext.registerTool(
          {
            name: 'chess-set-engine-strength',
            description:
              "Sets how strong the engine plays when it picks the agent's own moves, so the agent can be a beatable opponent. " +
              'Only affects chess-analyze-position calls made with purpose "play"; coaching analysis stays at full strength so advice to the human is never deliberately weakened.',
            inputSchema: {
              type: 'object',
              properties: {
                skillLevel: {
                  type: 'number',
                  description: `Stockfish Skill Level, 0-${MAX_SKILL_LEVEL}. 0 plays very badly, ${MAX_SKILL_LEVEL} is full strength.`
                },
                depth: {
                  type: 'number',
                  description: `Default search depth for the agent's own moves, ${MIN_ANALYSIS_DEPTH}-${MAX_ANALYSIS_DEPTH}.`
                },
                movetimeMs: {
                  type: 'number',
                  description: `Default time budget per search in milliseconds, ${MIN_MOVETIME_MS}-${MAX_MOVETIME_MS}.`
                }
              },
              required: []
            },
            execute({ skillLevel, depth, movetimeMs }) {
              const next = updateEngineSettings({
                skillLevel:
                  skillLevel === undefined ? undefined : Number(skillLevel),
                depth: depth === undefined ? undefined : Number(depth),
                movetimeMs:
                  movetimeMs === undefined ? undefined : Number(movetimeMs)
              })
              return textContent({
                outcome: 'settings-updated',
                settings: next,
                approximateStrength: skillLevelToApproxElo(next.skillLevel),
                strengthNote:
                  'Skill Level is not calibrated to Elo, so the rating band is a rough guide only.'
              })
            }
          },
          { signal: controller.signal }
        )

        await document.modelContext.registerTool(
          {
            name: 'chess-suggest-move',
            description:
              `Coaches the human by drawing up to ${MAX_SUGGESTED_MOVES} colored arrows for candidate moves, each with an optional reason and evaluation, plus an overall note — without making a move or changing the game state. ` +
              'Get the candidates from chess-analyze-position first: this tool only checks that a move is legal, not that it is any good.',
            inputSchema: {
              type: 'object',
              properties: {
                moves: {
                  type: 'array',
                  maxItems: MAX_SUGGESTED_MOVES,
                  description: `Candidate moves to highlight as arrows, in priority order (max ${MAX_SUGGESTED_MOVES}).`,
                  items: {
                    type: 'object',
                    properties: {
                      from: {
                        type: 'string',
                        description: 'Source square, e.g. "e2".'
                      },
                      to: {
                        type: 'string',
                        description: 'Destination square, e.g. "e4".'
                      },
                      reason: {
                        type: 'string',
                        description: 'Why this move is worth considering.'
                      },
                      evalText: {
                        type: 'string',
                        description:
                          'Engine evaluation to show beside the arrow, e.g. "+0.34" or "M3". Use the `display` value from chess-analyze-position.'
                      }
                    },
                    required: ['from', 'to']
                  }
                },
                note: {
                  type: 'string',
                  description:
                    'Overall coaching explanation to display alongside the board.'
                }
              },
              required: ['moves']
            },
            annotations: { readOnlyHint: true },
            execute({ moves, note }) {
              const chess = chessGameRef.current
              const legalMoves = chess.moves({ verbose: true })
              const allCandidates = Array.isArray(moves) ? moves : []
              const candidates = allCandidates.slice(0, MAX_SUGGESTED_MOVES)
              const suggestions: CoachSuggestion[] = []
              const rejected: string[] = []

              candidates.forEach((candidate, index) => {
                const record = candidate as Record<string, unknown>
                const from = String(record?.from ?? '')
                const to = String(record?.to ?? '')
                const reason =
                  typeof record?.reason === 'string' ? record.reason : undefined
                const evalText =
                  typeof record?.evalText === 'string'
                    ? record.evalText
                    : undefined
                const isLegal = legalMoves.some(
                  (move) => move.from === from && move.to === to
                )
                if (isLegal) {
                  suggestions.push({
                    from,
                    to,
                    reason,
                    evalText,
                    color: ARROW_PALETTE[index % ARROW_PALETTE.length]
                  })
                } else {
                  rejected.push(`${from}-${to}`)
                }
              })

              onSuggestion(
                suggestions,
                typeof note === 'string' && note.trim().length > 0 ? note : null
              )

              const parts = [
                suggestions.length > 0
                  ? `Highlighted ${suggestions.length} move(s): ${suggestions
                      .map(
                        (suggestion) => `${suggestion.from}-${suggestion.to}`
                      )
                      .join(', ')}.`
                  : 'No legal candidate moves were provided to highlight.'
              ]
              if (allCandidates.length > MAX_SUGGESTED_MOVES) {
                parts.push(
                  `Only the first ${MAX_SUGGESTED_MOVES} moves are shown.`
                )
              }
              if (rejected.length > 0) {
                parts.push(`Ignored illegal move(s): ${rejected.join(', ')}.`)
              }
              return { content: [{ type: 'text', text: parts.join(' ') }] }
            }
          },
          { signal: controller.signal }
        )

        await document.modelContext.registerTool(
          {
            name: 'chess-new-game',
            description:
              'Starts a new chess game from the standard starting position, optionally choosing which color the human plays.',
            inputSchema: {
              type: 'object',
              properties: {
                humanColor: {
                  type: 'string',
                  enum: ['w', 'b'],
                  description:
                    'Which color the human should play; keeps the current selection if omitted.'
                }
              },
              required: []
            },
            execute({ humanColor: nextColor }) {
              startNewGame(asPlayerColor(nextColor))
              return {
                content: [
                  {
                    type: 'text',
                    text: `Started a new game. The human is playing ${colorName(humanColorRef.current)}.`
                  }
                ]
              }
            }
          },
          { signal: controller.signal }
        )

        if (!cancelled) setStatus('ready')
      } catch {
        if (!cancelled) setStatus('error')
      }
    }

    register()

    // Settle an active execution, then unregister every tool from this hook.
    return () => {
      cancelled = true
      cancelActiveWait?.()
      controller.abort()
    }
  }, [
    chessGameRef,
    humanColorRef,
    applyMove,
    startNewGame,
    onAgentMove,
    onSuggestion,
    subscribeToGameEvent,
    onWaitStatusChange,
    analyse,
    engineSettingsRef,
    updateEngineSettings,
    onMoveReview
  ])

  return status
}
