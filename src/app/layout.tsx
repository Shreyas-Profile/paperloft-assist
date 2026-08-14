import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

import { ThemeProvider } from "@/components/theme-provider";
import { MarketingChat } from "@/components/marketing-chat";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Paperloft Assist",
  description:
    "A general-purpose AI assistant with pluggable skills, chat history, and document uploads.",
};

// Mobile viewport — without this Next.js still applies a decent default,
// but pinning it stops mobile Safari zooming out on landscape.
export const viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover" as const,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      // next-themes writes the class/style at runtime; suppressHydrationWarning
      // stops React from complaining about the intentional mismatch.
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col bg-background text-foreground">
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
          {children}
          {/* Floating chat/feedback widget on EVERY page — visitors and
              signed-in users alike. Two jobs: answer questions about
              Paperloft, and forward feedback to Shreyas on Telegram (via
              /api/support). Fixed-position, high z-index so it doesn't
              interfere with page content. */}
          <MarketingChat />
        </ThemeProvider>
      </body>
    </html>
  );
}
