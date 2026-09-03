import ChessGame from './chess/chess-game'
import HeaderLinks from './header-links'

export default function Home() {
  return (
    <div className="flex min-h-screen flex-1 flex-col bg-zinc-100 font-sans dark:bg-zinc-950">
      <main className="mx-auto flex w-full max-w-350 flex-1 flex-col px-4 py-6 sm:px-8 sm:py-8 lg:px-10">
        <header className="mb-8 flex flex-col gap-5 border-b border-black/10 pb-6 dark:border-white/10 sm:flex-row sm:items-start sm:justify-between">
          <div className="max-w-2xl">
            <p className="mb-2 text-xs font-semibold uppercase text-emerald-700 dark:text-emerald-400">
              Human and agent play
            </p>
            <h1 className="text-3xl font-semibold leading-tight text-zinc-950 dark:text-zinc-50 sm:text-4xl">
              WebMCP Chess
            </h1>
            <p className="mt-3 max-w-xl text-base leading-7 text-zinc-600 dark:text-zinc-400">
              Play on the board or invite an AI agent to join as an opponent or
              coach through registered WebMCP tools.
            </p>
          </div>
          <HeaderLinks className="self-end sm:self-auto" />
        </header>
        <div className="flex w-full flex-1 items-start justify-center">
          <ChessGame />
        </div>
      </main>
    </div>
  )
}
