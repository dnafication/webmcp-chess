'use client'

import { useEffect, useState } from 'react'
import type { RefObject } from 'react'
import type { Chess } from 'chess.js'
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

export const TOOL_NAMES = [
  'chess-get-board-state',
  'chess-make-move',
  'chess-wait-for-human-move',
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
  onWaitStatusChange
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
            name: 'chess-suggest-move',
            description: `Coaches the human by drawing up to ${MAX_SUGGESTED_MOVES} colored arrows for candidate moves, each with an optional reason, plus an overall note — without making a move or changing the game state.`,
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
                const isLegal = legalMoves.some(
                  (move) => move.from === from && move.to === to
                )
                if (isLegal) {
                  suggestions.push({
                    from,
                    to,
                    reason,
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
    onWaitStatusChange
  ])

  return status
}
