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
          DEFAULT: '#1e40af',
          light: '#2563eb',
          dark: '#1e3a8a',
        },
        accent: {
          green: '#10B981',
        },
        text: {
          DEFAULT: '#1F2937',
          light: '#6B7280',
        },
        section: {
          light: '#F8FAFC',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
