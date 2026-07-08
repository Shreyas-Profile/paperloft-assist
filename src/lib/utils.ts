import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

// Standard shadcn/ui utility: merge Tailwind class strings while resolving conflicts.
// Lets components accept a `className` prop that overrides defaults sanely.
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
