/**
 * One-time script to add English translations to existing validated_results.json
 *
 * This script reads the existing results file, translates all product titles
 * using Lingo.dev SDK, and adds _en properties to each product.
 *
 * Usage: node scripts/translate-results.js
 */

import { LingoDotDevEngine } from "lingo.dev/sdk";
import { readFile, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const INPUT_FILE = './docs/artifacts/validated_results.json';
const OUTPUT_FILE = './docs/artifacts/validated_results.json';

// Load .env from project root
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = join(__dirname, '..');
const envPath = join(projectRoot, '.env');

/**
 * Load environment variables from .env file
 */
async function loadEnv() {
    try {
        const envContent = await readFile(envPath, 'utf-8');
        envContent.split('\n').forEach(line => {
            const trimmed = line.trim();
            if (trimmed && !trimmed.startsWith('#')) {
                const [key, ...valueParts] = trimmed.split('=');
                if (key && valueParts.length > 0) {
                    const value = valueParts.join('=').replace(/^["']|["']$/g, '');
                    process.env[key] = value;
                }
            }
        });
        console.log('✅ Loaded .env file from:', envPath);
    } catch (e) {
        console.warn('⚠️ Could not load .env file:', e.message);
    }
}

/**
 * Translate a single product's title from Chinese to English
 * @param {Object} lingo - Lingo.dev engine instance
 * @param {Object} product - Product object with offer_subject
 * @param {number} index - Product index for progress logging
 * @param {number} total - Total number of products
 * @returns {Object} Product with added _en property
 */
async function translateProduct(lingo, product, index, total) {
    const chineseTitle = product.offer_subject;

    if (!chineseTitle) {
        console.log(`  ⚠️ [${index + 1}/${total}] No title to translate`);
        return product;
    }

    try {
        // Use Lingo.dev to translate the title
        const translated = await lingo.localizeText(chineseTitle, {
            sourceLocale: "zh-CN",
            targetLocale: "en-GB",
        });

        console.log(`  ✓ [${index + 1}/${total}] "${chineseTitle.substring(0, 30)}..." → "${translated.substring(0, 30)}..."`);

        return {
            ...product,
            _en: {
                offer_subject: translated
            }
        };
    } catch (error) {
        console.error(`  ✗ [${index + 1}/${total}] Failed to translate: ${error.message}`);
        // Return product without translation on error
        return product;
    }
}

/**
 * Main function to process the results file
 */
async function main() {
    console.log('='.repeat(60));
    console.log('🔄 Translating validated_results.json');
    console.log('='.repeat(60));

    // Load environment variables FIRST
    await loadEnv();

    // Check for API key AFTER loading .env
    // Note: The .env file uses LINGODOTDEV_API_KEY (matching the npm package name)
    const apiKey = process.env.LINGODOTDEV_API_KEY || process.env.LINGO_API_KEY;

    if (!apiKey) {
        console.error('❌ LINGODOTDEV_API_KEY not found in environment variables');
        console.log('   Add it to your .env file');
        console.log('   Current env keys:', Object.keys(process.env).filter(k => k.includes('LINGO') || k.includes('API')).join(', ') || 'None found');
        process.exit(1);
    }

    // Initialize Lingo.dev engine
    const lingo = new LingoDotDevEngine({
        apiKey: apiKey,
    });

    // Check if input file exists
    if (!existsSync(INPUT_FILE)) {
        console.error(`❌ Input file not found: ${INPUT_FILE}`);
        console.log('   Run the pipeline first: node src/core/main.js phase4 "your query"');
        process.exit(1);
    }

    // Read the input file
    console.log(`\n📖 Reading: ${INPUT_FILE}`);
    const rawData = await readFile(INPUT_FILE, 'utf-8');
    const data = JSON.parse(rawData);

    // Handle both array and single object formats
    const pipelineArray = Array.isArray(data) ? data : [data];
    console.log(`   Found ${pipelineArray.length} pipeline(s)`);

    let totalProducts = 0;
    let translatedProducts = 0;

    // Process each pipeline
    for (const pipeline of pipelineArray) {
        if (!pipeline.results || pipeline.results.length === 0) {
            console.log('\n⚠️ No results to translate in this pipeline');
            continue;
        }

        console.log(`\n🔄 Translating ${pipeline.results.length} products...`);
        totalProducts += pipeline.results.length;

        // Translate each product with a small delay to avoid rate limiting
        const translatedResults = [];
        for (let i = 0; i < pipeline.results.length; i++) {
            const product = pipeline.results[i];
            const translated = await translateProduct(lingo, product, i, pipeline.results.length);
            translatedResults.push(translated);

            if (translated._en) {
                translatedProducts++;
            }

            // Small delay to avoid rate limiting (100ms)
            if (i < pipeline.results.length - 1) {
                await new Promise(resolve => setTimeout(resolve, 100));
            }
        }

        pipeline.results = translatedResults;
    }

    // Save the translated data
    console.log(`\n💾 Saving to: ${OUTPUT_FILE}`);
    await writeFile(OUTPUT_FILE, JSON.stringify(data, null, 2));

    // Summary
    console.log('\n' + '='.repeat(60));
    console.log('📊 TRANSLATION SUMMARY');
    console.log('='.repeat(60));
    console.log(`   Total products: ${totalProducts}`);
    console.log(`   Successfully translated: ${translatedProducts}`);
    console.log(`   Failed: ${totalProducts - translatedProducts}`);
    console.log('\n✅ Done! The English toggle should now work.');
}

main().catch(error => {
    console.error('❌ Script failed:', error);
    process.exit(1);
});
