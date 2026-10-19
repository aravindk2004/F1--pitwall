/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: { 950: "#0a0a0c", 900: "#101014", 850: "#15151a", 800: "#1b1b22", 700: "#26262f", 600: "#34343f" },
        cyan: { glow: "#22e5ff" },
        sector: { purple: "#b14cff", green: "#22c55e", yellow: "#facc15" },
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
        mono: ["'JetBrains Mono'", "ui-monospace", "monospace"],
      },
    },
  },
  plugins: [],
};
