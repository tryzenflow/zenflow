import * as React from "react"
import { cn } from "../../lib/utils"

interface SidebarProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: 'default' | 'compact'
}

const Sidebar = React.forwardRef<HTMLDivElement, SidebarProps>(
  ({ className, variant = 'default', ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={cn(
          "flex h-full w-64 flex-col border-r border-secondary-200 bg-white",
          variant === 'compact' && "w-16",
          className
        )}
        {...props}
      />
    )
  }
)
Sidebar.displayName = "Sidebar"

const SidebarHeader = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("flex h-16 items-center border-b border-secondary-200 px-6", className)}
    {...props}
  />
))
SidebarHeader.displayName = "SidebarHeader"

const SidebarContent = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("flex-1 overflow-y-auto p-4", className)}
    {...props}
  />
))
SidebarContent.displayName = "SidebarContent"

const SidebarFooter = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("border-t border-secondary-200 p-4", className)}
    {...props}
  />
))
SidebarFooter.displayName = "SidebarFooter"

const SidebarItem = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & {
    active?: boolean
  }
>(({ className, active = false, ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      "flex items-center rounded-md px-3 py-2 text-sm font-medium transition-colors hover:bg-secondary-100 hover:text-secondary-900",
      active && "bg-primary-50 text-primary-700",
      className
    )}
    {...props}
  />
))
SidebarItem.displayName = "SidebarItem"

const SidebarGroup = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & {
    title?: string
  }
>(({ className, title, children, ...props }, ref) => (
  <div ref={ref} className={cn("space-y-1", className)} {...props}>
    {title && (
      <div className="px-3 py-2 text-xs font-semibold text-secondary-500 uppercase tracking-wider">
        {title}
      </div>
    )}
    {children}
  </div>
))
SidebarGroup.displayName = "SidebarGroup"

export {
  Sidebar,
  SidebarHeader,
  SidebarContent,
  SidebarFooter,
  SidebarItem,
  SidebarGroup,
}
