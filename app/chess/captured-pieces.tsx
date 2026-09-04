import { PIECE_GLYPHS, type CapturedPiece, type PlayerColor } from './chess-helpers'

const PIECE_NAMES: Record<CapturedPiece, string> = {
  p: 'pawn',
  n: 'knight',
  b: 'bishop',
  r: 'rook',
  q: 'queen'
}

type CapturedPiecesProps = {
  // The side that made these captures — also picks the glyph style (outline vs filled).
  color: PlayerColor
  pieces: CapturedPiece[]
  // The +N to show for this side, or null when level or trailing.
  advantage: number | null
}

// Turns a captured-piece list into a readable phrase, e.g. "2 pawns and a knight".
function describeCaptures(pieces: CapturedPiece[]): string {
  if (pieces.length === 0) return 'no pieces'
  const counts = new Map<CapturedPiece, number>()
  for (const piece of pieces) counts.set(piece, (counts.get(piece) ?? 0) + 1)
  const parts = [...counts.entries()].map(([piece, count]) =>
    count === 1 ? `a ${PIECE_NAMES[piece]}` : `${count} ${PIECE_NAMES[piece]}s`
  )
  if (parts.length === 1) return parts[0]
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
}

// Fixed-height row of captured-piece glyphs plus a net-material figure, so an
// empty strip doesn't shift the board — same reasoning as the move-feedback slot.
export default function CapturedPieces({
  color,
  pieces,
  advantage
}: CapturedPiecesProps) {
  const side = color === 'w' ? 'White' : 'Black'
  const label = `${side} has captured ${describeCaptures(pieces)}${
    advantage !== null ? `, ahead by ${advantage}` : ''
  }`

  return (
    <div className="flex min-h-6 items-center gap-2" role="img" aria-label={label}>
      <span
        aria-hidden="true"
        className="flex flex-wrap gap-0.5 text-xl leading-none text-zinc-700 dark:text-zinc-200"
      >
        {pieces.map((piece, index) => (
          <span key={index}>{PIECE_GLYPHS[color][piece]}</span>
        ))}
      </span>
      {advantage !== null && (
        <span className="text-sm font-semibold text-zinc-600 dark:text-zinc-300">
          +{advantage}
        </span>
      )}
    </div>
  )
}
