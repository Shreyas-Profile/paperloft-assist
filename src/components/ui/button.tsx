"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

// Minimal shadcn-style button. Small subset of variants + sizes; expand as needed.

type Variant = "default" | "ghost" | "outline";
type Size = "default" | "icon" | "sm";

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  asChild?: boolean;
}

const variantClasses: Record<Variant, string> = {
  default:
    "bg-foreground text-background hover:opacity-90 border border-transparent",
  ghost:
    "bg-transparent hover:bg-foreground/5 border border-transparent",
  outline:
    "bg-transparent hover:bg-foreground/5 border border-border",
};

const sizeClasses: Record<Size, string> = {
  default: "h-9 px-4 text-sm rounded-md",
  sm: "h-8 px-3 text-xs rounded-md",
  icon: "h-9 w-9 rounded-md relative",
};

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "default", size = "default", asChild, ...props }, ref) => {
    // asChild = render props onto the child element instead of a <button>.
    // For the tiny use case we have (DropdownMenuTrigger asChild), just render a <button>.
    return (
      <button
        ref={ref}
        className={cn(
          "inline-flex items-center justify-center gap-2 font-medium transition disabled:opacity-50 disabled:pointer-events-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/40",
          variantClasses[variant],
          sizeClasses[size],
          className,
        )}
        {...props}
      />
    );
  },
);
Button.displayName = "Button";
