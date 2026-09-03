const GITHUB_REPO_URL = 'https://github.com/dnafication/webmcp-chess'
const YOUTUBE_DEMO_URL = 'https://youtu.be/V1XKsC1XuMo'
const DEVPOST_URL = 'https://devpost.com/software/webmcp-chess'

export default function HeaderLinks({ className = '' }: { className?: string }) {
  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <a
        href={YOUTUBE_DEMO_URL}
        target="_blank"
        rel="noreferrer"
        aria-label="Watch the demo on YouTube"
        title="Watch the demo on YouTube"
        className="flex h-9 w-9 items-center justify-center rounded-full border border-black/10 bg-white/90 text-zinc-700 shadow-sm backdrop-blur transition-colors hover:bg-white hover:text-red-600 dark:border-white/10 dark:bg-zinc-900/90 dark:text-zinc-300 dark:hover:bg-zinc-900 dark:hover:text-red-500"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5 fill-current">
          <path d="M23.5 6.2a3.02 3.02 0 0 0-2.12-2.14C19.5 3.5 12 3.5 12 3.5s-7.5 0-9.38.56A3.02 3.02 0 0 0 .5 6.2 31.6 31.6 0 0 0 0 12a31.6 31.6 0 0 0 .5 5.8 3.02 3.02 0 0 0 2.12 2.14C4.5 20.5 12 20.5 12 20.5s7.5 0 9.38-.56a3.02 3.02 0 0 0 2.12-2.14A31.6 31.6 0 0 0 24 12a31.6 31.6 0 0 0-.5-5.8ZM9.6 15.6V8.4L15.8 12l-6.2 3.6Z" />
        </svg>
      </a>
      <a
        href={GITHUB_REPO_URL}
        target="_blank"
        rel="noreferrer"
        aria-label="View source on GitHub"
        title="View source on GitHub"
        className="flex h-9 w-9 items-center justify-center rounded-full border border-black/10 bg-white/90 text-zinc-700 shadow-sm backdrop-blur transition-colors hover:bg-white hover:text-zinc-950 dark:border-white/10 dark:bg-zinc-900/90 dark:text-zinc-300 dark:hover:bg-zinc-900 dark:hover:text-zinc-50"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5 fill-current">
          <path d="M12 .5C5.73.5.5 5.73.5 12c0 5.09 3.29 9.4 7.86 10.93.57.1.79-.25.79-.55 0-.27-.01-1.16-.02-2.11-3.2.7-3.88-1.36-3.88-1.36-.52-1.33-1.28-1.69-1.28-1.69-1.05-.72.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.56-.29-5.26-1.28-5.26-5.71 0-1.26.45-2.29 1.19-3.1-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.18 1.18a11.03 11.03 0 0 1 5.79 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.81 1.19 1.84 1.19 3.1 0 4.44-2.7 5.42-5.28 5.7.42.36.78 1.07.78 2.16 0 1.56-.01 2.82-.01 3.2 0 .3.21.66.8.55A11.5 11.5 0 0 0 23.5 12C23.5 5.73 18.27.5 12 .5Z" />
        </svg>
      </a>
      <a
        href={DEVPOST_URL}
        target="_blank"
        rel="noreferrer"
        aria-label="View hackathon submission on Devpost"
        title="View hackathon submission on Devpost"
        className="flex h-9 w-9 items-center justify-center rounded-full border border-black/10 bg-white/90 text-sm font-bold text-zinc-700 shadow-sm backdrop-blur transition-colors hover:bg-white hover:text-zinc-950 dark:border-white/10 dark:bg-zinc-900/90 dark:text-zinc-300 dark:hover:bg-zinc-900 dark:hover:text-zinc-50"
      >
        D
      </a>
    </div>
  )
}
