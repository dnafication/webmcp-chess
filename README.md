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
- Ask Stockfish for the strongest moves in the position (`chess-analyze-position`)
- Tell you whether the move you just played was a mistake, and why (`chess-evaluate-move`)
- Dial its own playing strength up or down (`chess-set-engine-strength`)
- Switch to coaching on request: rank candidate moves, draw arrows, and explain the reasoning (`chess-suggest-move`)
- Reset the game (`chess-new-game`)

A smaller example lives at `/hello`: one function, `buildGreeting()`, reachable both by a human typing a name into a form and by an agent calling the `say-hello` tool. It's the shortest possible illustration of the same idea.

## The interesting problem: waking an idle agent

WebMCP has no way to notify an idle agent that the board changed, there's no push, no application-state event it can react to. `chess-wait-for-human-move` works around that with a long-running call: the agent calls it and the call simply doesn't return until you move.

Two things keep that safe:

- **A last-seen FEN check** — if you'd already moved before the wait started, it returns immediately instead of hanging on a move that already happened.
- **A two-minute timeout and abort path** — so a call never hangs forever or blocks a second attempt.

This is a workaround for a real protocol gap, not a claim that WebMCP does push notifications. See the open design discussions on [application-driven observations](https://github.com/webmachinelearning/webmcp/issues/229), [human-in-the-loop elicitation](https://github.com/webmachinelearning/webmcp/issues/165), and [long-running tool progress](https://github.com/webmachinelearning/webmcp/issues/196).

## The engine calculates, the model explains

A legal move isn't necessarily a strong one. Early on, ChatGPT would happily propose legal but tactically losing moves, because the only thing the page told it was which moves were legal.

Stockfish 18 now runs in the page, compiled to WebAssembly in a Web Worker, and the split of labour is deliberate. The engine does the calculating: it searches the position and returns ranked lines with real evaluations. The model does the explaining: it turns a principal variation into a sentence you can learn something from. Neither is asked to do the other's job.

Three things follow from that:

- **Coaching is always full strength.** `chess-set-engine-strength` weakens the moves the agent plays against you, so it can be a beatable opponent. It never weakens the advice you're given.
- **Every score is reported from White's perspective.** UCI reports from the side to move, which is a sign flip away from how every human reads a board. Getting that backwards would produce confident, fluent, inverted advice, so both readings travel together in the tool output and the flip is [covered by tests against real engine output](app/chess/chess-analysis.test.ts).
- **Nothing moved to a server.** The engine is a static asset the page loads on demand. There's still no backend.

The engine binary is roughly 7 MB, so it downloads on the first analysis rather than on page load. There's a button in the Stockfish panel to warm it up, and it uses the same code path an agent's tool call does.

### Licensing

Stockfish is GPL-3.0. The engine build in [`public/stockfish/`](public/stockfish/) is unmodified upstream, shipped with its licence text and [provenance](public/stockfish/PROVENANCE.md) including checksums. This repository's own code stays MIT: it never links against the engine, it only exchanges UCI protocol strings with a separate program over `postMessage`.

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
pnpm test    # Vitest, covers the engine-output parsing and score perspective
pnpm build   # production build / type-check
pnpm start   # serve a production build locally
```

## Code worth reading

- [`app/chess/use-chess-webmcp-tools.ts`](app/chess/use-chess-webmcp-tools.ts) — all eight tool registrations, the wait-for-human-move logic, FEN race protection
- [`app/chess/stockfish-engine.ts`](app/chess/stockfish-engine.ts) — the UCI client: serialised searches, sticky-option reconciliation, abort handling
- [`app/chess/chess-analysis.ts`](app/chess/chess-analysis.ts) — the pure half: parsing `info` lines, the White-perspective flip, move classification
- [`app/hello/webmcp-hello.tsx`](app/hello/webmcp-hello.tsx) — the smallest possible tool registration, good starting point if you're new to WebMCP
- [`app/webmcp.d.ts`](app/webmcp.d.ts) — types for `document.modelContext`, from [`webmcp-types`](https://www.npmjs.com/package/webmcp-types)

## Learn more

- [WebMCP specification and explainer](https://github.com/webmachinelearning/webmcp)
- [WebMCP implementation status](https://github.com/webmachinelearning/webmcp/blob/main/implementation-status.md)
- [Next.js documentation](https://nextjs.org/docs)
