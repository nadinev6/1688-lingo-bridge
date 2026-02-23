import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import { apiPlugin } from './src/server/api-plugin.js';

export default defineConfig({
    plugins: [
        tailwindcss(),
        apiPlugin(),
    ],
    root: '.',
    // Vite automatically copies files from public/ to dist/
    // public/validated_results.json will be available at /validated_results.json
    build: {
        outDir: 'dist',
    },
});
