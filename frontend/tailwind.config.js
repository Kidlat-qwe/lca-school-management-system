/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: {
          50: '#fffbeb',
          100: '#fef3c7',
          200: '#fde68a',
          300: '#fcd34d',
          400: '#fbbf24',
          500: '#f59e0b',
          600: '#d97706',
          700: '#b45309',
          800: '#92400e',
          900: '#78350f',
        },
        brown: {
          50: '#faf8f6',
          100: '#f5f0eb',
          200: '#e8ddd0',
          300: '#d4c4b0',
          400: '#b8a088',
          500: '#8b6f47',
          600: '#6b5438',
          700: '#5a4530',
          800: '#4a3828',
          900: '#3d2f22',
        },
      },
    },
  },
  plugins: [],
}

