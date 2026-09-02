'use client'

import { useEffect, useId, useState } from 'react'

type SupportStatus = 'checking' | 'ready' | 'unsupported' | 'error'

const TOOL_NAME = 'say-hello'

function buildGreeting(name: string): string {
  const trimmed = name.trim()
  return trimmed.length > 0 ? `Hello, ${trimmed}! 👋` : 'Hello there! 👋'
}

export default function WebMcpHello() {
  const [name, setName] = useState('')
  const [greeting, setGreeting] = useState(() => buildGreeting(''))
  const [status, setStatus] = useState<SupportStatus>('checking')
  const nameInputId = useId()

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
            name: TOOL_NAME,
            description:
              "Greets a person by name and updates the page's visible greeting.",
            inputSchema: {
              type: 'object',
              properties: {
                name: {
                  type: 'string',
                  description: 'The name of the person to greet.'
                }
              },
              required: ['name']
            },
            execute({ name: toolName }) {
              const text = buildGreeting(String(toolName ?? ''))
              setName(String(toolName ?? ''))
              setGreeting(text)
              return {
                content: [{ type: 'text', text }]
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

    return () => {
      cancelled = true
      controller.abort()
    }
  }, [])

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setGreeting(buildGreeting(name))
  }

  return (
    <div className="flex w-full flex-col gap-8 rounded-lg border border-black/10 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-zinc-900 sm:p-8">
      <div className="flex flex-col gap-2">
        <p className="text-xs font-semibold uppercase text-emerald-700 dark:text-emerald-400">
          Greeting
        </p>
        <p className="text-2xl font-semibold text-zinc-950 dark:text-zinc-50">
          {greeting}
        </p>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-3 sm:flex-row">
        <label htmlFor={nameInputId} className="sr-only">
          Your name
        </label>
        <input
          id={nameInputId}
          type="text"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Enter your name"
          className="min-w-0 flex-1 rounded-md border border-black/15 bg-white px-4 py-3 text-base text-zinc-950 outline-none transition focus-visible:border-emerald-600 focus-visible:ring-2 focus-visible:ring-emerald-600/20 dark:border-white/15 dark:bg-zinc-950 dark:text-zinc-50"
        />
        <button
          type="submit"
          className="rounded-md bg-emerald-700 px-6 py-3 text-base font-semibold text-white transition-colors hover:bg-emerald-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700 dark:bg-emerald-500 dark:text-zinc-950 dark:hover:bg-emerald-400"
        >
          Say hello
        </button>
      </form>

      <div className="flex flex-col gap-2 border-t border-black/10 pt-5 text-sm dark:border-white/10">
        <p className="font-medium text-zinc-950 dark:text-zinc-50">
          WebMCP tool: <code className="font-mono">{TOOL_NAME}</code>
        </p>
        <p className="text-zinc-600 dark:text-zinc-400">
          <StatusLabel status={status} />
        </p>
      </div>
    </div>
  )
}

function StatusLabel({ status }: { status: SupportStatus }) {
  switch (status) {
    case 'checking':
      return <>Checking browser support for `document.modelContext`…</>
    case 'ready':
      return (
        <>
          Registered and discoverable by an in-browser agent. Ask it to greet
          you by name.
        </>
      )
    case 'unsupported':
      return (
        <>
          This browser doesn&apos;t support WebMCP yet. The form above still
          works normally — see the README for supported browsers.
        </>
      )
    case 'error':
      return <>Tool registration failed. Check the console for details.</>
  }
}