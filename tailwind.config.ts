import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        // Wellness / spa palette
        sand: {
          50: "#faf8f5",
          100: "#f4efe8",
          200: "#e8dfd3",
          300: "#d7c8b4",
          400: "#c0aa8e",
          500: "#a98f6f",
        },
        jade: {
          50: "#f0f7f4",
          100: "#dbeee5",
          200: "#b9dccc",
          300: "#8bc3ab",
          400: "#5aa487",
          500: "#3d8a6d",
          600: "#2f6e57",
          700: "#275646",
          800: "#20443a",
          900: "#1b3831",
        },
        clay: {
          50: "#fbf6f4",
          100: "#f6e9e4",
          200: "#ecd2c8",
          300: "#dcb0a0",
          400: "#c78671",
          500: "#b16a53",
        },
        ink: {
          400: "#8b8783",
          500: "#6b6762",
          600: "#4a4640",
          700: "#332f2a",
          800: "#221f1b",
        },
        status: {
          available: "#16a34a",
          busy: "#dc2626",
          finishing: "#ea580c",
          urgent: "#b91c1c",
          ready: "#15803d",
          break: "#94a3b8",
          outside: "#9333ea",
          off: "#475569",
        },
      },
      fontFamily: {
        sans: [
          "var(--font-app)",
          "Noto Sans Thai",
          "Inter",
          "system-ui",
          "sans-serif",
        ],
      },
      boxShadow: {
        card: "0 1px 2px rgba(34,31,27,0.04), 0 8px 24px -12px rgba(34,31,27,0.12)",
        lift: "0 2px 4px rgba(34,31,27,0.06), 0 18px 40px -16px rgba(34,31,27,0.22)",
      },
      borderRadius: {
        xl: "0.875rem",
        "2xl": "1.25rem",
        "3xl": "1.75rem",
      },
    },
  },
  plugins: [],
};

export default config;
