import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        ink: {
          50: "#f6f4f0",
          100: "#e8e2d6",
          200: "#d4c9b4",
          800: "#2a241c",
          900: "#16130f",
          950: "#0c0a08",
        },
        gold: {
          400: "#e8c36a",
          500: "#d4a84b",
          600: "#b8892f",
          700: "#8f671f",
        },
        cream: "#f7f1e6",
        brass: "#c9a15b",
      },
      fontFamily: {
        display: ["var(--font-display)", "Georgia", "serif"],
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
      },
      boxShadow: {
        card: "0 18px 50px -24px rgba(12, 10, 8, 0.55)",
      },
    },
  },
  plugins: [],
};

export default config;
