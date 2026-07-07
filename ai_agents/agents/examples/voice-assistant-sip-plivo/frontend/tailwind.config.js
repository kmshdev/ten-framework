/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        paper: "var(--paper)",
        card: "var(--card)",
        inset: "var(--inset)",
        ink: {
          DEFAULT: "var(--ink)",
          2: "var(--ink-2)",
          3: "var(--ink-3)",
          mute: "var(--ink-mute)",
        },
        hairline: {
          DEFAULT: "var(--hairline)",
          soft: "var(--hairline-soft)",
        },
        voice: {
          DEFAULT: "var(--voice)",
          soft: "var(--voice-soft)",
        },
        ok: {
          DEFAULT: "var(--ok)",
          bg: "var(--ok-bg)",
        },
        attention: {
          DEFAULT: "var(--attention)",
          bg: "var(--attention-bg)",
        },
      },
      fontFamily: {
        brand: ["var(--font-antonio)", "sans-serif"],
        body: ["var(--font-archivo)", "sans-serif"],
        mono: ["var(--font-jetbrains)", "monospace"],
      },
      borderRadius: {
        sm: "3px",
        DEFAULT: "4px",
        md: "6px",
      },
    },
  },
  plugins: [],
};
