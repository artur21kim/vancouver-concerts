'use client'

// SCRUM-52 / SCRUM-53: Footer with Data Sources link
// CC BY-NC-SA 4.0 attribution lives at /data-sources (per SCRUM-53)
export default function Footer() {
  const year = new Date().getFullYear()

  return (
    <footer className="border-t border-border bg-background">
      <div className="max-w-7xl mx-auto px-4 py-4 flex flex-col sm:flex-row items-center justify-between gap-2">

        {/* Left: data sources link — satisfies CC BY-NC-SA 4.0 attribution requirement */}
        <p className="text-xs text-muted-foreground text-center sm:text-left">
          <a href="/data-sources" className="underline hover:text-foreground transition-colors">
            Data sources
          </a>
        </p>

        {/* Right: legal links + copyright */}
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
