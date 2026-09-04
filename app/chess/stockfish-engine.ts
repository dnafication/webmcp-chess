import { Chess } from 'chess.js'
import {
  DEFAULT_ANALYSIS_DEPTH,
  DEFAULT_MULTI_PV,
  MAX_MOVETIME_MS,
  MAX_SKILL_LEVEL,
  buildEngineLine,
  parseInfoLine,
  splitUciMove,
  type AnalysisResult,
  type EngineLine,
  type InfoLine
} from './chess-analysis'
import type { PlayerColor } from './chess-helpers'

export const ENGINE_SCRIPT_URL = '/stockfish/stockfish-18-lite-single.js'
export const ENGINE_DOWNLOAD_MB = 7

// The engine is single-threaded and one search can legitimately run for a
// while, but a WebMCP tool call must never hang a client indefinitely. Every
// search is capped, whether it was asked for by depth or by time.
const HARD_SEARCH_TIMEOUT_MS = 20_000
const HANDSHAKE_TIMEOUT_MS = 120_000

export type EngineProgress = { percent: number }

export type AnalyseRequest = {
  fen: string
  depth?: number
  multiPv?: number
  movetimeMs?: number
  /** Skill Level for this search. Analysis always uses full strength. */
  skillLevel?: number
  signal?: AbortSignal
}

export class EngineUnavailableError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'EngineUnavailableError'
  }
}

type PendingSearch = {
  fen: string
  turn: PlayerColor
  /** Deepest info line seen so far, keyed by MultiPV index. */
  best: Map<number, InfoLine>
  startedAt: number
  resolve: (result: AnalysisResult) => void
  reject: (reason: unknown) => void
  settle: (outcome: { ok: true } | { ok: false; reason: unknown }) => void
}

// A thin UCI client over a Stockfish Web Worker.
//
// Two things this class exists to guarantee, both of which fail silently if you
// get them wrong: only one search runs at a time (the engine has a single
// command stream, so overlapping searches interleave their `info` lines into
// nonsense), and sticky UCI options are always reconciled before a search
// rather than assumed.
export class StockfishEngine {
  private worker: Worker | null = null
  private progressPort: MessagePort | null = null
  private initPromise: Promise<void> | null = null
  private search: PendingSearch | null = null
  /** Serialises every request onto a single chain. */
  private queue: Promise<unknown> = Promise.resolve()
  private handshakeListeners = new Set<(line: string) => void>()
  private progressListeners = new Set<(progress: EngineProgress) => void>()
  private disposed = false

  // Mirrors of the engine's sticky UCI options, so we only send `setoption`
  // when a value actually changes.
  private appliedSkillLevel: number | null = null
  private appliedMultiPv: number | null = null
  private lastRootFen: string | null = null

  get isReady(): boolean {
    return this.worker !== null && this.initPromise !== null && !this.disposed
  }

  onProgress(listener: (progress: EngineProgress) => void): () => void {
    this.progressListeners.add(listener)
    return () => this.progressListeners.delete(listener)
  }

  // Spawns the worker and completes the UCI handshake. Idempotent: concurrent
  // callers share one in-flight promise, and a failed init clears itself so a
  // later attempt can retry.
  init(): Promise<void> {
    if (this.disposed) {
      return Promise.reject(
        new EngineUnavailableError('The chess engine has been shut down.')
      )
    }
    if (this.initPromise) return this.initPromise

    this.initPromise = this.startWorker().catch((error) => {
      this.initPromise = null
      this.teardownWorker()
      throw error instanceof EngineUnavailableError
        ? error
        : new EngineUnavailableError(
            'The chess engine failed to start in this browser.',
            { cause: error }
          )
    })
    return this.initPromise
  }

  private async startWorker(): Promise<void> {
    if (typeof Worker === 'undefined' || typeof WebAssembly === 'undefined') {
      throw new EngineUnavailableError(
        'This browser does not support the Web Worker plus WebAssembly combination the engine needs.'
      )
    }

    const worker = new Worker(ENGINE_SCRIPT_URL)
    this.worker = worker
    worker.onmessage = (event) => this.handleMessage(event.data)
    worker.onerror = () => this.failActiveSearch(
      new EngineUnavailableError('The chess engine worker crashed.')
    )

    // The glue script never reports WASM download progress over its regular
    // message stream. It only does so on a MessagePort handed to it via a
    // `{ progressPort }` message, and the fetch starts as soon as the worker
    // script runs, so this must be wired up before anything else.
    const progressChannel = new MessageChannel()
    this.progressPort = progressChannel.port1
    this.progressPort.onmessage = (event) => this.handleProgressMessage(event.data)
    worker.postMessage({ progressPort: progressChannel.port2 }, [progressChannel.port2])

    // The first handshake also covers downloading and instantiating the WASM,
    // so it gets a generous budget compared with a search.
    await this.awaitLine('uciok', 'uci', HANDSHAKE_TIMEOUT_MS)
    await this.awaitLine('readyok', 'isready', HANDSHAKE_TIMEOUT_MS)
  }

  // Sends a command and waits for the line the engine answers it with.
  private awaitLine(
    expected: string,
    command: string,
    timeoutMs: number
  ): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        cleanup()
        reject(
          new EngineUnavailableError(
            `The chess engine did not respond with "${expected}" in time.`
          )
        )
      }, timeoutMs)

      const listener = (line: string) => {
        if (line !== expected && !line.startsWith(`${expected} `)) return
        cleanup()
        resolve()
      }
      const cleanup = () => {
        clearTimeout(timeoutId)
        this.handshakeListeners.delete(listener)
      }

      this.handshakeListeners.add(listener)
      this.send(command)
    })
  }

  private send(command: string) {
    this.worker?.postMessage(command)
  }

  // The glue script reports `percent` as a 0-1 fraction (bytesLoaded /
  // bytesTotal), not a 0-100 percentage.
  private handleProgressMessage(data: unknown) {
    const fraction = (data as { percent?: unknown } | null)?.percent
    if (typeof fraction !== 'number') return
    const percent = Math.max(0, Math.min(100, fraction * 100))
    for (const listener of this.progressListeners) {
      listener({ percent })
    }
  }

  // Download-progress objects arrive on their own port (see startWorker), so
  // every message on the worker's regular stream is a UCI string.
  private handleMessage(data: unknown) {
    if (typeof data !== 'string') return

    const line = data.trim()
    if (line.length === 0) return

    for (const listener of [...this.handshakeListeners]) listener(line)

    const search = this.search
    if (!search) return

    if (line.startsWith('info ')) {
      const info = parseInfoLine(line)
      // Keep only the deepest line seen per MultiPV index. Stockfish streams
      // shallower results for the same index as it iterates.
      if (info && info.pv.length > 0) {
        const existing = search.best.get(info.multipv)
        if (!existing || (info.depth ?? 0) >= (existing.depth ?? 0)) {
          search.best.set(info.multipv, info)
        }
      }
      return
    }

    if (line.startsWith('bestmove')) {
      this.completeSearch(line)
    }
  }

  private completeSearch(bestmoveLine: string) {
    const search = this.search
    if (!search) return

    const raw = bestmoveLine.split(/\s+/)[1] ?? null
    const bestMoveUci = raw && splitUciMove(raw) ? raw : null

    const lines: EngineLine[] = []
    let depthReached = 0
    let nodes = 0

    for (const info of [...search.best.values()].sort(
      (a, b) => a.multipv - b.multipv
    )) {
      const line = buildEngineLine(info, search.fen, search.turn)
      if (!line) continue
      lines.push(line)
      depthReached = Math.max(depthReached, info.depth ?? 0)
      nodes = Math.max(nodes, info.nodes ?? 0)
    }

    search.settle({ ok: true })
    search.resolve({
      fen: search.fen,
      turn: search.turn,
      depthReached,
      timeMs: Date.now() - search.startedAt,
      nodes,
      bestMoveUci,
      lines
    })
  }

  private failActiveSearch(reason: unknown) {
    const search = this.search
    if (!search) return
    search.settle({ ok: false, reason })
    search.reject(reason)
  }

  // Every public request funnels through here so searches can never overlap.
  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task, task)
    // Keep the chain alive even when a task rejects, so one failed search does
    // not poison every later one.
    this.queue = run.then(
      () => undefined,
      () => undefined
    )
    return run
  }

  async analyse(request: AnalyseRequest): Promise<AnalysisResult> {
    await this.init()
    return this.enqueue(() => this.runSearch(request))
  }

  // Convenience wrapper for "just give me a move to play", at whatever strength
  // the caller asks for.
  async bestMove(request: AnalyseRequest): Promise<EngineLine | null> {
    const result = await this.analyse({ ...request, multiPv: 1 })
    return result.lines[0] ?? null
  }

  private async runSearch(request: AnalyseRequest): Promise<AnalysisResult> {
    if (!this.worker) {
      throw new EngineUnavailableError('The chess engine is not running.')
    }
    if (request.signal?.aborted) throw request.signal.reason

    let turn: PlayerColor
    try {
      turn = new Chess(request.fen).turn()
    } catch {
      throw new Error(`Not a valid FEN: ${request.fen}`)
    }

    const multiPv = request.multiPv ?? DEFAULT_MULTI_PV
    const skillLevel = request.skillLevel ?? MAX_SKILL_LEVEL

    await this.applyStickyOptions({ multiPv, skillLevel, fen: request.fen })

    return new Promise<AnalysisResult>((resolve, reject) => {
      let settled = false
      const signal = request.signal

      const settle = (outcome: { ok: true } | { ok: false; reason: unknown }) => {
        if (settled) return
        settled = true
        clearTimeout(timeoutId)
        signal?.removeEventListener('abort', handleAbort)
        this.search = null
        if (!outcome.ok) {
          // Leave the engine idle for the next caller rather than mid-search.
          this.send('stop')
        }
      }

      const handleAbort = () => {
        const reason = signal?.reason ?? new Error('Analysis aborted.')
        settle({ ok: false, reason })
        reject(reason)
      }

      const timeoutId = setTimeout(() => {
        settle({
          ok: false,
          reason: new Error('The engine search exceeded its time budget.')
        })
        reject(new Error('The engine search exceeded its time budget.'))
      }, HARD_SEARCH_TIMEOUT_MS)

      this.search = {
        fen: request.fen,
        turn,
        best: new Map(),
        startedAt: Date.now(),
        resolve,
        reject,
        settle
      }

      signal?.addEventListener('abort', handleAbort, { once: true })

      this.send(`position fen ${request.fen}`)
      this.send(this.buildGoCommand(request))
    })
  }

  // `go movetime` wins when given, because a caller asking for a time budget
  // wants a bounded wait more than it wants a specific depth.
  private buildGoCommand(request: AnalyseRequest): string {
    if (typeof request.movetimeMs === 'number') {
      return `go movetime ${Math.min(request.movetimeMs, MAX_MOVETIME_MS)}`
    }
    return `go depth ${request.depth ?? DEFAULT_ANALYSIS_DEPTH}`
  }

  // MultiPV and Skill Level persist across searches. Skill Level in particular
  // is a trap: if the agent drops it to 3 to play a weak game, an analysis that
  // does not reset it starts handing out deliberately bad advice.
  private async applyStickyOptions({
    multiPv,
    skillLevel,
    fen
  }: {
    multiPv: number
    skillLevel: number
    fen: string
  }) {
    let needsReady = false

    if (this.appliedSkillLevel !== skillLevel) {
      this.send(`setoption name Skill Level value ${skillLevel}`)
      this.appliedSkillLevel = skillLevel
      needsReady = true
    }
    if (this.appliedMultiPv !== multiPv) {
      this.send(`setoption name MultiPV value ${multiPv}`)
      this.appliedMultiPv = multiPv
      needsReady = true
    }
    // A fresh root position means the previous search tree is unrelated, so
    // clear it rather than letting stale entries bias the new one.
    if (this.lastRootFen !== fen) {
      this.send('ucinewgame')
      this.lastRootFen = fen
      needsReady = true
    }

    if (needsReady) {
      await this.awaitLine('readyok', 'isready', HANDSHAKE_TIMEOUT_MS)
    }
  }

  private teardownWorker() {
    this.progressPort?.close()
    this.progressPort = null
    if (!this.worker) return
    this.worker.onmessage = null
    this.worker.onerror = null
    this.worker.terminate()
    this.worker = null
    this.appliedSkillLevel = null
    this.appliedMultiPv = null
    this.lastRootFen = null
  }

  terminate() {
    this.disposed = true
    this.failActiveSearch(new EngineUnavailableError('The chess engine was shut down.'))
    this.handshakeListeners.clear()
    this.progressListeners.clear()
    this.teardownWorker()
    this.initPromise = null
  }
}
