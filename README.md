This is a [Next.js](https://nextjs.org) project demonstrating [WebMCP](https://github.com/webmachinelearning/webmcp), a proposed web platform API that lets a page expose its own client-side functionality as "tools" that an AI agent can discover and invoke.

## What this demo shows

There's a single domain action — greeting a person by name — reachable two ways:

1. **As a human**, through the name field and "Say hello" button on the page.
2. **As an agent**, through a WebMCP tool named `say-hello`, registered via `document.modelContext.registerTool()` in [app/webmcp-hello.tsx](app/webmcp-hello.tsx).

Both paths call the same `buildGreeting()` function and update the same on-screen state, which is the core idea behind WebMCP: reuse your existing client-side logic instead of building a separate backend integration for agents.

### The tool lifecycle

- **Registration**: On mount, the component calls `document.modelContext.registerTool()` with a name, description, and a JSON Schema requiring a `name` string.
- **Discovery**: A browser-integrated agent (or another script calling `document.modelContext.getTools()`) can see the tool and its schema.
- **Invocation**: The agent calls the tool with `{ "name": "Dina" }`; the `execute` callback updates the page's state and returns a structured result.
- **Cleanup**: The registration is tied to an `AbortController`. Aborting it on unmount unregisters the tool, matching the `signal` option in `ModelContextRegisterToolOptions`.

Types for `document.modelContext` come from the [`webmcp-types`](https://www.npmjs.com/package/webmcp-types) package (see [app/webmcp.d.ts](app/webmcp.d.ts)).

## Browser support (experimental)

WebMCP is an early-stage Web Machine Learning Community Group proposal, not a finished standard. As of this writing:

- **ChatGPT Desktop** supports it.
- **Brave** has experimental support in Leo AI chat.
- **Chrome 149** and **Edge 150** support it behind an origin trial (requires enrollment; won't work in a stock browser without it).
- **Firefox** and **Safari** don't implement it yet.

See the [implementation status](https://github.com/webmachinelearning/webmcp/blob/main/implementation-status.md) for the current picture. In any other browser, the page detects the missing `document.modelContext` API and falls back to an "unsupported" status — the human form keeps working regardless.

`document.modelContext` is also only available in a [secure context](https://developer.mozilla.org/en-US/docs/Web/Security/Secure_Contexts) (HTTPS or localhost), which a Vercel deployment satisfies automatically.

## Getting Started

```bash
pnpm install
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000) with a browser to see the result. Other useful commands:

```bash
pnpm lint    # ESLint
pnpm build   # Production build / type-check
pnpm start   # Serve a production build locally
```

## Deploying with the Vercel CLI

This project hasn't been linked to a Vercel project yet. To deploy it:

1. Check whether the CLI is installed:

   ```bash
   vercel --version
   ```

   If it isn't, you can run it without a global install via `pnpm dlx`:

   ```bash
   pnpm dlx vercel --version
   ```

2. Log in (opens a browser to authenticate):

   ```bash
   vercel login
   ```

3. From the project root, create a preview deployment. The first run prompts you to link or create a Vercel project:

   ```bash
   vercel
   ```

4. Once you're happy with a preview, promote it to production:

   ```bash
   vercel --prod
   ```

Because `document.modelContext` requires a secure context, a deployed Vercel preview URL (HTTPS) is a reliable way to test WebMCP support outside of `localhost`.

## Learn More

- [WebMCP specification and explainer](https://github.com/webmachinelearning/webmcp)
- [WebMCP implementation status](https://github.com/webmachinelearning/webmcp/blob/main/implementation-status.md)
- [Next.js Documentation](https://nextjs.org/docs)
- [Vercel CLI reference](https://vercel.com/docs/cli)
