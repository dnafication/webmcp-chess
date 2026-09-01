'use client'

import { useCallback, useId, useRef, useState, type CSSProperties } from 'react'
import { Chess, type Square } from 'chess.js'
import {
  Chessboard,
  type ChessboardOptions,
  type PieceDropHandlerArgs,
  type PieceHandlerArgs,
  type SquareHandlerArgs
} from 'react-chessboard'
import { boardThemeOptions } from './chess-board-theme'
import {
  asPlayerColor,
  createGame,
  loadStoredState,
  snapshotOf,
  type BoardSnapshot,
  type CoachSuggestion,
  type MoveResult,
  type PendingPromotion,
  type PlayerColor,
  type PromotionPiece,
  type StoredState
} from './chess-helpers'
import { TOOL_NAMES, useChessWebMcpTools } from './use-chess-webmcp-tools'

const SELECTED_SQUARE_STYLE: CSSProperties = {
  background: 'rgba(255, 214, 51, 0.45)'
}
const CAPTURE_SQUARE_STYLE: CSSProperties = {
  background: 'radial-gradient(circle, rgba(0,0,0,.18) 85%, transparent 85%)',
  borderRadius: '50%'
}
const QUIET_MOVE_SQUARE_STYLE: CSSProperties = {
  background: 'radial-gradient(circle, rgba(0,0,0,.18) 25%, transparent 25%)',
  borderRadius: '50%'
}

export default function ChessGame() {
  // Lazy initializers so localStorage is read and parsed only once, on mount.
  const [initialStored] = useState(
    () => loadStoredState() ?? { pgn: '', humanColor: 'w' as PlayerColor }
  )
  const [game] = useState(() => createGame(initialStored))
  const chessGameRef = useRef<Chess>(game)
  const [humanColor, setHumanColor] = useState<PlayerColor>(
    initialStored.humanColor
  )
  const humanColorRef = useRef(humanColor)
  const [colorChoice, setColorChoice] = useState<PlayerColor>(
    initialStored.humanColor
  )
  const [snapshot, setSnapshot] = useState<BoardSnapshot>(() =>
    snapshotOf(game)
  )
  const [coachSuggestions, setCoachSuggestions] = useState<CoachSuggestion[]>(
    []
  )
  const [coachNote, setCoachNote] = useState<string | null>(null)
  const [pendingPromotion, setPendingPromotion] =
    useState<PendingPromotion | null>(null)
  const [selectedSquare, setSelectedSquare] = useState<string | null>(null)
  const [moveOptionSquares, setMoveOptionSquares] = useState<
    Record<string, CSSProperties>
  >({})
  const colorSelectId = useId()

  const persist = useCallback(() => {
    if (typeof window === 'undefined') return
    try {
      const stored: StoredState = {
        pgn: chessGameRef.current.pgn(),
        humanColor: humanColorRef.current
      }
      window.localStorage.setItem('webmcp-chess-state', JSON.stringify(stored))
    } catch {
      // Ignore storage failures (e.g. private browsing quota).
    }
  }, [])

  const refresh = useCallback(() => {
    setSnapshot(snapshotOf(chessGameRef.current))
  }, [])

  const clearSelection = useCallback(() => {
    setSelectedSquare(null)
    setMoveOptionSquares({})
  }, [])

  const clearCoach = useCallback(() => {
    setCoachSuggestions([])
    setCoachNote(null)
  }, [])

  // Run after any successful move (human or agent) to keep the board, coach panel, and storage in sync.
  const completeMove = useCallback(() => {
    clearCoach()
    refresh()
    persist()
  }, [clearCoach, refresh, persist])

  const applySuggestion = useCallback(
    (suggestions: CoachSuggestion[], note: string | null) => {
      setCoachSuggestions(suggestions)
      setCoachNote(note)
    },
    []
  )

  const applyMove = useCallback(
    (from: string, to: string, promotion?: PromotionPiece): MoveResult => {
      const chess = chessGameRef.current
      if (chess.isGameOver()) {
        return { ok: false, reason: 'The game is already over.' }
      }
      try {
        const move = chess.move({ from, to, promotion: promotion ?? 'q' })
        return { ok: true, san: move.san }
      } catch {
        return { ok: false, reason: `Illegal move: ${from}-${to}.` }
      }
    },
    []
  )

  const startNewGame = useCallback(
    (nextHumanColor?: PlayerColor) => {
      chessGameRef.current = new Chess()
      if (nextHumanColor) {
        humanColorRef.current = nextHumanColor
        setHumanColor(nextHumanColor)
        setColorChoice(nextHumanColor)
      }
      clearSelection()
      setPendingPromotion(null)
      clearCoach()
      refresh()
      persist()
    },
    [clearSelection, clearCoach, refresh, persist]
  )

  // Highlights legal destinations (bigger dot for captures) for the given square.
  // Returns false and clears highlights if the square has no piece the human can currently move.
  function getMoveOptions(square: string): boolean {
    const chess = chessGameRef.current
    if (chess.isGameOver() || chess.turn() !== humanColor) {
      setMoveOptionSquares({})
      return false
    }

    const moves = chess.moves({ square: square as Square, verbose: true })
    if (moves.length === 0) {
      setMoveOptionSquares({})
      return false
    }

    const newSquares: Record<string, CSSProperties> = {}
    for (const move of moves) {
      newSquares[move.to] = move.captured
        ? CAPTURE_SQUARE_STYLE
        : QUIET_MOVE_SQUARE_STYLE
    }
    newSquares[square] = SELECTED_SQUARE_STYLE
    setMoveOptionSquares(newSquares)
    return true
  }

  function handleSquareClick({ square, piece }: SquareHandlerArgs) {
    if (pendingPromotion) return

    if (!selectedSquare) {
      if (piece && getMoveOptions(square)) setSelectedSquare(square)
      return
    }

    if (square === selectedSquare) {
      clearSelection()
      return
    }

    const candidates = chessGameRef.current.moves({
      square: selectedSquare as Square,
      verbose: true
    })
    const matching = candidates.filter((move) => move.to === square)

    if (matching.length === 0) {
      if (piece && getMoveOptions(square)) {
        setSelectedSquare(square)
      } else {
        clearSelection()
      }
      return
    }

    if (matching.some((move) => move.promotion)) {
      setPendingPromotion({ from: selectedSquare, to: square })
      clearSelection()
      return
    }

    const result = applyMove(selectedSquare, square)
    clearSelection()
    if (result.ok) completeMove()
  }

  function handlePieceDrop({
    sourceSquare,
    targetSquare
  }: PieceDropHandlerArgs): boolean {
    clearSelection()
    if (!targetSquare) return false
    const chess = chessGameRef.current
    if (chess.isGameOver() || chess.turn() !== humanColor) return false

    const candidates = chess.moves({
      square: sourceSquare as Square,
      verbose: true
    })
    const matching = candidates.filter((move) => move.to === targetSquare)
    if (matching.length === 0) return false

    if (matching.some((move) => move.promotion)) {
      setPendingPromotion({ from: sourceSquare, to: targetSquare })
      return false
    }

    const result = applyMove(sourceSquare, targetSquare)
    if (!result.ok) return false
    completeMove()
    return true
  }

  function handlePromotionPick(piece: PromotionPiece) {
    if (!pendingPromotion) return
    const result = applyMove(pendingPromotion.from, pendingPromotion.to, piece)
    setPendingPromotion(null)
    if (result.ok) completeMove()
  }

  function canDragPiece({ isSparePiece, piece }: PieceHandlerArgs): boolean {
    if (isSparePiece) return false
    const chess = chessGameRef.current
    if (chess.isGameOver() || chess.turn() !== humanColor) return false
    return piece.pieceType.charAt(0) === humanColor
  }

  const status = useChessWebMcpTools({
    chessGameRef,
    humanColorRef,
    applyMove,
    startNewGame,
    onAgentMove: completeMove,
    onSuggestion: applySuggestion
  })

  const coachArrows = coachSuggestions.map((suggestion) => ({
    startSquare: suggestion.from,
    endSquare: suggestion.to,
    color: suggestion.color
  }))

  const boardOptions: ChessboardOptions = {
    id: 'webmcp-chess',
    position: snapshot.fen,
    boardOrientation: humanColor === 'w' ? 'white' : 'black',
    arrows: coachArrows,
    squareStyles: moveOptionSquares,
    canDragPiece,
    onPieceDrop: handlePieceDrop,
    onSquareClick: handleSquareClick,
    animationDurationInMs: 300,
    draggingPieceStyle: { transform: 'scale(1.2)', rotate: '5deg' },
    ...boardThemeOptions
  }

  const historyPairs: { white: string; black?: string }[] = []
  for (let i = 0; i < snapshot.history.length; i += 2) {
    historyPairs.push({
      white: snapshot.history[i],
      black: snapshot.history[i + 1]
    })
  }

  return (
    <div className="flex w-full max-w-225 flex-col gap-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <label
            htmlFor={colorSelectId}
            className="text-sm font-medium text-zinc-600 dark:text-zinc-400"
          >
            Play as
          </label>
          <select
            id={colorSelectId}
            value={colorChoice}
            onChange={(event) =>
              setColorChoice(asPlayerColor(event.target.value) ?? 'w')
            }
            className="rounded-full border border-black/8 bg-white px-4 py-2 text-sm text-black outline-none focus-visible:ring-2 focus-visible:ring-black dark:border-white/[.145] dark:bg-black dark:text-zinc-50 dark:focus-visible:ring-white"
          >
            <option value="w">White</option>
            <option value="b">Black</option>
          </select>
        </div>
        <button
          type="button"
          onClick={() => startNewGame(colorChoice)}
          className="rounded-full bg-foreground px-5 py-2 text-sm font-medium text-background transition-colors hover:bg-[#383838] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black dark:hover:bg-[#ccc] dark:focus-visible:outline-white"
        >
          New game
        </button>
      </div>

      <p className="text-lg font-semibold text-black dark:text-zinc-50">
        {snapshot.statusText}
      </p>

      <div className="relative mx-auto w-full max-w-225">
        <Chessboard options={boardOptions} />
        {pendingPromotion && (
          <div className="absolute inset-0 flex items-center justify-center bg-white/90 dark:bg-black/90">
            <div className="flex flex-col items-center gap-3 rounded-2xl border border-black/8 bg-white p-5 dark:border-white/[.145] dark:bg-black">
              <p className="text-sm font-medium text-black dark:text-zinc-50">
                Promote pawn to
              </p>
              <div className="flex gap-2">
                {(['q', 'r', 'b', 'n'] as const).map((piece) => (
                  <button
                    key={piece}
                    type="button"
                    onClick={() => handlePromotionPick(piece)}
                    className="rounded-full border border-black/8 px-4 py-2 text-sm font-medium uppercase text-black hover:bg-black/5 dark:border-white/[.145] dark:text-zinc-50 dark:hover:bg-white/10"
                  >
                    {piece}
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={() => setPendingPromotion(null)}
                className="text-xs text-zinc-500 underline dark:text-zinc-400"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>

      {(coachNote || coachSuggestions.length > 0) && (
        <div className="flex flex-col gap-3 rounded-2xl border border-black/8 p-5 text-sm dark:border-white/[.145]">
          <p className="font-medium text-black dark:text-zinc-50">
            Coach suggestions
          </p>
          {coachNote && (
            <p className="text-zinc-600 dark:text-zinc-400">{coachNote}</p>
          )}
          {coachSuggestions.length > 0 && (
            <ol className="flex flex-col gap-2">
              {coachSuggestions.map((suggestion, index) => (
                <li key={index} className="flex items-start gap-2">
                  <span
                    className="mt-1 h-3 w-3 shrink-0 rounded-full"
                    style={{ backgroundColor: suggestion.color }}
                  />
                  <div>
                    <span className="font-medium text-black dark:text-zinc-50">
                      {suggestion.from}–{suggestion.to}
                    </span>
                    {suggestion.reason && (
                      <p className="text-zinc-600 dark:text-zinc-400">
                        {suggestion.reason}
                      </p>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}

      <div className="flex flex-col gap-2 rounded-2xl border border-black/8 p-5 text-sm dark:border-white/[.145]">
        <p className="font-medium text-black dark:text-zinc-50">Move history</p>
        {historyPairs.length === 0 ? (
          <p className="text-zinc-600 dark:text-zinc-400">No moves yet.</p>
        ) : (
          <ol className="grid grid-cols-[2rem_1fr_1fr] gap-y-1 text-zinc-600 dark:text-zinc-400">
            {historyPairs.map((pair, index) => (
              <li key={index} className="col-span-3 grid grid-cols-subgrid">
                <span>{index + 1}.</span>
                <span>{pair.white}</span>
                <span>{pair.black ?? ''}</span>
              </li>
            ))}
          </ol>
        )}
      </div>

      <div className="flex flex-col gap-2 rounded-2xl border border-black/8 p-5 text-sm dark:border-white/[.145]">
        <p className="font-medium text-black dark:text-zinc-50">
          WebMCP tools:{' '}
          <code className="font-mono">{TOOL_NAMES.join(', ')}</code>
        </p>
        <p className="text-zinc-600 dark:text-zinc-400">
          <StatusLabel status={status} />
        </p>
      </div>
    </div>
  )
}

function StatusLabel({
  status
}: {
  status: ReturnType<typeof useChessWebMcpTools>
}) {
  switch (status) {
    case 'checking':
      return <>Checking browser support for `document.modelContext`…</>
    case 'ready':
      return (
        <>
          Registered and discoverable by an in-browser agent. Ask it to check
          the board, make a move, suggest one, or start a new game.
        </>
      )
    case 'unsupported':
      return (
        <>
          This browser doesn&apos;t support WebMCP yet. Drag-and-drop and
          click-to-move still work — see the README for supported browsers.
        </>
      )
    case 'error':
      return <>Tool registration failed. Check the console for details.</>
  }
}
