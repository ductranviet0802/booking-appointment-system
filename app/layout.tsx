import type { Metadata } from "next";
import "./globals.css";
import { AppProviders } from "@/components/AppProviders";

export const metadata: Metadata = {
  title: "Web予約",
};

// The ver1 common frame (CF-01 … CF-03) and the language are added by the _common module.
export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html data-testid="app-html" lang="ja" className="h-full antialiased">
      <body data-testid="app-body" suppressHydrationWarning className="min-h-full text-zinc-900">
        <AppProviders>
          <main data-testid="app-main" className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 md:px-6">
            {children}
          </main>
        </AppProviders>
      </body>
    </html>
  );
}
