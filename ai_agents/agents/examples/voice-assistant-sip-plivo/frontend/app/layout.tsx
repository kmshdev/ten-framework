import type { Metadata } from "next";
import { Archivo, JetBrains_Mono, Source_Serif_4 } from "next/font/google";
import "@livekit/components-styles";
import "./globals.css";

const sourceSerif = Source_Serif_4({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-source-serif",
  fallback: ["Charter", "Georgia", "serif"],
});

const archivo = Archivo({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-archivo",
  fallback: ["Arial", "sans-serif"],
});

const jetbrains = JetBrains_Mono({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-jetbrains",
  fallback: ["SFMono-Regular", "Consolas", "monospace"],
});

export const metadata: Metadata = {
  title: "SuperYou Voice Agent",
  description:
    "Live console for the SuperYou voice-AI customer support agent (TEN Framework)",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body
        className={`${sourceSerif.variable} ${archivo.variable} ${jetbrains.variable} font-body`}
      >
        {children}
      </body>
    </html>
  );
}
