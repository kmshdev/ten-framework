import type { Metadata } from "next";
import { Antonio, Archivo, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const antonio = Antonio({
  subsets: ["latin"],
  weight: ["600", "700"],
  variable: "--font-antonio",
});

const archivo = Archivo({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-archivo",
});

const jetbrains = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-jetbrains",
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
        className={`${antonio.variable} ${archivo.variable} ${jetbrains.variable} font-body`}
      >
        {children}
      </body>
    </html>
  );
}
