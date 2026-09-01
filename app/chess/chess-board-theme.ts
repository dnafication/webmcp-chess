import type { ChessboardOptions } from 'react-chessboard'

// A classic, high-contrast green board theme. Notation labels sit in the square
// corners (react-chessboard's default placement) using colors that read clearly
// against their own square and stay clear of the piece art, which is inset from
// the square edges.
const LIGHT_SQUARE = '#ebecd0'
const DARK_SQUARE = '#779656'

export const boardThemeOptions: Pick<
  ChessboardOptions,
  | 'boardStyle'
  | 'lightSquareStyle'
  | 'darkSquareStyle'
  | 'lightSquareNotationStyle'
  | 'darkSquareNotationStyle'
  | 'alphaNotationStyle'
  | 'numericNotationStyle'
  | 'dropSquareStyle'
> = {
  boardStyle: {
    borderRadius: '12px',
    boxShadow: '0 20px 40px -24px rgba(0, 0, 0, 0.45)'
  },
  lightSquareStyle: { backgroundColor: LIGHT_SQUARE },
  darkSquareStyle: { backgroundColor: DARK_SQUARE },
  lightSquareNotationStyle: { color: DARK_SQUARE, fontWeight: 600 },
  darkSquareNotationStyle: { color: LIGHT_SQUARE, fontWeight: 600 },
  alphaNotationStyle: {
    fontSize: '12px',
    position: 'absolute',
    bottom: 3,
    right: 5,
    userSelect: 'none'
  },
  numericNotationStyle: {
    fontSize: '12px',
    position: 'absolute',
    top: 3,
    left: 5,
    userSelect: 'none'
  },
  dropSquareStyle: {
    boxShadow: 'inset 0 0 0 3px rgba(37, 99, 235, 0.65)'
  }
}
