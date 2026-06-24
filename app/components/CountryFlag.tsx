import { CA, US } from 'country-flag-icons/react/3x2'

// Local, tree-shaken SVG flags (only CA/US bundled today). Replaces emoji flags,
// which Windows does not render — flag emoji fall back to their regional-indicator
// letters ("CA"/"US") on Windows/Chrome. Extend FLAGS as new countries are added.
const FLAGS: Record<string, typeof CA> = { CA, US }

export default function CountryFlag({
  code,
  className = 'inline-block w-3.5 h-auto align-[-1px] rounded-[1px]',
  title,
}: {
  code:       string | null | undefined
  className?: string
  title?:     string
}) {
  if (!code) return null
  const Flag = FLAGS[code]
  if (!Flag) return null
  return <Flag className={className} title={title ?? code} />
}
