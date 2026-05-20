/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        'amber-custom': '#FFB347',
        'danger': '#FF4444',
      },
    },
  },
  plugins: [],
}

