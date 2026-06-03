'use client'

import { useState } from 'react'

type AvatarSize = 'sm' | 'md' | 'lg'

const SIZE_CLASSES: Record<AvatarSize, { wh: string; text: string }> = {
  sm: { wh: 'w-7 h-7',   text: 'text-xs'  },
  md: { wh: 'w-9 h-9',   text: 'text-sm'  },
  lg: { wh: 'w-12 h-12', text: 'text-base' },
}

export default function Avatar({
  avatarUrl,
  username,
  size = 'md',
  className = '',
}: {
  avatarUrl?: string | null
  username: string
  size?: AvatarSize
  className?: string
}) {
  const [imgError, setImgError] = useState(false)
  const { wh, text } = SIZE_CLASSES[size]
  const initial = username?.[0]?.toUpperCase() ?? '?'

  if (avatarUrl && !imgError) {
    return (
      <img
        src={avatarUrl}
        alt={username}
        onError={() => setImgError(true)}
        className={`${wh} rounded-full object-cover flex-shrink-0 ${className}`}
      />
    )
  }

  return (
    <div
      className={`${wh} ${text} rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0 font-semibold text-primary ${className}`}
    >
      {initial}
    </div>
  )
}
