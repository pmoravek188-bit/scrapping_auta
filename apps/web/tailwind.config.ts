import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#eefdf3",
          100: "#d6fadf",
          500: "#0a7d3b",
          600: "#08652f",
          700: "#074e25",
        },
      },
    },
  },
  plugins: [],
};

export default config;
