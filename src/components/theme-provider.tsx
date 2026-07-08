"use client";

// Thin wrapper around next-themes.
// Kept as a client component so children can useTheme() without ceremony.

import { ThemeProvider as NextThemesProvider } from "next-themes";
import type { ComponentProps } from "react";

export function ThemeProvider(props: ComponentProps<typeof NextThemesProvider>) {
  return <NextThemesProvider {...props} />;
}
