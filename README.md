# WebMCP Chess

A chess game you can play against a human, or hand over to an AI agent mid-game, on the same board, same rules, same move history. No backend MCP server. The page itself exposes its own client-side functions as tools, using [WebMCP](https://github.com/webmachinelearning/webmcp) (`document.modelContext`), a proposed web platform API.

**[Try it live](https://webmcp-chess.vercel.app/)** · [Watch the demo](https://youtu.be/V1XKsC1XuMo) · Built for the WebMCP hackathon

## Why this exists

An agent that wants to play chess with you currently has to scrape the DOM or simulate clicks. WebMCP flips that: the page registers its own tools, so the agent calls `chess-make-move` the same way a click handler would, through the same validated chess logic a human's move goes through. No fork between "the UI" and "the agent-facing API."

## What it does

Open the board and either play it yourself, or point a WebMCP-capable agent (ChatGPT's browser is the one tested here) at it and ask it to play. It will:

- Read the current position (`chess-get-board-state`)
- Make a legal move (`chess-make-move`)
- Wait for your move, then pick back up automatically (`chess-wait-for-human-move`)
- Switch to coaching on request: rank candidate moves, draw arrows, and explain the reasoning (`chess-suggest-move`)
- Reset the game (`chess-new-game`)

A smaller example lives at `/hello`: one function, `buildGreeting()`, reachable both by a human typing a name into a form and by an agent calling the `say-hello` tool. It's the shortest possible illustration of the same idea.

## The interesting problem: waking an idle agent

WebMCP has no way to notify an idle agent that the board changed, there's no push, no application-state event it can react to. `chess-wait-for-human-move` works around that with a long-running call: the agent calls it and the call simply doesn't return until you move.

Two things keep that safe:

- **A last-seen FEN check** — if you'd already moved before the wait started, it returns immediately instead of hanging on a move that already happened.
- **A two-minute timeout and abort path** — so a call never hangs forever or blocks a second attempt.

This is a workaround for a real protocol gap, not a claim that WebMCP does push notifications. See the open design discussions on [application-driven observations](https://github.com/webmachinelearning/webmcp/issues/229), [human-in-the-loop elicitation](https://github.com/webmachinelearning/webmcp/issues/165), and [long-running tool progress](https://github.com/webmachinelearning/webmcp/issues/196).

## What's next

A legal move isn't necessarily a strong one, ChatGPT has proposed legal but tactically losing moves during testing. Given more time: Stockfish would rank candidates and catch tactical mistakes deterministically, and the language model would stay on the part it's actually good at, explaining plans and tradeoffs in human terms.

## Browser support

WebMCP is an early-stage proposal, not a shipped standard. As of this writing: **ChatGPT Desktop** supports it, **Brave/Leo** has experimental support, **Chrome 149/Edge 150** support it behind an origin trial, **Firefox/Safari** don't yet. See the [implementation status](https://github.com/webmachinelearning/webmcp/blob/main/implementation-status.md) for the current picture.

Where it's unsupported, the page detects the missing `document.modelContext` API and falls back cleanly, the human UI always works standalone. It also requires a [secure context](https://developer.mozilla.org/en-US/docs/Web/Security/Secure_Contexts) (HTTPS or localhost).

## Running it locally

```bash
pnpm install
pnpm dev
```

Open [localhost:3000](http://localhost:3000) to play chess, or [localhost:3000/hello](http://localhost:3000/hello) for the minimal example.

```bash
pnpm lint    # ESLint
pnpm build   # production build / type-check
pnpm start   # serve a production build locally
```

## Code worth reading

- [`app/chess/use-chess-webmcp-tools.ts`](app/chess/use-chess-webmcp-tools.ts) — all five tool registrations, the wait-for-human-move logic, FEN race protection
- [`app/hello/webmcp-hello.tsx`](app/hello/webmcp-hello.tsx) — the smallest possible tool registration, good starting point if you're new to WebMCP
- [`app/webmcp.d.ts`](app/webmcp.d.ts) — types for `document.modelContext`, from [`webmcp-types`](https://www.npmjs.com/package/webmcp-types)

## Learn more

- [WebMCP specification and explainer](https://github.com/webmachinelearning/webmcp)
- [WebMCP implementation status](https://github.com/webmachinelearning/webmcp/blob/main/implementation-status.md)
- [Next.js documentation](https://nextjs.org/docs)
