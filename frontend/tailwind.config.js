
/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/**/*.{js,jsx,ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        gray: {
          50: '#f9f9f9',
          100: '#f3f3f3',
          200: '#e7e7e7',
          300: '#dcdcdc',
          400: '#bfbfbf',
          500: '#8f8f8f',
          600: '#636363',
          700: '#4a4a4a',
          800: '#2f2f2f',
          900: '#111111',
        },
      },
      fontFamily: {
        sans: ['"SF Pro Text"', 'Inter', 'system-ui', 'sans-serif'],
      },
      borderRadius: {
        lg: '20px',
        xl: '32px',
      },
      boxShadow: {
        modal: '0px 30px 60px rgba(0, 0, 0, 0.25)',
      },
    },
  },
  plugins: [],
}
