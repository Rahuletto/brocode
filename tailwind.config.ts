import type { Config } from "tailwindcss";

export default {
  content: ["./app/**/{**,.client,.server}/**/*.{js,jsx,ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Clash Display", "system-ui"],
      },
      colors: {
        background: "#10100E",
        foreground: "#FFFFE3",
      },
    },
  },
  plugins: [],
} satisfies Config;
