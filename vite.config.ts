import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  plugins: [react()],
  server: { host: "0.0.0.0" },
  build: { rollupOptions: { output: { manualChunks(id) { if (id.includes('node_modules/planck/')) return 'rigid-body'; if (/node_modules\/(react|react-dom|scheduler)\//.test(id)) return 'react-vendor'; } } } },
});
