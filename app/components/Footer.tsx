'use client'

// SCRUM-52: setlist.fm attribution — required by CC BY-NC-SA 4.0 licence
// /privacy and /terms links go live once SCRUM-53 is deployed
export default function Footer() {
  const year = new Date().getFullYear()

  return (
    <footer className="border-t border-border bg-background">
      <div className="max-w-7xl mx-auto px-4 py-4 flex flex-col sm:flex-row items-center justify-between gap-2">

        {/* Attribution — required by CC BY-NC-SA 4.0 */}
        <p className="text-xs text-muted-foreground text-center sm:text-left">
          Concert data sourced from{' '}
          <a
            href="https://www.setlist.fm"
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-foreground transition-colors"
          >
            setlist.fm
          </a>
          {' '}under{' '}
          <a
            href="https://creativecommons.org/licenses/by-nc-sa/4.0/"
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-foreground transition-colors"
          >
            CC BY-NC-SA 4.0
          </a>
        </p>

        {/* Right side: legal links + copyright */}
        <div className="flex items-center gap-4 text-xs text-muted-foreground">
          <a href="/privacy" className="hover:text-foreground transition-colors">
            Privacy Policy
          </a>
          <a href="/terms" className="hover:text-foreground transition-colors">
            Terms
          </a>
          <span>© {year} Grooveprint</span>
        </div>

      </div>
    </footer>
  )
}
