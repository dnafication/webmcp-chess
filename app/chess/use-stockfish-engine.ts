'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
import {
  DEFAULT_ENGINE_SETTINGS,
  MAX_MOVETIME_MS,
  MAX_SKILL_LEVEL,
  MIN_MOVETIME_MS,
  MAX_ANALYSIS_DEPTH,
  MIN_ANALYSIS_DEPTH,
  clamp,
  type AnalysisResult,
  type EngineSettings
} from './chess-analysis'
import {
  EngineUnavailableError,
  StockfishEngine,
  type AnalyseRequest
} from './stockfish-engine'

export type EngineStatus = 'idle' | 'loading' | 'ready' | 'error'

export type StockfishEngineApi = {
  status: EngineStatus
  /** Download progress of the WASM binary, 0-100, or null when not downloading. */
  progress: number | null
  /** True while a search is running, whether an agent or the human asked for it. */
  isAnalysing: boolean
  error: string | null
  /** Most recent analysis; the caller decides whether it still matches the board. */
  lastAnalysis: AnalysisResult | null
  /** Warms the engine up ahead of the first tool call. */
  load: () => Promise<void>
  analyse: (request: AnalyseRequest) => Promise<AnalysisResult>
  settings: EngineSettings
  settingsRef: RefObject<EngineSettings>
  updateSettings: (next: Partial<EngineSettings>) => EngineSettings
}

// Owns the engine for the lifetime of the component and hands out callbacks
// that are stable across renders.
//
// Stability matters more than it looks: these callbacks feed the dependency
// array of the tool-registration effect, which unregisters every WebMCP tool on
// cleanup. An identity that changed each render would tear down and re-register
// all the tools continuously.
export function useStockfishEngine(): StockfishEngineApi {
  const engineRef = useRef<StockfishEngine | null>(null)
  const [status, setStatus] = useState<EngineStatus>('idle')
  const [progress, setProgress] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isAnalysing, setIsAnalysing] = useState(false)
  const [lastAnalysis, setLastAnalysis] = useState<AnalysisResult | null>(null)
  const [settings, setSettings] = useState<EngineSettings>(
    DEFAULT_ENGINE_SETTINGS
  )
  const settingsRef = useRef<EngineSettings>(DEFAULT_ENGINE_SETTINGS)

  const getEngine = useCallback(() => {
    if (!engineRef.current) {
      const engine = new StockfishEngine()
      engine.onProgress(({ percent }) => setProgress(percent))
      engineRef.current = engine
    }
    return engineRef.current
  }, [])

  const load = useCallback(async () => {
    const engine = getEngine()
    if (engine.isReady) return
    setStatus('loading')
    setError(null)
    setProgress(0)
    try {
      await engine.init()
      setStatus('ready')
      setProgress(null)
    } catch (cause) {
      setStatus('error')
      setProgress(null)
      setError(
        cause instanceof EngineUnavailableError
          ? cause.message
          : 'The chess engine failed to start.'
      )
      throw cause
    }
  }, [getEngine])

  // Counted rather than a boolean: searches are serialised inside the engine,
  // but two callers can be waiting on it at once and the last one to finish
  // must not clear the indicator for the other.
  const activeSearches = useRef(0)

  const analyse = useCallback(
    async (request: AnalyseRequest) => {
      await load()
      activeSearches.current += 1
      setIsAnalysing(true)
      try {
        const result = await getEngine().analyse(request)
        setLastAnalysis(result)
        return result
      } finally {
        activeSearches.current -= 1
        if (activeSearches.current === 0) setIsAnalysing(false)
      }
    },
    [getEngine, load]
  )

  const updateSettings = useCallback((next: Partial<EngineSettings>) => {
    const merged: EngineSettings = {
      skillLevel:
        next.skillLevel === undefined
          ? settingsRef.current.skillLevel
          : clamp(Math.round(next.skillLevel), 0, MAX_SKILL_LEVEL),
      depth:
        next.depth === undefined
          ? settingsRef.current.depth
          : clamp(Math.round(next.depth), MIN_ANALYSIS_DEPTH, MAX_ANALYSIS_DEPTH),
      movetimeMs:
        next.movetimeMs === undefined
          ? settingsRef.current.movetimeMs
          : clamp(Math.round(next.movetimeMs), MIN_MOVETIME_MS, MAX_MOVETIME_MS)
    }
    settingsRef.current = merged
    setSettings(merged)
    return merged
  }, [])

  useEffect(() => {
    return () => {
      engineRef.current?.terminate()
      engineRef.current = null
    }
  }, [])

  return {
    status,
    progress,
    isAnalysing,
    error,
    lastAnalysis,
    load,
    analyse,
    settings,
    settingsRef,
    updateSettings
  }
}
