import type { Config } from "tailwindcss";

export default {
  content: ["./app/**/{**,.client,.server}/**/*.{js,jsx,ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["General Sans", "system-ui"],
      },
      colors: {
        background: "#10100E",
        foreground: "#FFFFE3",
      },
      animation: {
        breathe: "breathe 2s cubic-bezier(0.14, 0.79, 0.63, 0.9) infinite",
      },
      keyframes: {
        breathe: {
          "0%, 100%": { transform: "scale(1)", opacity: "1" },
          "50%": { transform: "scale(1.1)", opacity: "0.9" },
        },
      },
    },
  },
  plugins: [],
} satisfies Config;
