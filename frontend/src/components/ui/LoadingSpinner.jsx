import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

const sizeMap = {
  sm: 'h-4 w-4',
  md: 'h-8 w-8',
  lg: 'h-12 w-12',
}

function LoadingSpinner({
  size = 'md',
  fullscreen = false,
  label,
  className,
  iconClassName,
  ...props
}) {
  const spinner = (
    <Loader2
      data-slot="loading-spinner-icon"
      className={cn('animate-spin text-blue-600', sizeMap[size] ?? sizeMap.md, iconClassName)}
      aria-hidden="true"
    />
  )

  const content = (
    <div
      role="status"
      aria-live="polite"
      aria-label={label ?? '読み込み中'}
      className="flex flex-col items-center justify-center gap-3"
    >
      {spinner}
      {label ? (
        <p className="text-sm text-gray-600">{label}</p>
      ) : (
        <span className="sr-only">読み込み中</span>
      )}
    </div>
  )

  if (fullscreen) {
    return (
      <div
        data-slot="loading-spinner"
        className={cn(
          'fixed inset-0 z-50 flex items-center justify-center bg-white/70 backdrop-blur-sm',
          className
        )}
        {...props}
      >
        {content}
      </div>
    )
  }

  return (
    <div
      data-slot="loading-spinner"
      className={cn('flex items-center justify-center', className)}
      {...props}
    >
      {content}
    </div>
  )
}

export { LoadingSpinner }
