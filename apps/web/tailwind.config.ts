import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/app/**/*.{ts,tsx}",
    "./src/components/**/*.{ts,tsx}",
    "./src/lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Navy palette inspired by Claude Design export (Hanmir Coatings)
        navy: {
          50: "#f4f6fa",
          100: "#e6ebf3",
          200: "#c8d2e3",
          300: "#9aabc6",
          500: "#4a6190",
          700: "#1f3360",
          800: "#152549",
          900: "#0b1632",
        },
        ink: {
          400: "#9aa3b2",
          500: "#6b7280",
          700: "#374151",
          900: "#111827",
        },
        risk: {
          low: "#10b981",
          medium: "#f59e0b",
          high: "#ef4444",
          critical: "#7f1d1d",
        },
      },
      fontFamily: {
        sans: [
          "Pretendard Variable",
          "Pretendard",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "Roboto",
          "Helvetica Neue",
          "Arial",
          "sans-serif",
        ],
        mono: ["JetBrains Mono", "ui-monospace", "Menlo", "monospace"],
      },
    },
  },
  plugins: [],
};

export default config;
