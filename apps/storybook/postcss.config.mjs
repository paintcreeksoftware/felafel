// PostCSS pipeline for the renderer's CSS. Tailwind v4 ships its plugin
// inside `@tailwindcss/postcss`, so this is the only plugin we need — no
// separate `tailwindcss.config.js` (v4 reads its config from CSS via
// `@theme`). Vite picks this up automatically when bundling the renderer.
const config = {
  plugins: {
    "@tailwindcss/postcss": {},
  },
};

export default config;
