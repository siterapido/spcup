import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        up: {
          black: "rgb(var(--up-black) / <alpha-value>)",
          "black-hover": "rgb(var(--up-black-hover) / <alpha-value>)",
          white: "rgb(var(--up-white) / <alpha-value>)",
          yellow: "rgb(var(--up-yellow) / <alpha-value>)",
        },
        surface: {
          page: "rgb(var(--surface-page) / <alpha-value>)",
          card: "rgb(var(--surface-card) / <alpha-value>)",
        },
        muted: "rgb(var(--text-muted) / <alpha-value>)",
        border: {
          DEFAULT: "rgb(var(--border-default) / <alpha-value>)",
          input: "rgb(var(--border-input) / <alpha-value>)",
        },
        status: {
          success: {
            bg: "rgb(var(--status-success-bg) / <alpha-value>)",
            text: "rgb(var(--status-success-text) / <alpha-value>)",
          },
          danger: {
            bg: "rgb(var(--status-danger-bg) / <alpha-value>)",
            text: "rgb(var(--status-danger-text) / <alpha-value>)",
          },
          warn: {
            bg: "rgb(var(--status-warn-bg) / <alpha-value>)",
            text: "rgb(var(--status-warn-text) / <alpha-value>)",
          },
        },
      },
      borderRadius: {
        sm: "4px",
        md: "6px",
        lg: "8px",
      },
      transitionTimingFunction: {
        "out-quart": "cubic-bezier(0.25, 1, 0.5, 1)",
      },
    },
  },
  plugins: [],
};

export default config;
