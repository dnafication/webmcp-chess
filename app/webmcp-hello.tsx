'use client'

import { useEffect, useId, useState } from 'react'

type SupportStatus = 'checking' | 'ready' | 'unsupported' | 'error'

const TOOL_NAME = 'say-hello'

// Shared action so the human form and the agent tool exercise identical logic.
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

    // Aborting the signal unregisters the tool.
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
    <div className="flex w-full max-w-xl flex-col gap-8">
      <div className="flex flex-col gap-2">
        <p className="text-sm font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
          Greeting
        </p>
        <p className="text-2xl font-semibold text-black dark:text-zinc-50">
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
          className="flex-1 rounded-full border border-black/8 bg-white px-5 py-3 text-base text-black outline-none focus-visible:ring-2 focus-visible:ring-black dark:border-white/[.145] dark:bg-black dark:text-zinc-50 dark:focus-visible:ring-white"
        />
        <button
          type="submit"
          className="rounded-full bg-foreground px-6 py-3 text-base font-medium text-background transition-colors hover:bg-[#383838] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black dark:hover:bg-[#ccc] dark:focus-visible:outline-white"
        >
          Say hello
        </button>
      </form>

      <div className="flex flex-col gap-2 rounded-2xl border border-black/8 p-5 text-sm dark:border-white/[.145]">
        <p className="font-medium text-black dark:text-zinc-50">
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
