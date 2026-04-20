import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@shared/lib/utils"

const alertVariants = cva(
  "relative w-full rounded-lg border px-4 py-3 text-sm grid has-[>svg]:grid-cols-[calc(var(--spacing)*4)_1fr] grid-cols-[0_1fr] has-[>svg]:gap-x-3 gap-y-0.5 items-start [&>svg]:size-4 [&>svg]:translate-y-0.5 [&>svg]:text-current",
  {
    variants: {
      variant: {
        default: "bg-card text-card-foreground",
        destructive:
          "text-destructive bg-card [&>svg]:text-current *:data-[slot=alert-description]:text-destructive/90",
        warning:
          "border-orange-200/70 bg-orange-50 text-orange-950 dark:bg-orange-950/30 dark:border-orange-800/50 dark:text-orange-100 [&>svg]:text-orange-600 dark:[&>svg]:text-orange-400",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Alert({
  className,
  variant,
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof alertVariants>) {
  return (
    <div
      data-slot="alert"
      role="alert"
      className={cn(alertVariants({ variant }), className)}
      {...props}
    />
  )
}

function AlertTitle({
  className,
  variant,
  ...props
}: React.ComponentProps<"div"> & { variant?: "default" | "destructive" | "warning" }) {
  return (
    <div
      data-slot="alert-title"
      className={cn(
        "col-start-2 line-clamp-1 min-h-4 font-medium tracking-tight",
        variant === "warning" && "text-orange-900 dark:text-orange-100",
        className
      )}
      {...props}
    />
  )
}

function AlertDescription({
  className,
  variant,
  ...props
}: React.ComponentProps<"div"> & { variant?: "default" | "destructive" | "warning" }) {
  return (
    <div
      data-slot="alert-description"
      className={cn(
        "text-muted-foreground col-start-2 grid justify-items-start gap-1 text-sm [&_p]:leading-relaxed",
        variant === "warning" && "text-orange-800/90 dark:text-orange-200/90",
        className
      )}
      {...props}
    />
  )
}
export { Alert, AlertTitle, AlertDescription }