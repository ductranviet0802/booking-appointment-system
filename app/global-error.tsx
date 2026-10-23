"use client";

// spec-screen: ER-02
// Replaces the root layout when it fails: own <html>, no providers and no header.
import "./globals.css";
import { Er02Root } from "@/components/frame/Er02";

export default function GlobalError() {
  return (
    <html lang="ja">
      <body>
        <Er02Root />
      </body>
    </html>
  );
}
