import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import { apiPlugin } from './src/server/api-plugin.js';
import { copyFileSync, mkdirSync, existsSync } from 'fs';
import { resolve } from 'path';

// Copies validated_results.json into the build output so the
// deployed frontend can fetch it at /docs/artifacts/validated_results.json
function copyArtifactsPlugin() {
    return {
        name: 'copy-artifacts',
        closeBundle() {
            const src = resolve(__dirname, 'docs/artifacts/validated_results.json');
            const destDir = resolve(__dirname, 'dist/docs/artifacts');
            if (existsSync(src)) {
                mkdirSync(destDir, { recursive: true });
                copyFileSync(src, resolve(destDir, 'validated_results.json'));
                console.log('✅ Copied validated_results.json into dist/docs/artifacts/');
            } else {
                console.warn('⚠️  validated_results.json not found — deploy will have no data');
            }
        },
    };
}

export default defineConfig({
    plugins: [
        tailwindcss(),
        apiPlugin(),
        copyArtifactsPlugin(),
    ],
    root: '.',
    build: {
        outDir: 'dist',
    },
});
