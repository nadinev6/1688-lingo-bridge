/**
 * Vision Validator - AI-powered image validation
 * Phase 4 of 1688 Lingo Bridge
 *
 * Uses GPT-4V sparingly to validate product images match search intent.
 * Designed for latency-conscious operation with caching and batch processing.
 *
 * @module lib/visionValidator
 * @see docs/Roadmap.md Phase 4
 */

import { createHash } from 'crypto';

// ============================================================================
// PRE-FLIGHT CHECK: Zero-latency early returns
// These checks happen BEFORE any async operations to minimize latency
// ============================================================================

// Check API key once at module load time (not per-call)
const HAS_OPENAI_KEY = !!process.env.OPENAI_API_KEY;

// Configuration for latency control
const VISION_CONFIG = {
    maxProducts: parseInt(process.env.VISION_MAX_PRODUCTS) || 10,  // Max products to check per run
    minConfidence: 70,                                              // Only check high-confidence products
    model: process.env.VISION_MODEL || "gpt-4o-mini",              // Use gpt-4o-mini for cost savings
    timeoutMs: parseInt(process.env.VISION_TIMEOUT_MS) || 3000,    // Per-batch timeout
    cacheEnabled: process.env.VISION_CACHE_ENABLED !== 'false',    // Enable result caching
    enabled: process.env.VISION_ENABLED !== 'false'                // Enable vision validation
};

// Simple in-memory cache (could be Redis in production)
// Key: MD5 hash of image URL, Value: vision result
const visionCache = new Map();

/**
 * SYNCHRONOUS Pre-Flight Check
 * Returns immediately (<1ms) if vision validation cannot proceed
 * Use this to avoid any async overhead when vision is unavailable
 *
 * @returns {Object|null} Null if vision can proceed, otherwise an early-return object
 */
function preFlightCheck() {
    // Check1: Vision disabled via config
    if (!VISION_CONFIG.enabled) {
        return {
            skipReason: 'disabled',
            logMessage: '\n👁️ Vision validation disabled, skipping...'
        };
    }

    // Check2: No API key (most common case in development)
    if (!HAS_OPENAI_KEY) {
        return {
            skipReason: 'noApiKey',
            logMessage: '\n👁️ Vision validation skipped (no OPENAI_API_KEY)'
        };
    }

    // All checks passed - vision validation can proceed
    return null;
}

/**
 * Validate product images against search intent
 * Uses GPT-4V sparingly - only for high-confidence products to minimize latency
 *
 * @param {Object[]} products - Products to validate (with _confidence scores)
 * @param {Object} intent - Original search intent
 * @param {string} intent.query - Original English query
 * @param {string} intent.context - Context hints
 * @returns {Promise<Object>} Products with visual confidence scores
 */
export async function validateWithVision(products, intent) {
    // PRE-FLIGHT CHECK: Zero-latency early return (<1ms)
    const preFlight = preFlightCheck();
    if (preFlight) {
        console.log(preFlight.logMessage);
        return {
            results: products,
            metadata: {
                visionChecks: 0,
                visionLatency: 0,
                mismatches: 0,
                skipReason: preFlight.skipReason
            }
        };
    }

    const startTime = Date.now();

    console.log(`\n👁️ Starting vision validation...`);

    // 1. Filter candidates (latency control - only high confidence products)
    const highConfidenceProducts = products.filter(p => (p._confidence || 0) >= VISION_CONFIG.minConfidence);

    console.log(`   📊 High-confidence products: ${highConfidenceProducts.length} of ${products.length} total`);

    if (highConfidenceProducts.length === 0) {
        console.log(`   ℹ️ No high-confidence products (≥${VISION_CONFIG.minConfidence}%) to validate`);
        return {
            results: products,
            metadata: {
                visionChecks: 0,
                visionLatency: Date.now() - startTime,
                mismatches: 0,
                noCandidates: true
            }
        };
    }

    // COST PROTECTION: Hard-code Top-N Gatekeeper
    // ONLY the top N candidates (sorted by text confidence) reach the Vision API
    // This prevents rate limits and controls spending
    const TOP_N_GATEKEEPER = VISION_CONFIG.maxProducts; // Max10 by default
    const gatedCandidates = highConfidenceProducts
        .sort((a, b) => (b._confidence || 0) - (a._confidence || 0))
        .slice(0, TOP_N_GATEKEEPER);

    console.log(`   📸 Validating top ${gatedCandidates.length} products (gatekeeper: ${TOP_N_GATEKEEPER} max)`);
    console.log(`   💰 Cost protection: ${highConfidenceProducts.length - gatedCandidates.length} high-confidence products blocked from API`);
    console.log(`   💰 Total blocked: ${products.length - gatedCandidates.length} of ${products.length} products`);

    // 2. Batch vision check (only for gated candidates)
    const visionResults = await batchVisionCheck(gatedCandidates, intent.query);

    // 3. Merge visual scores with products
    const enrichedProducts = products.map(product => {
        const url = product.offer_detail_url || product.url;
        const visionResult = visionResults.get(url);

        if (visionResult) {
            return {
                ...product,
                _visualConfidence: visionResult.confidence,
                _visionMatch: visionResult.matches,
                _visionReason: visionResult.reason,
                _visionError: visionResult.error,
                // Enhanced fields from cynical sourcing agent
                _isAccessoryOnly: visionResult.isAccessoryOnly,
                _scaleVerified: visionResult.scaleVerified,
                _mismatchReason: visionResult.mismatchReason
            };
        }
        return product;
    });

    // 4. Detect mismatches (text says X, image shows Y)
    const mismatches = detectMismatches(enrichedProducts);

    const latency = Date.now() - startTime;
    console.log(`   ⏱️ Vision validation: ${latency}ms (${gatedCandidates.length} products)`);
    const successfulMatches = gatedCandidates.filter(p => p._visionMatch).length;
    console.log(`   🎯 Visual matches: ${successfulMatches}`);

    if (mismatches.length > 0) {
        console.log(`   ⚠️ Visual mismatches detected: ${mismatches.length}`);
        mismatches.forEach(m => {
            console.log(`      - "${m.offer_subject?.substring(0, 30)}..." (text: ${m._confidence}%, visual: ${m._visualConfidence}%)`);
        });
    }

    return {
        results: enrichedProducts,
        metadata: {
            visionChecks: gatedCandidates.length,
            visionLatency: latency,
            mismatches: mismatches.length,
            cacheHits: gatedCandidates.length - visionResults.size
        }
    };
}

/**
 * Batch vision check - processes multiple images efficiently
 * Uses caching to avoid re-processing identical images
 *
 * @param {Object[]} products - Products to check
 * @param {string} originalQuery - Original English search query
 * @returns {Promise<Map>} Map of URL -> vision result
 */
async function batchVisionCheck(products, originalQuery) {
    const results = new Map();
    const uncached = [];

    // Check cache first
    for (const product of products) {
        const imageUrl = product.offer_pic_url || product.image_url;
        if (!imageUrl) continue;

        const imageHash = createHash('md5')
            .update(imageUrl)
            .digest('hex');

        if (VISION_CONFIG.cacheEnabled && visionCache.has(imageHash)) {
            const cached = visionCache.get(imageHash);
            results.set(product.offer_detail_url || product.url, cached);
            console.log(`   💾 Cache hit for: ${imageUrl.substring(0, 50)}...`);
        } else {
            uncached.push({ product, imageHash, imageUrl });
        }
    }

    if (uncached.length === 0) {
        console.log(`   💾 All ${products.length} results from cache`);
        return results;
    }

    console.log(`   🌐 Processing ${uncached.length} images via GPT-4V...`);

    // Process images - use batched approach for efficiency
    try {
        // Dynamic import for OpenAI (ESM)
        const { default: OpenAI } = await import('openai');
        const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

        // Process in small batches to avoid token limits
        const BATCH_SIZE = 5;

        for (let i = 0; i < uncached.length; i += BATCH_SIZE) {
            const batch = uncached.slice(i, i + BATCH_SIZE);

            try {
                const batchResults = await processVisionBatch(openai, batch, originalQuery);

                // Cache and store results
                for (const { product, imageHash } of batch) {
                    const url = product.offer_detail_url || product.url;
                    const result = batchResults.get(url);

                    if (result) {
                        if (VISION_CONFIG.cacheEnabled) {
                            visionCache.set(imageHash, result);
                        }
                        results.set(url, result);
                    }
                }
            } catch (batchError) {
                console.log(`   ⚠️ Batch ${Math.floor(i / BATCH_SIZE) + 1} error: ${batchError.message}`);

                // Mark as error for these products
                for (const { product } of batch) {
                    const url = product.offer_detail_url || product.url;
                    results.set(url, {
                        confidence: null,
                        matches: null,
                        error: batchError.message
                    });
                }
            }
        }

    } catch (importError) {
        console.log(`   ⚠️ OpenAI import error: ${importError.message}`);
        console.log(`   📦 Install with: npm install openai`);

        // Mark all as error
        for (const { product } of uncached) {
            const url = product.offer_detail_url || product.url;
            results.set(url, {
                confidence: null,
                matches: null,
                error: 'OpenAI not installed'
            });
        }
    }

    return results;
}

/**
 * Process a batch of images with GPT-4V
 *
 * @param {Object} openai - OpenAI client
 * @param {Object[]} batch - Products to process
 * @param {string} originalQuery - Original search query
 * @returns {Promise<Map>} Map of URL -> vision result
 */
async function processVisionBatch(openai, batch, originalQuery) {
    const results = new Map();

    // Build the vision prompt with cynical sourcing agent persona
    const prompt = buildVisionPrompt(originalQuery, batch);

    // Race against timeout
    const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Vision timeout')), VISION_CONFIG.timeoutMs);
    });

    console.log(`   🤖 Using model: ${VISION_CONFIG.model}`);

    try {
        const response = await Promise.race([
            openai.chat.completions.create({
                model: VISION_CONFIG.model, // gpt-4o-mini for cost savings
                messages: [
                    {
                        role: "system",
                        content: `You are a CYNICAL SOURCING AGENT with 15 years of experience exposing fake listings on Chinese B2B marketplaces.

Your job is to PROTECT the buyer from:
- "Bait and switch" listings (title says "Power Station", image shows "Cake Mould")
- Accessory-only listings (selling just the cable, not the device)
- Scale deception (tiny item photographed to look large)
- Keyword stuffing (irrelevant products with popular keywords in title)

You must respond ONLY with valid JSON. No explanations outside the JSON structure.`
                    },
                    {
                        role: "user",
                        content: prompt
                    }
                ],
                max_tokens: 1000,
                temperature: 0.1 // Low temperature for consistent results
            }),
            timeoutPromise
        ]);

        // Parse the response
        const content = response.choices[0]?.message?.content;

        if (content) {
            const parsed = parseVisionResponse(content, batch);

            for (const [url, result] of parsed) {
                results.set(url, result);
            }
        }

    } catch (error) {
        throw error;
    }

    return results;
}

/**
 * Build the vision prompt for GPT-4V
 * Uses "Cynical Sourcing Agent" persona for rigorous validation
 *
 * @param {string} query - Original search query
 * @param {Object[]} batch - Products to validate
 * @returns {Array} OpenAI message content array
 */
function buildVisionPrompt(query, batch) {
    const productDescriptions = batch.map((item, index) =>
        `[${index}] Title: "${item.product.offer_subject}"`
    ).join('\n');

    const content = [
        {
            type: "text",
            text: `BUYER INTENT: "${query}"

You are validating product images from 1688.com. The buyer is an International B2B wholesaler who cannot afford to receive wrong items.

PRODUCTS TO VALIDATE:
${productDescriptions}

FOR EACH IMAGE, YOU MUST CHECK:

1. **PRIMARY PRODUCT MATCH**: Does the image show the MAIN product the buyer searched for?
   - NOT just a related accessory (cable ≠ power station)
   - NOT just packaging or a logo
   - NOT a different product category entirely

2. **SCALE & UNIT COMPLETENESS**: Can you verify the product is the actual item?
   - Look for size indicators, hands, reference objects
   - Is this the COMPLETE unit or just a part/accessory?

3. **BAIT-AND-SWITCH DETECTION**: Does the image match the title?
   - Title says "Power Station" but image shows silicone placemats? → REJECT
   - Title says "GaN Charger" but image shows only a USB cable? → REJECT

RESPOND IN JSON FORMAT ONLY:
{
  "results": [
    {
      "index": 0,
      "matches": true/false,
      "confidence": 0-100,
      "primary_product_seen": "description of what you actually see",
      "is_accessory_only": true/false,
      "scale_verified": true/false,
      "mismatch_reason": "if matches=false, explain why"
    }
  ]
}

CRITICAL SCORING RULES:
- confidence < 30%: Image shows completely different product category
- confidence30-60%: Related accessory or partial match
- confidence > 70%: Actual primary product visible with clear match
- If is_accessory_only=true, max confidence should be 40%

Be HARSH. A buyer would rather miss a product than receive the wrong one.`
        }
    ];

    // Add images to the prompt with URL resolution
    for (const item of batch) {
        if (item.imageUrl) {
            // Fix protocol-relative URLs (//cbu01.alicdn.com/... → https://cbu01.alicdn.com/...)
            const resolvedUrl = resolveImageUrl(item.imageUrl);
            content.push({
                type: "image_url",
                image_url: {
                    url: resolvedUrl,
                    detail: "low" // Use low detail for faster processing
                }
            });
        }
    }

    return content;
}

/**
 * Resolve image URL to absolute HTTPS URL
 * Handles protocol-relative URLs from 1688 (//cbu01.alicdn.com/...)
 *
 * @param {string} url - Original URL (may be protocol-relative)
 * @returns {string} Absolute HTTPS URL
 */
function resolveImageUrl(url) {
    if (!url) return '';

    // Handle protocol-relative URLs (//cbu01.alicdn.com/...)
    if (url.startsWith('//')) {
        return 'https:' + url;
    }

    // Handle relative URLs (shouldn't happen but be safe)
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
        return 'https://' + url;
    }

    // Upgrade HTTP to HTTPS for security
    if (url.startsWith('http://')) {
        return url.replace('http://', 'https://');
    }

    return url;
}

/**
 * Parse GPT-4V response into structured results
 * Enhanced to handle cynical sourcing agent response format
 *
 * @param {string} content - Raw API response
 * @param {Object[]} batch - Original batch for URL mapping
 * @returns {Map} Map of URL -> vision result
 */
function parseVisionResponse(content, batch) {
    const results = new Map();

    try {
        // Extract JSON from response (handle markdown code blocks)
        let jsonStr = content;
        const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
        if (jsonMatch) {
            jsonStr = jsonMatch[1];
        }

        const parsed = JSON.parse(jsonStr);

        if (parsed.results && Array.isArray(parsed.results)) {
            for (const result of parsed.results) {
                const index = result.index;
                if (index >= 0 && index < batch.length) {
                    const url = batch[index].product.offer_detail_url || batch[index].product.url;

                    // Build comprehensive reason from new fields
                    let reason = result.primary_product_seen || result.reason || 'No analysis provided';
                    if (result.is_accessory_only) {
                        reason += ' [ACCESSORY ONLY]';
                    }
                    if (!result.scale_verified && result.matches) {
                        reason += ' [SCALE UNCERTAIN]';
                    }
                    if (result.mismatch_reason) {
                        reason = `MISMATCH: ${result.mismatch_reason}`;
                    }

                    results.set(url, {
                        matches: result.matches === true,
                        confidence: typeof result.confidence === 'number' ? result.confidence : null,
                        reason: reason,
                        // New fields for detailed analysis
                        primaryProductSeen: result.primary_product_seen,
                        isAccessoryOnly: result.is_accessory_only || false,
                        scaleVerified: result.scale_verified || false,
                        mismatchReason: result.mismatch_reason
                    });
                }
            }
        }
    } catch (parseError) {
        console.log(`   ⚠️ Failed to parse vision response: ${parseError.message}`);

        // Mark all as parse error
        for (const { product } of batch) {
            const url = product.offer_detail_url || product.url;
            results.set(url, {
                matches: null,
                confidence: null,
                reason: 'Failed to parse vision response',
                error: parseError.message
            });
        }
    }

    return results;
}

/**
 * Detect products where text confidence ≠ visual confidence
 * This catches "bait and switch" listings
 *
 * @param {Object[]} products - Products with both text and visual scores
 * @returns {Object[]} Products that have mismatches
 */
function detectMismatches(products) {
    return products.filter(p => {
        // Skip if no visual check was performed
        if (p._visualConfidence === null || p._visualConfidence === undefined) {
            return false;
        }

        // "Bait and switch" pattern:
        // - High text confidence (title says it's what we want)
        // - Low visual confidence (image shows something else)
        const textHigh = (p._confidence || 0) >= 70;
        const visualLow = (p._visualConfidence || 0) < 50;

        return textHigh && visualLow;
    });
}

/**
 * Clear the vision cache
 * Useful for testing or memory management
 */
export function clearVisionCache() {
    visionCache.clear();
    console.log('🗑️ Vision cache cleared');
}

/**
 * Get cache statistics
 *
 * @returns {Object} Cache stats
 */
export function getCacheStats() {
    return {
        size: visionCache.size,
        enabled: VISION_CONFIG.cacheEnabled
    };
}

/**
 * Quick vision check for a single product
 * Useful for testing or on-demand validation
 *
 * @param {Object} product - Product to validate
 * @param {string} query - Original search query
 * @returns {Promise<Object>} Vision result
 */
export async function quickVisionCheck(product, query) {
    const result = await validateWithVision(
        [{ ...product, _confidence: 100 }], // Force high confidence
        { query }
    );

    const url = product.offer_detail_url || product.url;
    return result.results.find(p => (p.offer_detail_url || p.url) === url);
}
