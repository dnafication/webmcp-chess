import WebMcpHello from './webmcp-hello'

export default function Home() {
  return (
    <div className="flex flex-col flex-1 items-center justify-center bg-zinc-50 font-sans dark:bg-black">
      <main className="flex flex-1 w-full max-w-3xl flex-col items-center py-32 px-16 bg-white dark:bg-black">
        <div className="flex flex-col items-center gap-3 text-center">
          <h1 className="text-3xl font-semibold leading-10 tracking-tight text-black dark:text-zinc-50">
            WebMCP Hello World
          </h1>
          <p className="max-w-md text-lg leading-8 text-zinc-600 dark:text-zinc-400">
            A single greeting action, callable by a person through the form
            below, or by an AI agent through a registered WebMCP tool.
          </p>
        </div>
        <div className="mt-12 flex w-full flex-1 items-start justify-center">
          <WebMcpHello />
        </div>
      </main>
    </div>
  )
}
