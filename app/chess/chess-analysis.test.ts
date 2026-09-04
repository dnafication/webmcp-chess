import { describe, expect, it } from 'vitest'
import {
  buildEngineLine,
  classifyMove,
  classificationSymbol,
  normaliseScore,
  parseInfoLine,
  scoreToComparable,
  skillLevelToApproxElo,
  splitUciMove,
  uciPvToSan
} from './chess-analysis'

const START_FEN =
  'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'
// Same position with Black to move, used to prove the perspective flip.
const BLACK_TO_MOVE_FEN =
  'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1'

describe('normaliseScore', () => {
  // The whole point of this function. UCI reports from the side to move; the
  // display is always from White's. Getting it backwards would make the coach
  // recommend losing moves with total confidence.
  it('leaves White-to-move scores alone', () => {
    const score = normaliseScore({ cp: 34, mateIn: null }, 'w')
    expect(score.cpWhite).toBe(34)
    expect(score.display).toBe('+0.34')
  })

  it('flips Black-to-move centipawns into White perspective', () => {
    // Black to move, +150 for Black, which is -1.50 for White.
    const score = normaliseScore({ cp: 150, mateIn: null }, 'b')
    expect(score.cp).toBe(150)
    expect(score.cpWhite).toBe(-150)
    expect(score.display).toBe('-1.50')
  })

  it('flips Black-to-move mate scores too', () => {
    const score = normaliseScore({ cp: null, mateIn: 3 }, 'b')
    expect(score.mateIn).toBe(3)
    expect(score.mateInWhite).toBe(-3)
    expect(score.display).toBe('-M3')
  })

  it('keeps a White mate positive', () => {
    expect(normaliseScore({ cp: null, mateIn: 2 }, 'w').display).toBe('M2')
  })

  it('reads a negative Black-to-move score as a White advantage', () => {
    // Black to move and losing by two pawns is +2.00 for White.
    expect(normaliseScore({ cp: -200, mateIn: null }, 'b').display).toBe('+2.00')
  })

  it('renders a missing score rather than throwing', () => {
    expect(normaliseScore({ cp: null, mateIn: null }, 'w').display).toBe('—')
  })
})

describe('scoreToComparable', () => {
  it('ranks a shorter mate ahead of a longer one', () => {
    const mateIn1 = scoreToComparable(normaliseScore({ cp: null, mateIn: 1 }, 'w'))
    const mateIn5 = scoreToComparable(normaliseScore({ cp: null, mateIn: 5 }, 'w'))
    expect(mateIn1).toBeGreaterThan(mateIn5)
  })

  it('puts being mated below any centipawn score', () => {
    const beingMated = scoreToComparable(
      normaliseScore({ cp: null, mateIn: -2 }, 'w')
    )
    expect(beingMated).toBeLessThan(-5000)
  })
})

describe('parseInfoLine', () => {
  it('reads a multipv line', () => {
    const info = parseInfoLine(
      'info depth 18 seldepth 24 multipv 2 score cp -45 nodes 812345 nps 900000 time 903 pv e2e4 e7e5 g1f3'
    )
    expect(info).not.toBeNull()
    expect(info?.depth).toBe(18)
    expect(info?.multipv).toBe(2)
    expect(info?.cp).toBe(-45)
    expect(info?.mateIn).toBeNull()
    expect(info?.nodes).toBe(812345)
    expect(info?.timeMs).toBe(903)
    expect(info?.pv).toEqual(['e2e4', 'e7e5', 'g1f3'])
  })

  it('reads a mate score', () => {
    const info = parseInfoLine('info depth 12 score mate -3 pv e1g1')
    expect(info?.mateIn).toBe(-3)
    expect(info?.cp).toBeNull()
  })

  it('defaults multipv to 1 when the engine omits it', () => {
    expect(parseInfoLine('info depth 5 score cp 10 pv d2d4')?.multipv).toBe(1)
  })

  it('handles a promotion move in the pv', () => {
    expect(parseInfoLine('info depth 9 score cp 900 pv a7a8q')?.pv).toEqual([
      'a7a8q'
    ])
  })

  it('ignores info string chatter and lines with nothing useful', () => {
    expect(parseInfoLine('info string NNUE evaluation using net.nnue')).toBeNull()
    expect(parseInfoLine('info depth 1 seldepth 1')).toBeNull()
    expect(parseInfoLine('bestmove e2e4')).toBeNull()
  })
})

describe('splitUciMove', () => {
  it('splits a plain move', () => {
    expect(splitUciMove('e2e4')).toEqual({
      from: 'e2',
      to: 'e4',
      promotion: null
    })
  })

  it('splits a promotion', () => {
    expect(splitUciMove('e7e8q')).toEqual({
      from: 'e7',
      to: 'e8',
      promotion: 'q'
    })
  })

  it('rejects anything malformed', () => {
    expect(splitUciMove('(none)')).toBeNull()
    expect(splitUciMove('e2e9')).toBeNull()
    expect(splitUciMove('e2e4k')).toBeNull()
    expect(splitUciMove('')).toBeNull()
  })
})

describe('uciPvToSan', () => {
  it('converts a legal variation', () => {
    expect(uciPvToSan(START_FEN, ['e2e4', 'e7e5', 'g1f3'])).toEqual([
      'e4',
      'e5',
      'Nf3'
    ])
  })

  it('truncates at the first move that does not fit the position', () => {
    expect(uciPvToSan(START_FEN, ['e2e4', 'e7e5', 'e2e4'])).toEqual(['e4', 'e5'])
  })

  it('returns nothing for an invalid FEN rather than throwing', () => {
    expect(uciPvToSan('not a fen', ['e2e4'])).toEqual([])
  })
})

describe('classifyMove', () => {
  it('labels each band at its boundary', () => {
    expect(classifyMove(0)).toBe('best')
    expect(classifyMove(19)).toBe('best')
    expect(classifyMove(20)).toBe('excellent')
    expect(classifyMove(49)).toBe('excellent')
    expect(classifyMove(50)).toBe('good')
    expect(classifyMove(99)).toBe('good')
    expect(classifyMove(100)).toBe('inaccuracy')
    expect(classifyMove(199)).toBe('inaccuracy')
    expect(classifyMove(200)).toBe('mistake')
    expect(classifyMove(299)).toBe('mistake')
    expect(classifyMove(300)).toBe('blunder')
  })

  it('treats a thrown-away forced mate as a blunder regardless of centipawns', () => {
    expect(classifyMove(5, { lostForcedMate: true })).toBe('blunder')
  })

  it('treats walking into mate as a blunder', () => {
    expect(classifyMove(0, { allowedMate: true })).toBe('blunder')
  })

  it('clamps a negative loss, which happens when depths disagree', () => {
    expect(classifyMove(-40)).toBe('best')
  })
})

describe('classificationSymbol', () => {
  it('annotates only the moves worth annotating', () => {
    expect(classificationSymbol('best')).toBeNull()
    expect(classificationSymbol('good')).toBeNull()
    expect(classificationSymbol('inaccuracy')).toBe('?!')
    expect(classificationSymbol('mistake')).toBe('?')
    expect(classificationSymbol('blunder')).toBe('??')
  })
})

describe('skillLevelToApproxElo', () => {
  it('always hedges rather than quoting a rating', () => {
    expect(skillLevelToApproxElo(0)).toMatch(/roughly/)
    expect(skillLevelToApproxElo(20)).toMatch(/full strength/)
  })
})

describe('buildEngineLine', () => {
  it('builds a line with squares broken out for chess-make-move', () => {
    const info = parseInfoLine(
      'info depth 16 multipv 1 score cp 28 pv e2e4 e7e5'
    )!
    const line = buildEngineLine(info, START_FEN, 'w')
    expect(line).not.toBeNull()
    expect(line?.san).toBe('e4')
    expect(line?.from).toBe('e2')
    expect(line?.to).toBe('e4')
    expect(line?.promotion).toBeNull()
    expect(line?.pvSan).toEqual(['e4', 'e5'])
    expect(line?.score.display).toBe('+0.28')
  })

  it('flips the score when Black is to move', () => {
    const info = parseInfoLine('info depth 16 multipv 1 score cp 28 pv e7e5')!
    const line = buildEngineLine(info, BLACK_TO_MOVE_FEN, 'b')
    expect(line?.san).toBe('e5')
    expect(line?.score.display).toBe('-0.28')
  })

  it('drops a line whose moves do not fit the position', () => {
    const info = parseInfoLine('info depth 16 multipv 1 score cp 28 pv a1a8')!
    expect(buildEngineLine(info, START_FEN, 'w')).toBeNull()
  })
})

// The lines below are verbatim output from the vendored Stockfish 18 build, not
// invented examples. They are here so a change in the engine's `info` format,
// or a regression in the perspective flip, fails loudly rather than quietly
// producing plausible-looking but inverted advice.
describe('against real Stockfish 18 output', () => {
  // White to move, Qxf7 is mate in one. UCI reports `mate 1` for White.
  const WHITE_MATES_FEN =
    'r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4'

  it('reads a White mate in one as a positive mate score', () => {
    const info = parseInfoLine(
      'info depth 14 seldepth 2 multipv 1 score mate 1 nodes 35614 nps 962540 hashfull 11 time 37 pv h5f7'
    )!
    expect(info.depth).toBe(14)
    expect(info.mateIn).toBe(1)
    const line = buildEngineLine(info, WHITE_MATES_FEN, 'w')
    expect(line?.san).toBe('Qxf7#')
    expect(line?.score.display).toBe('M1')
    expect(line?.score.mateInWhite).toBe(1)
  })

  it('parses a long multipv line with hashfull between the fields it needs', () => {
    const info = parseInfoLine(
      'info depth 14 seldepth 21 multipv 2 score cp -119 nodes 35614 nps 962540 hashfull 11 time 37 pv h5g5 f6e4 g5d8 c6d8 g1f3 e4d6 c4e2 f7f6 d2d4 e5e4 f3d2 d8e6'
    )!
    expect(info.multipv).toBe(2)
    expect(info.cp).toBe(-119)
    expect(info.nodes).toBe(35614)
    expect(info.timeMs).toBe(37)
    const line = buildEngineLine(info, WHITE_MATES_FEN, 'w')
    // White to move and behind, so the display stays negative.
    expect(line?.score.display).toBe('-1.19')
    expect(line?.pvSan[0]).toBe('Qg5')
  })

  // Fool's mate: Black to move, Qh4 is mate. UCI reports `mate 1` for Black,
  // which must surface as a Black win, not a White one.
  const BLACK_MATES_FEN =
    'rnbqkbnr/pppp1ppp/8/4p3/6P1/5P2/PPPPP2P/RNBQKBNR b KQkq - 0 2'

  it('reads a Black mate in one as a negative mate score', () => {
    const info = parseInfoLine(
      'info depth 12 seldepth 2 multipv 1 score mate 1 nodes 4781 nps 434636 hashfull 1 time 11 pv d8h4'
    )!
    const line = buildEngineLine(info, BLACK_MATES_FEN, 'b')
    expect(line?.san).toBe('Qh4#')
    expect(line?.score.mateIn).toBe(1)
    expect(line?.score.mateInWhite).toBe(-1)
    expect(line?.score.display).toBe('-M1')
  })

  it("reads a positive Black-to-move centipawn score as Black's advantage", () => {
    const info = parseInfoLine(
      'info depth 12 seldepth 21 multipv 2 score cp 265 nodes 4781 nps 434636 hashfull 1 time 11 pv h7h5 f1g2 h5g4 d2d4 d8h4 e1f1 b8c6 d4e5 c6e5'
    )!
    const line = buildEngineLine(info, BLACK_MATES_FEN, 'b')
    expect(line?.score.cp).toBe(265)
    expect(line?.score.cpWhite).toBe(-265)
    expect(line?.score.display).toBe('-2.65')
    expect(line?.pvSan).toEqual([
      'h5',
      'Bg2',
      'hxg4',
      'd4',
      'Qh4+',
      'Kf1',
      'Nc6',
      'dxe5',
      'Nxe5'
    ])
  })
})
