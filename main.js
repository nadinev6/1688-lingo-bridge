/**
 * 1688 Lingo Bridge - Main Application
 *
 * Phase 1: Post-scraping translation (Chinese → English)
 * Phase 2: Pre-scraping intent transformation (English → Chinese search bundle)
 * Phase 3: Validated pipeline with confidence scoring
 * Phase 4: Image-to-image validation with GPT-4V
 *
 * @see docs/Roadmap.md for full project roadmap
 */

import { LingoDotDevEngine } from "lingo.dev/sdk";
import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import 'dotenv/config';

// Import Phase 2 Query Processor
import { generateSearchBundle, quickTranslate } from './lib/queryProcessor.js';

// Import Phase 3 modules
import { smartScrape } from './lib/scraper.js';
import { validateResults } from './lib/validator.js';

// Import Phase 4 Vision Validator
import { validateWithVision } from './lib/visionValidator.js';

/**
 * Deduplicate results by product URL
 * @param {Object[]} results - Results to dedupe
 * @returns {Object[]} Deduplicated results
 */
function dedupeByUrl(results) {
    const seen = new Set();
    return results.filter(product => {
        const url = product.offer_detail_url || product.url;
        if (seen.has(url)) return false;
        seen.add(url);
        return true;
    });
}

/**
 * Generate ISO timestamp for file naming
 * @returns {string} Timestamp in format YYYY-MM-DD_HH-MM-SS
 */
function getTimestamp() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');
    return `${year}-${month}-${day}_${hours}-${minutes}-${seconds}`;
}

/**
 * Save pipeline results with timestamped archiving
 * Always preserves old results, updates latest copy
 * @param {Object} outputData - Complete pipeline output
 * @param {string} query - Original search query
 */
async function saveResultsWithArchive(outputData, query) {
    const archiveDir = './docs/artifacts/results-archive';
    const timestamp = getTimestamp();
    const timestampedFile = `${archiveDir}/run_${timestamp}.json`;
    const latestFile = './docs/artifacts/validated_results.json';
    const indexFile = './docs/artifacts/results-archive-index.json';

    // Ensure archive directory exists
    if (!existsSync(archiveDir)) {
        await mkdir(archiveDir, { recursive: true });
    }

    // Save timestamped archive
    await writeFile(timestampedFile, JSON.stringify(outputData, null, 2));
    console.log(`✅ Archived: ${timestampedFile}`);

    // Save as latest (for backward compatibility with frontend)
    await writeFile(latestFile, JSON.stringify(outputData, null, 2));
    console.log(`✅ Updated latest: ${latestFile}`);

    // Update index
    let index = { total_runs: 0, runs: [] };
    if (existsSync(indexFile)) {
        try {
            const existingIndex = JSON.parse(await readFile(indexFile, 'utf-8'));
            index = existingIndex;
        } catch (e) {
            console.warn('⚠️ Could not read existing index, creating new one');
        }
    }

    const runEntry = {
        run_id: `run_${timestamp}`,
        timestamp: new Date().toISOString(),
        query: query,
        total_results: outputData.results.length,
        high_confidence: outputData.pipeline_summary.high_confidence_count,
        low_confidence: outputData.pipeline_summary.low_confidence_count,
        file: `results-archive/run_${timestamp}.json`
    };

    index.runs.unshift(runEntry); // Add to beginning (most recent first)
    index.total_runs = index.runs.length;

    await writeFile(indexFile, JSON.stringify(index, null, 2));
    console.log(`✅ Updated index: ${indexFile}`);

    return { timestampedFile, latestFile, indexFile };
}

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
 * Phase 3: Full validated pipeline
 * Intent → Search Bundle → Scrape → Validate → Results
 */
async function demoPhase3() {
    console.log("\n" + "=".repeat(60));
    console.log("🎯 Phase 3: Validated Pipeline");
    console.log("=".repeat(60));

    const pipelineStart = Date.now();

    // Step 1: Generate search bundle from intent
    console.log("\n📍 Step 1: Intent-to-Native Transformation");
    const intent = {
        query: "outdoor power supply energy storage",
        context: "consumer electronics, camping gear, high-capacity batteries",
        market: "UK B2B"
    };

    const bundle = await generateSearchBundle(intent);
    console.log(`   Primary: ${bundle.primary}`);
    console.log(`   Synonyms: [${bundle.synonyms.join(', ')}]`);

    // Step 2: Smart scrape with adaptive synonym expansion
    console.log("\n📍 Step 2: Smart Scrape");
    let scrapeResult = await smartScrape(bundle);

    // Step 3: Validate results with confidence scoring
    console.log("\n📍 Step 3: Validation & Confidence Scoring");
    let validationResult = await validateResults(scrapeResult.results, {
        ...intent,
        chinese_query: bundle.primary,
        negative_keywords: bundle.negative_keywords
    });

    // CONFIDENCE-BASED PIVOT: If avg confidence < 40%, force synonym expansion
    // This catches cases where we got results but they're poor quality
    const CONFIDENCE_THRESHOLD = 40;
    if (validationResult.metadata.averageConfidence < CONFIDENCE_THRESHOLD && bundle.synonyms.length > 0) {
        console.log(`\n   ⚠️ Low confidence (${validationResult.metadata.averageConfidence}% < ${CONFIDENCE_THRESHOLD}%), forcing synonym expansion...`);

        // Force scrape all synonyms
        const { smartScrape: forceScrape } = await import('./lib/scraper.js');
        const forcedBundle = {
            ...bundle,
            primary: bundle.synonyms[0] // Use first synonym as primary
        };

        // Temporarily override threshold to force expansion
        const forcedScrapeResult = await forceScrape(forcedBundle, { primaryLimit: 20 });

        // Merge with original results
        const allResults = [...validationResult.results, ...forcedScrapeResult.results];
        const uniqueResults = dedupeByUrl(allResults);

        // Re-validate
        validationResult = await validateResults(uniqueResults, {
            ...intent,
            negative_keywords: bundle.negative_keywords
        });

        console.log(`   ✅ Pivot complete: ${validationResult.results.length} results, ${validationResult.metadata.averageConfidence}% confidence`);
    }

    // Step 4: Summary
    const pipelineLatency = Date.now() - pipelineStart;

    console.log("\n" + "=".repeat(60));
    console.log("📊 PIPELINE SUMMARY");
    console.log("=".repeat(60));
    console.log(`   Original Query: "${intent.query}"`);
    console.log(`   Chinese Query: "${bundle.primary}"`);
    console.log(`   Total Results: ${validationResult.results.length}`);
    console.log(`   Average Confidence: ${validationResult.metadata.averageConfidence}%`);
    console.log(`   High Confidence: ${validationResult.metadata.highConfidenceCount}`);
    console.log(`   Low Confidence: ${validationResult.metadata.lowConfidenceCount}`);
    console.log(`   Suspicious: ${validationResult.metadata.suspiciousCount}`);
    console.log(`   Filtered by Blacklist: ${scrapeResult.metadata.filteredByBlacklist}`);
    console.log(`\n   ⏱️ Total Pipeline Latency: ${pipelineLatency}ms`);
    console.log(`      - Query Processing: ~50ms`);
    console.log(`      - Scraping: ${scrapeResult.metadata.totalLatency}ms`);
    console.log(`      - Validation: ${validationResult.metadata.validationLatency}ms`);

    // Show top 3 results
    console.log("\n📦 Top 3 Results (by confidence):");
    validationResult.results.slice(0, 3).forEach((product, i) => {
        console.log(`   ${i + 1}. [${product._confidence}%] ${product.offer_subject?.substring(0, 40) || 'Unknown'}...`);
    });

    // Step 5: Save results to file (with timestamped archiving)
    const outputData = {
        pipeline_summary: {
            original_query: intent.query,
            chinese_query: bundle.primary,
            total_results: validationResult.results.length,
            average_confidence: validationResult.metadata.averageConfidence,
            high_confidence_count: validationResult.metadata.highConfidenceCount,
            low_confidence_count: validationResult.metadata.lowConfidenceCount,
            suspicious_count: validationResult.metadata.suspiciousCount,
            filtered_by_blacklist: scrapeResult.metadata.filteredByBlacklist,
            total_latency_ms: pipelineLatency
        },
        search_bundle: bundle,
        results: validationResult.results,
        metadata: {
            generated_at: new Date().toISOString(),
            pipeline_version: "3.0.0"
        }
    };

    const savedPaths = await saveResultsWithArchive(outputData, intent.query);
    console.log(`\n💾 Results saved (old results preserved in archive)`);

    return {
        bundle,
        scrapeResult,
        validationResult,
        pipelineLatency
    };
}

/**
 * Phase 4: Full validated pipeline with Vision
 * Intent → Search Bundle → Scrape → Validate → Vision Validate → Results
 */
async function demoPhase4(customQuery = null) {
    console.log("\n" + "=".repeat(60));
    console.log("🎯 Phase 4: Validated Pipeline with Vision");
    console.log("=".repeat(60));

    const pipelineStart = Date.now();

    // Step 1: Generate search bundle from intent
    console.log("\n📍 Step 1: Intent-to-Native Transformation");

    // Default intent or specialized for industrial leads
    const intent = {
        query: customQuery || "outdoor power supply energy storage",
        context: customQuery?.includes("industrial")
            ? "heavy industry, manufacturing, power cables, electrical infrastructure"
            : customQuery?.includes("mill")
            ? "metalworking, CNC machining, industrial cutting tools, precision engineering"
            : "consumer electronics, camping gear, high-capacity batteries",
        market: "UK B2B"
    };

    const bundle = await generateSearchBundle(intent);
    console.log(`   Primary: ${bundle.primary}`);
    console.log(`   Synonyms: [${bundle.synonyms.join(', ')}]`);

    // Step 2: Smart scrape with adaptive synonym expansion
    console.log("\n📍 Step 2: Smart Scrape");
    let scrapeResult = await smartScrape(bundle);

    // Step 3: Validate results with confidence scoring
    console.log("\n📍 Step 3: Text Validation & Confidence Scoring");
    let validationResult = await validateResults(scrapeResult.results, {
        ...intent,
        chinese_query: bundle.primary,
        negative_keywords: bundle.negative_keywords
    });

    // CONFIDENCE-BASED PIVOT: If avg confidence < 40%, force synonym expansion
    // This catches cases where we got results but they're poor quality
    const CONFIDENCE_THRESHOLD = 40;
    if (validationResult.metadata.averageConfidence < CONFIDENCE_THRESHOLD && bundle.synonyms.length > 0) {
        console.log(`\n   ⚠️ Low confidence (${validationResult.metadata.averageConfidence}% < ${CONFIDENCE_THRESHOLD}%), forcing synonym expansion...`);

        // Force scrape all synonyms
        const forcedBundle = {
            ...bundle,
            primary: bundle.synonyms[0] // Use first synonym as primary
        };

        // Temporarily override threshold to force expansion
        const forcedScrapeResult = await smartScrape(forcedBundle, { primaryLimit: 20 });

        // Merge with original results
        const allResults = [...validationResult.results, ...forcedScrapeResult.results];
        const uniqueResults = dedupeByUrl(allResults);

        // Re-validate
        validationResult = await validateResults(uniqueResults, {
            ...intent,
            negative_keywords: bundle.negative_keywords
        });

        console.log(`   ✅ Pivot complete: ${validationResult.results.length} results, ${validationResult.metadata.averageConfidence}% confidence`);
    }

    // Step 4: Vision Validation (Phase 4)
    console.log("\n📍 Step 4: Vision Validation (GPT-4V)");
    const visionResult = await validateWithVision(validationResult.results, intent);

    // Step 5: Summary
    const pipelineLatency = Date.now() - pipelineStart;

    console.log("\n" + "=".repeat(60));
    console.log("📊 PIPELINE SUMMARY (Phase 4 with Vision)");
    console.log("=".repeat(60));
    console.log(`   Original Query: "${intent.query}"`);
    console.log(`   Chinese Query: "${bundle.primary}"`);
    console.log(`   Total Results: ${validationResult.results.length}`);
    console.log(`   Average Confidence: ${validationResult.metadata.averageConfidence}%`);
    console.log(`   High Confidence: ${validationResult.metadata.highConfidenceCount}`);
    console.log(`   Low Confidence: ${validationResult.metadata.lowConfidenceCount}`);
    console.log(`   Suspicious: ${validationResult.metadata.suspiciousCount}`);
    console.log(`   Filtered by Blacklist: ${scrapeResult.metadata.filteredByBlacklist}`);

    // Vision-specific stats
    if (visionResult.metadata) {
        console.log(`\n👁️ Vision Validation:`);
        console.log(`   Checked: ${visionResult.metadata.visionChecks} products`);
        console.log(`   Mismatches Detected: ${visionResult.metadata.mismatches}`);
        console.log(`   Vision Latency: ${visionResult.metadata.visionLatency}ms`);
    }

    console.log(`\n   ⏱️ Total Pipeline Latency: ${pipelineLatency}ms`);
    console.log(`      - Query Processing: ~50ms`);
    console.log(`      - Scraping: ${scrapeResult.metadata.totalLatency}ms`);
    console.log(`      - Text Validation: ${validationResult.metadata.validationLatency}ms`);
    if (visionResult.metadata?.visionLatency) {
        console.log(`      - Vision Validation: ${visionResult.metadata.visionLatency}ms`);
    }

    // Show top 3 results with visual confidence
    console.log("\n📦 Top 3 Results (by confidence):");
    visionResult.results.slice(0, 3).forEach((product, i) => {
        const visualTag = product._visualConfidence !== undefined
            ? ` | 👁️ ${product._visualConfidence}%`
            : '';
        const mismatchTag = product._visualConfidence !== null &&
            product._visualConfidence < 50 &&
            product._confidence >= 70
            ? ' ⚠️ MISMATCH'
            : '';
        console.log(`   ${i + 1}. [${product._confidence}%${visualTag}] ${product.offer_subject?.substring(0, 40) || 'Unknown'}...${mismatchTag}`);
    });

    // Show mismatches if any
    const mismatches = visionResult.results.filter(p =>
        p._visualConfidence !== null &&
        p._visualConfidence < 50 &&
        p._confidence >= 70
    );

    if (mismatches.length > 0) {
        console.log("\n🚨 Vision Mismatches (potential 'bait and switch'):");
        mismatches.forEach((product, i) => {
            console.log(`   ${i + 1}. "${product.offer_subject?.substring(0, 40)}..."`);
            console.log(`      Text: ${product._confidence}% | Visual: ${product._visualConfidence}%`);
            console.log(`      Reason: ${product._visionReason || 'N/A'}`);
        });
    }

    // Step 6: Save results to file (with timestamped archiving)
    const outputData = {
        pipeline_summary: {
            original_query: intent.query,
            chinese_query: bundle.primary,
            total_results: visionResult.results.length,
            average_confidence: validationResult.metadata.averageConfidence,
            high_confidence_count: validationResult.metadata.highConfidenceCount,
            low_confidence_count: validationResult.metadata.lowConfidenceCount,
            suspicious_count: validationResult.metadata.suspiciousCount,
            filtered_by_blacklist: scrapeResult.metadata.filteredByBlacklist,
            vision_checks: visionResult.metadata?.visionChecks || 0,
            vision_mismatches: visionResult.metadata?.mismatches || 0,
            total_latency_ms: pipelineLatency
        },
        search_bundle: bundle,
        results: visionResult.results,
        metadata: {
            generated_at: new Date().toISOString(),
            pipeline_version: "4.0.0"
        }
    };

    const savedPaths = await saveResultsWithArchive(outputData, intent.query);
    console.log(`\n💾 Results saved (old results preserved in archive)`);

    return {
        bundle,
        scrapeResult,
        validationResult,
        visionResult,
        pipelineLatency
    };
}

/**
 * Main entry point - Run phases
 */
async function main() {
    const args = process.argv.slice(2);
    const runPhase = args[0] || 'all';
    const customQuery = args[1] || null;

    console.log("🌐 1688 Lingo Bridge");
    console.log("=".repeat(40));
    console.log(`Running: ${runPhase}`);
    if (customQuery) console.log(`Query: "${customQuery}"`);
    console.log("");

    try {
        switch (runPhase) {
            case 'phase1':
                await translate1688Data();
                break;
            case 'phase2':
                await demoPhase2();
                break;
            case 'phase3':
                await demoPhase3();
                break;
            case 'phase4':
            case 'full':
                // Run complete pipeline with vision: Phase 4
                await demoPhase4(customQuery);
                break;
            case 'all':
            default:
                // Run all demos
                await demoPhase2();
                await demoPhase3();
                await demoPhase4(customQuery);
                break;
        }
    } catch (error) {
        console.error("❌ Pipeline failed:", error.message);
        process.exit(1);
    }
}

// Run main function
main();
