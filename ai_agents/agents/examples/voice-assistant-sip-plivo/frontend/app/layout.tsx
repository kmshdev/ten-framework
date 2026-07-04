import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "SuperYou Support AI — Ops Console",
  description:
    "Operations console for the SuperYou voice-AI customer support demo",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <div className="min-h-screen bg-orange-50/40">
          <header className="border-orange-100 border-b bg-white/90 shadow-sm backdrop-blur">
            <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
              <div className="flex items-center justify-between py-5">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-orange-500 font-black text-lg text-white shadow-md shadow-orange-500/30">
                    SY
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h1 className="font-bold text-gray-900 text-xl tracking-tight">
                        SuperYou Support AI
                      </h1>
                      <span className="inline-flex items-center gap-1 rounded-full bg-orange-100 px-2 py-0.5 font-semibold text-[10px] text-orange-700 uppercase tracking-wider">
                        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-orange-500" />
                        Live Demo
                      </span>
                    </div>
                    <p className="text-gray-500 text-xs">Ops Console</p>
                  </div>
                </div>
                <div className="hidden text-gray-400 text-sm sm:block">
                  Powered by TEN Framework
                </div>
              </div>
            </div>
          </header>
          <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
            {children}
          </main>
        </div>
      </body>
    </html>
  );
}
