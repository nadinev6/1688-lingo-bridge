import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import { apiPlugin } from './src/server/api-plugin.js';

export default defineConfig({
    plugins: [
        tailwindcss(),
        apiPlugin()
    ],
    root: '.',
    build: {
        outDir: 'dist',
    },
});
