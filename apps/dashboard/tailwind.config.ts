import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        oct: {
          bg: "#0a0a0f",
          surface: "#12121a",
          border: "#1e1e2e",
          muted: "#2a2a3e",
          accent: "#6366f1",
          "accent-dim": "#4f51c7",
          green: "#22d3a0",
          yellow: "#f59e0b",
          red: "#ef4444",
          text: "#e2e8f0",
          "text-dim": "#94a3b8",
        },
      },
      fontFamily: {
        mono: ["'JetBrains Mono'", "ui-monospace", "monospace"],
      },
    },
  },
  plugins: [],
};

export default config;
