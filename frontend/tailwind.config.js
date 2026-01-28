/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        "primary": "#2b9dee",
        "background-light": "#f6f7f8",
        "background-dark": "#101a22",
      },
      fontFamily: {
        "display": ["Inter", "Noto Sans Hebrew", "sans-serif"]
      },
    },
  },
  plugins: [],
}
