/**
 * Vite API Plugin for 1688 Lingo Bridge
 * Provides server-side API endpoints for scraping and validation
 */

import { generateSearchBundle } from '../core/queryProcessor.js';
import { smartScrape } from '../core/scraper.js';
import { validateResults } from '../core/validator.js';
import { validateWithVision } from '../core/visionValidator.js';
import { readFile, writeFile } from 'fs/promises';
import { existsSync } from 'fs';

const LATEST_FILE = './docs/artifacts/validated_results.json';

/**
 * Run the full Phase 4 pipeline with Vision
 */
async function runPipeline(query, options = {}) {
    const pipelineStart = Date.now();
    const enableVision = options.enableVision !== false; // Default true

    // Step 1: Generate search bundle from intent
    const intent = {
        query: query,
        context: query.includes("industrial")
            ? "heavy industry, manufacturing, power cables, electrical infrastructure"
            : query.includes("mill")
                ? "metalworking, CNC machining, industrial cutting tools, precision engineering"
                : "consumer electronics, camping gear, high-capacity batteries",
        market: "Export B2B"
    };

    const bundle = await generateSearchBundle(intent);

    // Step 2: Smart scrape with adaptive synonym expansion
    let scrapeResult = await smartScrape(bundle);

    // Step 3: Validate results with confidence scoring
    let validationResult = await validateResults(scrapeResult.results, {
        ...intent,
        chinese_query: bundle.primary,
        negative_keywords: bundle.negative_keywords,
        scoring_signals: bundle.scoring_signals
    });

    // Confidence-based pivot if needed
    const CONFIDENCE_THRESHOLD = 40;
    if (validationResult.metadata.averageConfidence < CONFIDENCE_THRESHOLD && bundle.synonyms.length > 0) {
        const forcedBundle = { ...bundle, primary: bundle.synonyms[0] };
        const forcedScrapeResult = await smartScrape(forcedBundle, { primaryLimit: 20 });
        const allResults = [...validationResult.results, ...forcedScrapeResult.results];
        const uniqueResults = dedupeByUrl(allResults);
        validationResult = await validateResults(uniqueResults, {
            ...intent,
            negative_keywords: bundle.negative_keywords,
            scoring_signals: bundle.scoring_signals
        });
    }

    // Step 4: Vision Validation (optional)
    let visionResult = validationResult;
    let visionMetadata = null;

    if (enableVision) {
        visionResult = await validateWithVision(validationResult.results, intent);
        visionMetadata = visionResult.metadata;
    }

    const pipelineLatency = Date.now() - pipelineStart;

    // Build output
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
            vision_checks: visionMetadata?.visionChecks || 0,
            vision_mismatches: visionMetadata?.mismatches || 0,
            total_latency_ms: pipelineLatency
        },
        search_bundle: bundle,
        results: visionResult.results,
        metadata: {
            generated_at: new Date().toISOString(),
            pipeline_version: "4.0.0"
        }
    };

    return outputData;
}

/**
 * Deduplicate results by URL
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
 * Save results to file
 */
async function saveResults(data) {
    await writeFile(LATEST_FILE, JSON.stringify(data, null, 2));
    return LATEST_FILE;
}

/**
 * Vite plugin factory
 */
export function apiPlugin() {
    return {
        name: 'vite-plugin-api',

        configureServer(server) {
            // API endpoint to run search pipeline
            server.middlewares.use('/api/search', async (req, res, next) => {
                if (req.method !== 'POST') {
                    res.statusCode = 405;
                    res.end(JSON.stringify({ error: 'Method not allowed' }));
                    return;
                }

                let body = '';
                req.on('data', chunk => { body += chunk; });
                req.on('end', async () => {
                    try {
                        const { query, enableVision = true } = JSON.parse(body);

                        if (!query) {
                            res.statusCode = 400;
                            res.setHeader('Content-Type', 'application/json');
                            res.end(JSON.stringify({ error: 'Query is required' }));
                            return;
                        }

                        console.log(`\n🔍 API Search Request: "${query}"`);

                        // Run the pipeline
                        const results = await runPipeline(query, { enableVision });

                        // Save results
                        await saveResults(results);

                        console.log(`✅ Pipeline complete: ${results.results.length} results in ${results.pipeline_summary.total_latency_ms}ms`);

                        res.setHeader('Content-Type', 'application/json');
                        res.end(JSON.stringify(results));
                    } catch (error) {
                        console.error('❌ Pipeline error:', error);
                        res.statusCode = 500;
                        res.setHeader('Content-Type', 'application/json');
                        res.end(JSON.stringify({ error: error.message }));
                    }
                });
            });

            // API endpoint to get current results
            server.middlewares.use('/api/results', async (req, res, next) => {
                if (req.method !== 'GET') {
                    res.statusCode = 405;
                    res.end(JSON.stringify({ error: 'Method not allowed' }));
                    return;
                }

                try {
                    if (!existsSync(LATEST_FILE)) {
                        res.statusCode = 404;
                        res.setHeader('Content-Type', 'application/json');
                        res.end(JSON.stringify({ error: 'No results found. Run a search first.' }));
                        return;
                    }

                    const data = await readFile(LATEST_FILE, 'utf-8');
                    res.setHeader('Content-Type', 'application/json');
                    res.end(data);
                } catch (error) {
                    res.statusCode = 500;
                    res.setHeader('Content-Type', 'application/json');
                    res.end(JSON.stringify({ error: error.message }));
                }
            });

            // API endpoint for health check
            server.middlewares.use('/api/health', (req, res) => {
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({
                    status: 'ok',
                    timestamp: new Date().toISOString()
                }));
            });
        }
    };
}
