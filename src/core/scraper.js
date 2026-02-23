import { ApifyClient } from 'apify-client';
import 'dotenv/config';

// Initialize Apify Client
const client = new ApifyClient({
  token: process.env.APIFY_TOKEN,
});

// Threshold for triggering synonym expansion
// 1688 pages come in multiples of 20, so <= 20 ensures we catch edge cases
const RESULTS_THRESHOLD = 20;
const MAX_RESULTS = 50;

/**
 * Smart/Adaptive scraper that expands to synonyms when needed
 *
 * @param {Object} bundle - Search bundle from queryProcessor
 * @param {string} bundle.primary - Primary Chinese search term
 * @param {string[]} bundle.synonyms - Alternative search terms
 * @param {string[]} bundle.negative_keywords - Terms to blacklist
 * @param {Object} options - Scraper options
 * @param {number} options.primaryLimit - Max results for primary query
 * @param {number} options.synonymLimit - Max results per synonym
 * @returns {Promise<Object>} Scraped results with metadata
 */
export async function smartScrape(bundle, options = {}) {
  const startTime = Date.now();
  const primaryLimit = options.primaryLimit || 60;
  const synonymLimit = options.synonymLimit || 20;

  console.log(`\n🚀 Starting smart scrape...`);
  console.log(`   📯 Primary: ${bundle.primary}`);
  console.log(`   📋 Synonyms: [${bundle.synonyms.join(', ')}]`);
  console.log(`   🚫 Blacklist: [${bundle.negative_keywords.slice(0, 3).join(', ')}${bundle.negative_keywords.length > 3 ? '...' : ''}]`);

  // 1. Primary scrape
  const primaryStart = Date.now();
  let results = await scrape1688(bundle.primary, { limit: primaryLimit });
  const primaryLatency = Date.now() - primaryStart;
  console.log(`   ⏱️ Primary scrape: ${primaryLatency}ms (${results.length} results)`);

  // 2. Adaptive synonym expansion
  // Use <= threshold (not <) because 1688 pages come in 20s
  // Even at exactly 20, we want one synonym to catch Gold Medal factories
  if (results.length <= RESULTS_THRESHOLD) {
    console.log(`   ⚠️ Only ${results.length} results (threshold: ${RESULTS_THRESHOLD}), expanding to synonyms...`);

    for (const synonym of bundle.synonyms) {
      const synonymStart = Date.now();
      const more = await scrape1688(synonym, { limit: synonymLimit });
      const synonymLatency = Date.now() - synonymStart;

      const { merged, added, duplicates } = mergeUnique(results, more);
      results = merged;

      console.log(`   ⏱️ Synonym "${synonym}": ${synonymLatency}ms (${more.length} results, +${added} unique, ${duplicates} dupes)`);

      if (results.length >= MAX_RESULTS) {
        console.log(`   ✅ Reached max results (${MAX_RESULTS}), stopping expansion`);
        break;
      }
    }
  } else {
    console.log(`   ✅ Sufficient results (${results.length} > ${RESULTS_THRESHOLD}), skipping synonyms`);
  }

  // 3. Apply BLACKLIST filter (removes data entirely)
  const beforeFilter = results.length;
  results = filterByBlacklist(results, bundle.negative_keywords);
  const filteredCount = beforeFilter - results.length;
  console.log(`   🚫 Blacklisted ${filteredCount} irrelevant results (${beforeFilter} → ${results.length})`);

  const totalLatency = Date.now() - startTime;
  console.log(`\n✅ Smart scrape complete: ${results.length} results in ${totalLatency}ms`);

  return {
    results,
    metadata: {
      totalResults: results.length,
      filteredByBlacklist: filteredCount,
      totalLatency,
      primaryLatency,
      synonymExpansionTriggered: results.length <= RESULTS_THRESHOLD + filteredCount
    }
  };
}

/**
 * Merge new results with existing, detecting duplicates by URL
 *
 * @param {Object[]} existing - Existing results
 * @param {Object[]} newResults - New results to merge
 * @returns {Object} { merged, added, duplicates }
 */
function mergeUnique(existing, newResults) {
  const seen = new Set(existing.map(p => p.offer_detail_url || p.detail_url || p.url));
  let added = 0;
  let duplicates = 0;

  for (const product of newResults) {
    const url = product.offer_detail_url || product.detail_url || product.url;
    if (!seen.has(url)) {
      existing.push(product);
      seen.add(url);
      added++;
    } else {
      duplicates++;
    }
  }

  return { merged: existing, added, duplicates };
}

/**
 * Mark products containing blacklisted terms (but don't remove them)
 * This allows frontend filtering for transparency
 *
 * @param {Object[]} results - Products to mark
 * @param {string[]} blacklist - Terms that trigger flagging
 * @returns {Object[]} Marked results (same count as input)
 */
function filterByBlacklist(results, blacklist) {
  if (!blacklist || blacklist.length === 0) return results;

  let flaggedCount = 0;

  results.forEach(product => {
    const searchText = [
      product.offer_subject,
      product.main_category,
      product.categoryName,
      product.company_name
    ].filter(Boolean).join(' ').toLowerCase();

    // Check if any blacklisted term appears in the product
    for (const term of blacklist) {
      if (searchText.includes(term.toLowerCase())) {
        product._blacklisted = true;
        product._blacklistReason = term;
        flaggedCount++;
        break; // Only mark once
      }
    }
  });

  console.log(`   🚫 Flagged ${flaggedCount} irrelevant results (visible but marked)`); return results;
}

/**
 * Core 1688 scraper - routes to real Apify actor if token is present,
 * otherwise falls back to mock data for development.
 *
 * @param {string} query - Chinese search query
 * @param {Object} options - Scraping options
 * @returns {Promise<Object[]>} Product results
 */
export async function scrape1688(query, options = {}) {
  const limit = Math.max(options.limit || 20, 1);  // Ensure minimum of 1

  if (!process.env.APIFY_TOKEN) {
    throw new Error('APIFY_TOKEN not found. Scraper requires a valid token to perform live searches.');
  }

  try {
    const input = {
      "queries": [query],
      "maxItems": limit,
      "maxChargedResults": limit,
      "proxy": {
        "useApifyProxy": true,
        "apifyProxyGroups": ["RESIDENTIAL"]
      },
      "pageCount": 1
    };

    const run = await client.actor("devcake/1688-com-products-scraper").call(input);
    const { items } = await client.dataset(run.defaultDatasetId).listItems();

    if (items.length === 0) {
      console.log(`   ⚠️ Live scrape returned 0 results for "${query}".`);
      return [];
    }

    return items.map(item => ({
      ...item,
      offer_subject: item.offer_subject || item.title || item.subject,
      offer_price: item.offer_price || item.price,
      offer_pic_url: item.offer_pic_url || item.imageUrl || item.image,
      offer_detail_url: item.offer_detail_url || item.url,
      _search_query: query,
      _scraped_at: new Date().toISOString()
    }));

  } catch (error) {
    console.error(`   ❌ Apify Error: ${error.message}`);
    throw error;
  }
}

/**
 * Export for testing
 */
export { mergeUnique, filterByBlacklist };
