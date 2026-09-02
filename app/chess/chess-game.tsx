'use client'

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties
} from 'react'
import { Chess, type Square } from 'chess.js'
import {
  Chessboard,
  defaultPieces,
  type ChessboardOptions,
  type PieceDropHandlerArgs,
  type PieceHandlerArgs,
  type PieceRenderObject,
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
const CHECK_SQUARE_STYLE: CSSProperties = {
  background:
    'radial-gradient(circle, rgba(220,38,38,0.85) 0%, rgba(220,38,38,0.35) 55%, transparent 75%)',
  animation: 'check-square-pulse 1.1s ease-in-out infinite'
}

const DEFAULT_STORED_STATE: StoredState = { pgn: '', humanColor: 'w' }

export default function ChessGame() {
  const [game] = useState(() => createGame(DEFAULT_STORED_STATE))
  const chessGameRef = useRef<Chess>(game)
  const [humanColor, setHumanColor] = useState<PlayerColor>('w')
  const humanColorRef = useRef(humanColor)
  const [colorChoice, setColorChoice] = useState<PlayerColor>('w')
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
  // When on, the human can move either color's pieces (no AI opponent needed); chess.js still enforces whose turn it is.
  const [freeForAll, setFreeForAll] = useState(false)
  const [agentWaitStatus, setAgentWaitStatus] = useState<
    'idle' | 'waiting' | 'timed-out'
  >('idle')
  const gameEventListenersRef = useRef(
    new Set<(event: 'human-move' | 'reset') => void>()
  )
  const colorSelectId = useId()

  useEffect(() => {
    let cancelled = false
    queueMicrotask(() => {
      if (cancelled) return
      const stored = loadStoredState()
      if (!stored) return

      const storedGame = createGame(stored)
      chessGameRef.current = storedGame
      humanColorRef.current = stored.humanColor
      setHumanColor(stored.humanColor)
      setColorChoice(stored.humanColor)
      setSnapshot(snapshotOf(storedGame))
    })
    return () => {
      cancelled = true
    }
  }, [])

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

  const completeHumanMove = useCallback(() => {
    completeMove()
    gameEventListenersRef.current.forEach((listener) => listener('human-move'))
  }, [completeMove])

  const subscribeToGameEvent = useCallback(
    (listener: (event: 'human-move' | 'reset') => void) => {
      const listeners = gameEventListenersRef.current
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    []
  )

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
      gameEventListenersRef.current.forEach((listener) => listener('reset'))
    },
    [clearSelection, clearCoach, refresh, persist]
  )

  // Highlights legal destinations (bigger dot for captures) for the given square.
  // Returns false and clears highlights if the square has no piece the human can currently move.
  function getMoveOptions(square: string): boolean {
    const chess = chessGameRef.current
    if (chess.isGameOver() || (!freeForAll && chess.turn() !== humanColor)) {
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
    if (result.ok) completeHumanMove()
  }

  function handlePieceDrop({
    sourceSquare,
    targetSquare
  }: PieceDropHandlerArgs): boolean {
    clearSelection()
    if (!targetSquare) return false
    const chess = chessGameRef.current
    if (chess.isGameOver() || (!freeForAll && chess.turn() !== humanColor))
      return false

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
    completeHumanMove()
    return true
  }

  function handlePromotionPick(piece: PromotionPiece) {
    if (!pendingPromotion) return
    const result = applyMove(pendingPromotion.from, pendingPromotion.to, piece)
    setPendingPromotion(null)
    if (result.ok) completeHumanMove()
  }

  function canDragPiece({ isSparePiece, piece }: PieceHandlerArgs): boolean {
    if (isSparePiece) return false
    const chess = chessGameRef.current
    if (chess.isGameOver()) return false
    if (!freeForAll && chess.turn() !== humanColor) return false
    return piece.pieceType.charAt(0) === chess.turn()
  }

  const status = useChessWebMcpTools({
    chessGameRef,
    humanColorRef,
    applyMove,
    startNewGame,
    onAgentMove: completeMove,
    onSuggestion: applySuggestion,
    subscribeToGameEvent,
    onWaitStatusChange: setAgentWaitStatus
  })

  const coachArrows = coachSuggestions.map((suggestion) => ({
    startSquare: suggestion.from,
    endSquare: suggestion.to,
    color: suggestion.color
  }))

  // Wraps the king SVGs so the one currently in check plays a shake animation.
  const checkAwarePieces = useMemo<PieceRenderObject>(() => {
    const checkSquare = snapshot.checkSquare
    function shakeableKing(pieceType: 'wK' | 'bK') {
      const BaseKing = defaultPieces[pieceType]
      return function ShakeableKing(props?: {
        fill?: string
        square?: string
        svgStyle?: CSSProperties
      }) {
        return (
          <div
            style={{
              width: '100%',
              height: '100%',
              ...(props?.square === checkSquare
                ? { animation: 'king-shake 0.5s ease-in-out' }
                : {})
            }}
          >
            <BaseKing {...props} />
          </div>
        )
      }
    }
    return {
      ...defaultPieces,
      wK: shakeableKing('wK'),
      bK: shakeableKing('bK')
    }
  }, [snapshot.checkSquare])

  const checkSquareStyles: Record<string, CSSProperties> = snapshot.checkSquare
    ? { [snapshot.checkSquare]: CHECK_SQUARE_STYLE }
    : {}

  const boardOptions: ChessboardOptions = {
    id: 'webmcp-chess',
    position: snapshot.fen,
    boardOrientation: humanColor === 'w' ? 'white' : 'black',
    arrows: coachArrows,
    squareStyles: { ...checkSquareStyles, ...moveOptionSquares },
    pieces: checkAwarePieces,
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
    <div className="grid w-full gap-6 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start xl:gap-8">
      <section className="min-w-0">
        <div className="mb-5 flex flex-col gap-4 rounded-lg border border-black/10 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-zinc-900 sm:flex-row sm:items-end sm:justify-between">
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor={colorSelectId}
              className="text-xs font-semibold uppercase text-zinc-500 dark:text-zinc-400"
            >
              Play as
            </label>
            <select
              id={colorSelectId}
              value={colorChoice}
              onChange={(event) =>
                setColorChoice(asPlayerColor(event.target.value) ?? 'w')
              }
              className="h-10 min-w-32 rounded-md border border-black/15 bg-white px-3 text-sm font-medium text-zinc-950 outline-none transition focus-visible:border-emerald-600 focus-visible:ring-2 focus-visible:ring-emerald-600/20 dark:border-white/15 dark:bg-zinc-950 dark:text-zinc-50"
            >
              <option value="w">White</option>
              <option value="b">Black</option>
            </select>
          </div>
          <label className="flex h-10 items-center gap-2 text-sm font-medium text-zinc-600 dark:text-zinc-300">
            <input
              type="checkbox"
              checked={freeForAll}
              onChange={(event) => setFreeForAll(event.target.checked)}
              className="h-4 w-4 accent-emerald-700 dark:accent-emerald-500"
            />
            Move both sides
          </label>
          <button
            type="button"
            onClick={() => startNewGame(colorChoice)}
            className="h-10 rounded-md bg-emerald-700 px-5 text-sm font-semibold text-white transition-colors hover:bg-emerald-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700 dark:bg-emerald-500 dark:text-zinc-950 dark:hover:bg-emerald-400"
          >
            New game
          </button>
        </div>

        <div className="mb-3 flex min-h-8 flex-wrap items-center gap-3">
          <h2 className="text-lg font-semibold text-zinc-950 dark:text-zinc-50">
            {snapshot.statusText}
          </h2>
          {agentWaitStatus !== 'idle' && (
            <span className="rounded-full border border-emerald-700/25 bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-800 dark:border-emerald-400/25 dark:bg-emerald-950 dark:text-emerald-300">
              {agentWaitStatus === 'waiting'
                ? 'Agent waiting for your move'
                : 'Agent wait timed out'}
            </span>
          )}
        </div>

        <div className="relative mx-auto aspect-square w-full max-w-225 overflow-hidden rounded-lg">
          <Chessboard options={boardOptions} />
          {pendingPromotion && (
            <div className="absolute inset-0 flex items-center justify-center bg-white/90 p-4 dark:bg-zinc-950/90">
              <div className="flex flex-col items-center gap-4 rounded-lg border border-black/10 bg-white p-5 shadow-xl dark:border-white/10 dark:bg-zinc-900">
                <p className="text-sm font-semibold text-zinc-950 dark:text-zinc-50">
                  Promote pawn to
                </p>
                <div className="flex gap-2">
                  {(['q', 'r', 'b', 'n'] as const).map((piece) => (
                    <button
                      key={piece}
                      type="button"
                      onClick={() => handlePromotionPick(piece)}
                      className="h-10 min-w-10 rounded-md border border-black/15 px-3 text-sm font-semibold uppercase text-zinc-950 transition-colors hover:bg-zinc-100 focus-visible:outline-2 focus-visible:outline-emerald-700 dark:border-white/15 dark:text-zinc-50 dark:hover:bg-zinc-800"
                    >
                      {piece}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => setPendingPromotion(null)}
                  className="text-xs font-medium text-zinc-500 underline underline-offset-4 hover:text-zinc-950 dark:text-zinc-400 dark:hover:text-zinc-50"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      </section>

      <aside className="flex min-w-0 flex-col gap-4">
        {(coachNote || coachSuggestions.length > 0) && (
          <section className="flex flex-col gap-3 rounded-lg border border-black/10 bg-white p-5 text-sm shadow-sm dark:border-white/10 dark:bg-zinc-900">
            <h2 className="font-semibold text-zinc-950 dark:text-zinc-50">
              Coach suggestions
            </h2>
            {coachNote && (
              <p className="leading-6 text-zinc-600 dark:text-zinc-400">
                {coachNote}
              </p>
            )}
            {coachSuggestions.length > 0 && (
              <ol className="flex flex-col gap-3">
                {coachSuggestions.map((suggestion, index) => (
                  <li key={index} className="flex items-start gap-2.5">
                    <span
                      className="mt-1 h-3 w-3 shrink-0 rounded-full"
                      style={{ backgroundColor: suggestion.color }}
                    />
                    <div>
                      <span className="font-semibold text-zinc-950 dark:text-zinc-50">
                        {suggestion.from}–{suggestion.to}
                      </span>
                      {suggestion.reason && (
                        <p className="mt-0.5 leading-5 text-zinc-600 dark:text-zinc-400">
                          {suggestion.reason}
                        </p>
                      )}
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </section>
        )}

        <section className="flex max-h-80 flex-col gap-3 overflow-auto rounded-lg border border-black/10 bg-white p-5 text-sm shadow-sm dark:border-white/10 dark:bg-zinc-900">
          <h2 className="font-semibold text-zinc-950 dark:text-zinc-50">
            Move history
          </h2>
          {historyPairs.length === 0 ? (
            <p className="text-zinc-600 dark:text-zinc-400">No moves yet.</p>
          ) : (
            <ol className="grid grid-cols-[2rem_1fr_1fr] gap-y-1.5 font-mono text-zinc-600 dark:text-zinc-400">
              {historyPairs.map((pair, index) => (
                <li key={index} className="col-span-3 grid grid-cols-subgrid">
                  <span>{index + 1}.</span>
                  <span>{pair.white}</span>
                  <span>{pair.black ?? ''}</span>
                </li>
              ))}
            </ol>
          )}
        </section>

        <section className="flex flex-col gap-3 rounded-lg border border-black/10 bg-white p-5 text-sm shadow-sm dark:border-white/10 dark:bg-zinc-900">
          <div className="flex items-center justify-between gap-3">
            <h2 className="font-semibold text-zinc-950 dark:text-zinc-50">
              WebMCP
            </h2>
            <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-600 dark:bg-emerald-400" />
          </div>
          <p className="leading-6 text-zinc-600 dark:text-zinc-400">
            <StatusLabel status={status} />
          </p>
          <details className="border-t border-black/10 pt-3 dark:border-white/10">
            <summary className="cursor-pointer text-xs font-semibold text-zinc-600 dark:text-zinc-300">
              Registered tools
            </summary>
            <code className="mt-3 block wrap-break-word font-mono text-xs leading-5 text-zinc-500 dark:text-zinc-400">
              {TOOL_NAMES.join(', ')}
            </code>
          </details>
        </section>
      </aside>
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
