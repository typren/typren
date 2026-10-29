import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = { title: "Typren Studio" };

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      {/* The studio fills its parent (`h-full`), so the body pins it to the viewport. */}
      <body className="h-svh">{children}</body>
    </html>
  );
}
