import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}"
  ],
  theme: {
    extend: {
      colors: {
        canvas: "rgb(var(--color-canvas) / <alpha-value>)",
        paper: "rgb(var(--color-paper) / <alpha-value>)",
        sidebar: "rgb(var(--color-sidebar) / <alpha-value>)",
        ink: "rgb(var(--color-ink) / <alpha-value>)",
        muted: "rgb(var(--color-muted) / <alpha-value>)",
        line: "rgb(var(--color-line) / <alpha-value>)",
        accent: "rgb(var(--color-accent) / <alpha-value>)",
        accentSoft: "rgb(var(--color-accent-soft) / <alpha-value>)",
        amberSoft: "rgb(var(--color-amber-soft) / <alpha-value>)",
        roseSoft: "rgb(var(--color-rose-soft) / <alpha-value>)",
        success: "rgb(var(--color-success) / <alpha-value>)",
        fixed: "rgb(var(--color-fixed) / <alpha-value>)",
        projection: "rgb(var(--color-projection) / <alpha-value>)",
        spend: "rgb(var(--color-spend) / <alpha-value>)",
        usage: "rgb(var(--color-usage) / <alpha-value>)",
        brandGreen: "rgb(var(--color-brand-green) / <alpha-value>)",
        brandTeal: "rgb(var(--color-brand-teal) / <alpha-value>)"
      },
      boxShadow: {
        soft: "var(--shadow-soft)"
      },
      keyframes: {
        // Subtle rise used when the live hero number updates -- a calm settle,
        // not a flash. Only applied under motion-safe.
        liveRise: {
          "0%": { opacity: "0.35", transform: "translateY(3px)" },
          "100%": { opacity: "1", transform: "translateY(0)" }
        },
        // A single expanding ring on a fresh pulse.
        livePing: {
          "0%": { transform: "scale(1)", opacity: "0.6" },
          "75%": { transform: "scale(2.4)", opacity: "0" },
          "100%": { transform: "scale(2.4)", opacity: "0" }
        },
        // Restrained rhythmic pulse for the assistant's execution-progress
        // dots -- a gentle opacity/scale breathe, staggered per-dot via
        // inline animation-delay. Deliberately small (max scale 1.15, min
        // opacity 0.35): a status heartbeat, not an attention-grabbing loader.
        assistantProgressDot: {
          "0%, 100%": { opacity: "0.35", transform: "scale(0.85)" },
          "50%": { opacity: "1", transform: "scale(1.15)" }
        }
      },
      animation: {
        liveRise: "liveRise 420ms cubic-bezier(0.22, 1, 0.36, 1)",
        livePing: "livePing 1000ms cubic-bezier(0, 0, 0.2, 1)",
        assistantProgressDot: "assistantProgressDot 1.2s ease-in-out infinite"
      },
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"]
      }
    }
  },
  plugins: []
};

export default config;
