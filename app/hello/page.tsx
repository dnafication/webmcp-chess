import type { Metadata } from 'next'
import Link from 'next/link'
import WebMcpHello from './webmcp-hello'

export const metadata: Metadata = {
  title: 'Hello World | WebMCP',
  description: 'A minimal greeting action exposed through a WebMCP tool.'
}

export default function HelloPage() {
  return (
    <div className="flex min-h-screen flex-1 flex-col bg-zinc-100 font-sans dark:bg-zinc-950">
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-4 py-8 sm:px-8 sm:py-12">
        <header className="mb-10 border-b border-black/10 pb-7 dark:border-white/10">
          <Link
            href="/"
            className="text-sm font-medium text-zinc-600 underline decoration-zinc-300 underline-offset-4 transition-colors hover:text-zinc-950 dark:text-zinc-400 dark:decoration-zinc-700 dark:hover:text-zinc-50"
          >
            Back to chess
          </Link>
          <h1 className="mt-7 text-3xl font-semibold leading-tight text-zinc-950 dark:text-zinc-50 sm:text-4xl">
            WebMCP Hello World
          </h1>
          <p className="mt-3 max-w-xl text-base leading-7 text-zinc-600 dark:text-zinc-400">
            A single greeting action, callable through the form or by an AI
            agent through a registered WebMCP tool.
          </p>
        </header>
        <WebMcpHello />
      </main>
    </div>
  )
}