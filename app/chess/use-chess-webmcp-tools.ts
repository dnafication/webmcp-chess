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
  'chess-suggest-move',
  'chess-new-game'
] as const

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
}

// Registers the WebMCP tools an agent uses to read the board, move, coach, and reset the game.
// Kept separate from the component so ChessGame only has to deal with UI + local interaction state.
export function useChessWebMcpTools({
  chessGameRef,
  humanColorRef,
  applyMove,
  startNewGame,
  onAgentMove,
  onSuggestion
}: ChessWebMcpToolsOptions): SupportStatus {
  const [status, setStatus] = useState<SupportStatus>('checking')

  useEffect(() => {
    const controller = new AbortController()
    let cancelled = false

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
              'Returns the current chess position (FEN), whose turn it is, which color the human and the agent are playing, legal moves, move history, and game-over status.',
            inputSchema: { type: 'object', properties: {}, required: [] },
            annotations: { readOnlyHint: true },
            execute() {
              const chess = chessGameRef.current
              const state = {
                fen: chess.fen(),
                turn: chess.turn(),
                humanColor: humanColorRef.current,
                agentColor: opponentColor(humanColorRef.current),
                legalMoves: chess.moves(),
                history: chess.history(),
                isCheck: chess.isCheck(),
                isCheckmate: chess.isCheckmate(),
                isStalemate: chess.isStalemate(),
                isDraw: chess.isDraw(),
                isGameOver: chess.isGameOver()
              }
              return {
                content: [
                  { type: 'text', text: JSON.stringify(state, null, 2) }
                ]
              }
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
              return {
                content: [
                  {
                    type: 'text',
                    text: `Played ${result.san}. ${describeStatus(chess)}`
                  }
                ]
              }
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

    // Aborting the signal unregisters all four tools.
    return () => {
      cancelled = true
      controller.abort()
    }
  }, [
    chessGameRef,
    humanColorRef,
    applyMove,
    startNewGame,
    onAgentMove,
    onSuggestion
  ])

  return status
}
