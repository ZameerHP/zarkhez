import type { Config } from 'tailwindcss';

const config: Config = {
  darkMode: ['class'],
  content: [
    './pages/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './app/**/*.{ts,tsx}',
    './lib/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        olive: {
          DEFAULT: '#6B8A1F',
          dark: '#3F5A1E',
          fresh: '#5FA52E',
        },
        wheat: '#C8962E',
        cream: '#FBF6D9',
        canvas: '#F4F5EE',
        ink: '#111111',
        alert: {
          amber: '#E0A100',
          red: '#C0392B',
        },
        emeraldBlack: 'var(--zrk-emerald-black)',
        deepForest: 'var(--zrk-deep-forest)',
        flagshipEmerald: 'var(--zrk-emerald)',
        mintGlow: 'var(--zrk-mint-glow)',
        champagneGold: 'var(--zrk-champagne-gold)',
        ivory: 'var(--zrk-ivory)',
      },
      borderRadius: {
        phone: '40px',
        card: '24px',
        tile: '16px',
        surface: 'var(--zrk-radius-surface)',
        bento: 'var(--zrk-radius-tile)',
      },
      boxShadow: {
        soft: '0 8px 30px rgba(30,50,10,0.10)',
        glass: 'var(--zrk-shadow-glass)',
        goldGlow: 'var(--zrk-shadow-gold)',
      },
      fontFamily: {
        sans: ['var(--font-jakarta)', 'var(--font-naskh)', 'sans-serif'],
        display: ['var(--font-fraunces)', 'Georgia', 'serif'],
        urduHeading: ['var(--font-nastaliq)', 'var(--font-naskh)', 'serif'],
        urduBody: ['var(--font-naskh)', 'sans-serif'],
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
};

export default config;
