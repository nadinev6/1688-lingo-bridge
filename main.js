/**
 * 1688 Lingo Bridge - Main Application
 *
 * Phase 1: Post-scraping translation (Chinese → English)
 * Phase 2: Pre-scraping intent transformation (English → Chinese search bundle)
 *
 * @see docs/Roadmap.md for full project roadmap
 */

import { LingoDotDevEngine } from "lingo.dev/sdk";
import { readFile, writeFile } from 'fs/promises';
import 'dotenv/config';

// Import Phase 2 Query Processor
import { generateSearchBundle, quickTranslate } from './lib/queryProcessor.js';

// Initialize Lingo.dev Client
const lingo = new LingoDotDevEngine({ apiKey: process.env.LINGODOTDEV_API_KEY });

/**
 * Phase 1: Translate 1688 product data from Chinese to English
 * Post-scraping translation pipeline
 */
async function translate1688Data() {
    try {
        console.log("🚀 Starting 1688 Global Bridge - Phase 1 (Post-Scraping Translation)...\n");

        // Read data from local sample_data.json
        const rawData = await readFile('./sample_data.json', 'utf-8');
        const rawChineseData = JSON.parse(rawData);

        if (rawChineseData.length === 0) {
            console.log("⚠️ No data found in sample_data.json. Please check the file.");
            return;
        }

        console.log(`📦 Fetched ${rawChineseData.length} products. Starting localisation...\n`);

        // Localise each product individually
        const translatedData = await Promise.all(
            rawChineseData.map(async (product, index) => {
                const translated = await lingo.localizeObject(product, {
                    sourceLocale: "zh-CN",
                    targetLocale: "en-GB",
                });
                console.log(`  ✓ Translated product ${index + 1}/${rawChineseData.length}: ${translated.offer_subject?.substring(0, 30) || 'Unknown'}...`);
                return translated;
            })
        );

        // Save the English data locally
        const outputPath = './localized_products.json';
        await writeFile(outputPath, JSON.stringify(translatedData, null, 2));

        console.log(`\n✅ Success! Localised data saved to: ${outputPath}`);

        // Translation diversity report
        const categories = translatedData.reduce((acc, item) => {
            const cat = item.categoryName || "Uncategorised";
            acc[cat] = (acc[cat] || 0) + 1;
            return acc;
        }, {});

        console.log("📊 Translation Diversity Report:", categories);

        return translatedData;
    } catch (error) {
        console.error("❌ An error occurred during Phase 1:", error.message);
        throw error;
    }
}

/**
 * Phase 2: Transform English intent into Chinese search bundle
 * Pre-scraping intent transformation
 */
async function demoPhase2() {
    console.log("\n" + "=".repeat(60));
    console.log("🔮 Phase 2: Intent-to-Native Query Transformation");
    console.log("=".repeat(60) + "\n");

    // Example 1: Outdoor Power Supply
    const intent1 = {
        query: "outdoor power supply energy storage",
        context: "consumer electronics, camping gear, high-capacity batteries",
        market: "UK B2B"
    };

    console.log("📝 Example 1: Outdoor Power Equipment\n");
    const bundle1 = await generateSearchBundle(intent1);
    console.log("\n📤 Result:");
    console.log(JSON.stringify(bundle1, null, 2));

    // Example 2: GaN Charger
    console.log("\n" + "-".repeat(40) + "\n");

    const intent2 = {
        query: "Gallium Nitride GaN charger fast charging",
        context: "consumer electronics, phone accessories",
        market: "UK B2B"
    };

    console.log("📝 Example 2: GaN Charger\n");
    const bundle2 = await generateSearchBundle(intent2);
    console.log("\n📤 Result:");
    console.log(JSON.stringify(bundle2, null, 2));

    // Example 3: Quick translate
    console.log("\n" + "-".repeat(40) + "\n");

    console.log("📝 Example 3: Quick Translate\n");
    const quickResult = await quickTranslate("Mulberry Silk pillowcase");
    console.log(`Quick translate "Mulberry Silk pillowcase" → "${quickResult}"`);

    return { bundle1, bundle2, quickResult };
}

/**
 * Main entry point - Run both phases
 */
async function main() {
    const args = process.argv.slice(2);
    const runPhase = args[0] || 'all';

    console.log("🌐 1688 Lingo Bridge");
    console.log("=".repeat(40));
    console.log(`Running: ${runPhase}\n`);

    try {
        switch (runPhase) {
            case 'phase1':
                await translate1688Data();
                break;
            case 'phase2':
                await demoPhase2();
                break;
            case 'all':
            default:
                // Run Phase 2 first (pre-processing), then Phase 1 (post-processing)
                await demoPhase2();
                console.log("\n");
                await translate1688Data();
                break;
        }
    } catch (error) {
        console.error("❌ Pipeline failed:", error.message);
        process.exit(1);
    }
}

// Run main function
main();
