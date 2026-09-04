# Stockfish engine assets

These files are **unmodified** build artefacts copied from the `stockfish` npm
package. Nothing in this directory is generated or patched by this repository.

| Item | Value |
| --- | --- |
| Package | [`stockfish`](https://www.npmjs.com/package/stockfish) |
| Version | 18.0.8 |
| Source | <https://github.com/nmrugg/stockfish.js> |
| Upstream engine | <https://github.com/official-stockfish/Stockfish> |
| Build flavour | `lite-single` (single-threaded, small NNUE net) |
| Licence | GPL-3.0, full text in `COPYING.txt` |

## Files

| File | Bytes | SHA-256 |
| --- | --- | --- |
| `stockfish-18-lite-single.js` | 21,429 | `5243fd9b276cab7dfe3ad1d43ab9ead73568fac76468c614242977a210c4a391` |
| `stockfish-18-lite-single.wasm` | 7,295,411 | `a8fbc05ec6920b56d7485826dcb02c5ffd2826bcbf751cf973046f237a9096f1` |

Fetched from:

```
https://unpkg.com/stockfish@18.0.8/bin/stockfish-18-lite-single.js
https://unpkg.com/stockfish@18.0.8/bin/stockfish-18-lite-single.wasm
https://unpkg.com/stockfish@18.0.8/Copying.txt
```

Verify with `shasum -a 256 public/stockfish/*.js public/stockfish/*.wasm`.

## Why these files are vendored rather than installed

The `stockfish` npm package unpacks to roughly 251 MB because it ships five
build flavours, two of which carry a 113 MB NNUE network, and it runs a
`postinstall` script. Only the two `lite-single` artefacts are needed here, so
they are committed directly. That keeps installs and Vercel builds fast and
makes the deployed bytes auditable.

## Why the `lite-single` flavour

The multi-threaded builds require `SharedArrayBuffer`, which requires the page
to be cross-origin isolated (`Cross-Origin-Opener-Policy: same-origin` plus
`Cross-Origin-Embedder-Policy: require-corp`). Those headers break any
cross-origin subresource that does not send CORP, and they change how the page
can be embedded. The single-threaded build needs none of that and still reaches
depth 16-18 in about a second, which is far beyond what this app needs.

## How the WASM is located

The glue script derives its WASM URL from its own location, replacing the `.js`
extension with `.wasm`. Both files must therefore stay side by side in this
directory with matching basenames. If they ever need to diverge, the WASM URL
can be overridden via the worker URL's hash fragment:

```js
new Worker('/stockfish/stockfish-18-lite-single.js#/some/other/path.wasm')
```

## Licence

Stockfish is licensed under the GNU General Public License v3.0. Serving these
files distributes them, so the full licence text ships alongside them in
`COPYING.txt` and the upstream sources are linked above.

The application code in this repository is MIT licensed and is not a derivative
work of Stockfish: it never links against the engine, and communicates with it
only by exchanging UCI protocol strings with a separate program over
`postMessage`.
