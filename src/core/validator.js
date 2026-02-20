/**
 * Validator - Confidence Scoring with Fuzzy Matching
 * Phase 3 of 1688 Lingo Bridge
 *
 * @module lib/validator
 * @see plans/phase3-validation-layer-plan.md
 */

import glossaryData from '../data/i18n.json' with { type: 'json' };

// Confidence thresholds
const HIGH_CONFIDENCE = 70;
const LOW_CONFIDENCE = 50;

/**
 * Validate results against original intent with confidence scoring
 *
 * @param {Object[]} results - Scraped products
 * @param {Object} originalIntent - Original search intent
 * @param {string} originalIntent.query - Original English query
 * @param {string} originalIntent.chinese_query - Translated Chinese query
 * @param {string} originalIntent.context - Context hints
 * @param {string[]} originalIntent.negative_keywords - Blacklisted terms
 * @returns {Promise<Object>} Validated results with confidence scores
 */
export async function validateResults(results, originalIntent) {
  const startTime = Date.now();
  console.log(`\n🔍 Validating ${results.length} results against intent...`);
  console.log(`   📯 Original query: "${originalIntent.query}"`);
  console.log(`   🀄 Cn Query: "${originalIntent.chinese_query || 'N/A'}"`);
  console.log(`   📋 Context: "${originalIntent.context}"`);

  // 1. Calculate price statistics for Price Guard
  const prices = results
    .map(p => {
      // Handle "1580 (¥1580)" format or raw numbers
      let rawPrice = p.price || p.offer_price || '0';
      if (typeof rawPrice === 'string') {
        // Extract first number
        const match = rawPrice.match(/[\d\.]+/);
        rawPrice = match ? match[0] : '0';
      }
      return parseFloat(rawPrice);
    })
    .filter(p => !isNaN(p) && p > 0)
    .sort((a, b) => a - b);

  const medianPrice = prices.length > 0
    ? prices[Math.floor(prices.length / 2)]
    : 0;

  console.log(`   💰 Median Price: ¥${medianPrice}`);

  // 2. Calculate confidence for each product
  const validated = results.map(product => {
    // Extract price for individual product scoring
    let rawPrice = product.price || product.offer_price || '0';
    if (typeof rawPrice === 'string') {
      const match = rawPrice.match(/[\d\.]+/);
      rawPrice = match ? match[0] : '0';
    }
    const cleanPrice = parseFloat(rawPrice);
    // Add processed price to product object for frontend use
    product.price = cleanPrice;

    const score = calculateConfidence(product, originalIntent, medianPrice);
    return { ...product, _confidence: score };
  });

  // 3. Sort by confidence (highest first)
  validated.sort((a, b) => b._confidence - a._confidence);

  // 3. Calculate statistics
  const avgConfidence = validated.reduce((sum, p) => sum + p._confidence, 0) / validated.length;
  const highConfidenceCount = validated.filter(p => p._confidence >= HIGH_CONFIDENCE).length;
  const lowConfidenceCount = validated.filter(p => p._confidence < LOW_CONFIDENCE).length;
  const suspiciousCount = validated.filter(p => p._suspicious).length;

  const latency = Date.now() - startTime;

  console.log(`\n   📊 Validation Statistics:`);
  console.log(`      Average Confidence: ${avgConfidence.toFixed(1)}%`);
  console.log(`      High Confidence (≥${HIGH_CONFIDENCE}%): ${highConfidenceCount} products`);
  console.log(`      Low Confidence (<${LOW_CONFIDENCE}%): ${lowConfidenceCount} products`);
  console.log(`      Suspicious (flagged): ${suspiciousCount} products`);
  console.log(`   ⏱️ Validation latency: ${latency}ms`);

  return {
    results: validated,
    metadata: {
      averageConfidence: Math.round(avgConfidence * 10) / 10,
      highConfidenceCount,
      lowConfidenceCount,
      suspiciousCount,
      validationLatency: latency
    }
  };
}

/**
 * Calculate confidence score for a single product
 *
 * @param {Object} product - Product to score
 * @param {Object} intent - Original intent
 * @param {number} medianPrice - Median price of all results
 * @returns {number} Confidence score 0-100
 */
function calculateConfidence(product, intent, medianPrice) {
  let score = 0;

  // 1. Category match with DOMAIN INTELLIGENCE (40 points max)
  // Technical categories get a boost over generic ones
  const categoryScore = fuzzyCategoryMatch(
    product.main_category || product.categoryName,
    intent.context
  );
  score += categoryScore * 0.4;

  // 2. Title relevance (30 points max)
  // Use Chinese query if available, otherwise fallback to English terms
  const titleScore = calculateTitleRelevance(
    product.offer_subject,
    intent.chinese_query || intent.query
  );
  score += titleScore * 0.3;

  // 3. Base score for passing blacklist (20 points)
  // Reduced from 30 to make room for Price Guard
  if (!product._blacklisted) {
    score += 20;
  }

  // 4. PRICE GUARD (10 points max + Penalty)
  // Check if price is within reasonable range of median
  const price = parseFloat(product.price || 0);
  if (medianPrice > 0 && price > 0) {
    if (price < (medianPrice * 0.1)) {
      // "Accessory Bait" detection: <10% of median price
      // e.g., ¥50 cable for a ¥5000 power station
      score -= 30;
      product._suspicious = true;
      product._suspiciousReason = 'abnormally_low_price';
    } else {
      score += 10; // Price is reasonable
    }
  } else {
    score += 5; // Neutral if price missing
  }

  // 5. SUSPICIOUS terms penalty (LOWERS score, but keeps data)
  // Examples: "二手" (used), "配件" (parts only), "维修" (repair)
  if (containsSuspiciousTerms(product)) {
    score -= 30;
    product._suspicious = true;
    product._suspiciousReason = getSuspiciousReason(product);
  }

  // Clamp to 0-100
  return Math.max(0, Math.min(100, Math.round(score)));
}

/**
 * Domain Intelligence category matching
 * Uses category_mappings from i18n.json instead of string similarity
 * Prioritizes SPECIALIZED categories over GENERIC ones
 *
 * @param {string} productCategory - Product's category (Chinese)
 * @param {string} intentContext - Intent context (English)
 * @returns {number} Match score 0-100
 */
function fuzzyCategoryMatch(productCategory, intentContext) {
  if (!productCategory || !intentContext) return 40; // Neutral score

  const contextLower = intentContext.toLowerCase();
  const categoryMappings = glossaryData.category_mappings || {};

  // Priority 1: Check TECHNICAL categories first (Power, Electronics)
  // These are higher value matches
  const technicalCategories = ['power', 'electronics', 'consumer electronics', 'energy storage', 'batteries', 'high-capacity batteries'];


  for (const techCat of technicalCategories) {
    if (categoryMappings[techCat] && contextLower.includes(techCat)) {
       for (const chineseVariant of categoryMappings[techCat]) {
        if (productCategory.includes(chineseVariant)) {
          return 100; // Perfect TECHNICAL match
        }
      }
    }
  }

  // Priority 2: Check GENERAL categories (Outdoors, Camping, Home)
  // These get a slightly lower score to prefer technical matches
  for (const [englishCategory, chineseVariants] of Object.entries(categoryMappings)) {
    // Skip if we already checked it as technical
    if (technicalCategories.includes(englishCategory)) continue;

    if (contextLower.includes(englishCategory.toLowerCase())) {
      for (const chineseVariant of chineseVariants) {
        if (productCategory.includes(chineseVariant)) {
          return 85; // Good match, but generic category
        }
      }
    }
  }

  // FALLBACK: Partial matching for unmapped categories
  // Check if any word in context appears in the category
  const contextWords = contextLower.split(/[\s,]+/).filter(w => w.length >= 4);

  for (const word of contextWords) {
    // Check if this word has a mapping we haven't defined
    // This catches edge cases
    if (productCategory.toLowerCase().includes(word.substring(0, 4))) {
      return 60; // Partial match
    }
  }

  // No match found - return neutral score
  // Don't punish products for having different categories
  return 40;
}

/**
 * Calculate title relevance score
 * Enhanced for Chinese character coverage
 *
 * @param {string} title - Product title
 * @param {string} query - Query string (multi-lingual)
 * @returns {number} Relevance score 0-100
 */
function calculateTitleRelevance(title, query) {
  if (!title || !query) return 50; // Neutral score

  const titleLower = title.toLowerCase();

  // CHINESE OPTIMIZATION:
  // If query contains Chinese characters and no spaces,
  // switch to character coverage mode instead of token matching
  const hasChinese = /[\u4e00-\u9fa5]/.test(query);
  if (hasChinese && !query.includes(' ')) {
    let matchedChars = 0;
    // Iterate unique characters in query
    const uniqueChars = new Set(query.split(''));
    for (const char of uniqueChars) {
      if (titleLower.includes(char)) {
        matchedChars++;
      }
    }
    const coverage = matchedChars / uniqueChars.size;

    // Strictness bonus: sequential match?
    // If title contains the full query string as a substring -> 100%
    if (titleLower.includes(query)) return 100;

    return Math.round(coverage * 100);
  }

  // STANDARD TOKEN MATCHING (English/Space-separated)
  const queryTerms = query.toLowerCase().split(/\s+/);

  let matchCount = 0;
  for (const term of queryTerms) {
    if (term.length < 3) continue; // Skip short terms
    if (titleLower.includes(term)) {
      matchCount++;
    }
  }

  // Score based on percentage of query terms found
  const relevantTerms = queryTerms.filter(t => t.length >= 3);
  if (relevantTerms.length === 0) return 50;

  return Math.round((matchCount / relevantTerms.length) * 100);
}

/**
 * Check if product contains suspicious terms
 * These are POTENTIALLY relevant but risky (e.g., used items, parts)
 *
 * @param {Object} product - Product to check
 * @returns {boolean} True if suspicious terms found
 */
function containsSuspiciousTerms(product) {
  const suspiciousTerms = glossaryData.suspicious_terms || {};
  const allSuspicious = Object.values(suspiciousTerms).flat();

  const searchText = [
    product.offer_subject,
    product.main_category,
    product.categoryName
  ].filter(Boolean).join(' ');

  for (const term of allSuspicious) {
    if (searchText.includes(term)) {
      return true;
    }
  }

  return false;
}

/**
 * Get the reason for suspicious flag
 *
 * @param {Object} product - Product to check
 * @returns {string} Suspicious term found
 */
function getSuspiciousReason(product) {
  const suspiciousTerms = glossaryData.suspicious_terms || {};
  const allSuspicious = Object.values(suspiciousTerms).flat();

  const searchText = [
    product.offer_subject,
    product.main_category,
    product.categoryName
  ].filter(Boolean).join(' ');

  for (const term of allSuspicious) {
    if (searchText.includes(term)) {
      return term;
    }
  }

  return 'unknown';
}

/**
 * Jaro-Winkler string similarity algorithm
 * Returns similarity score between 0 and 1
 *
 * @param {string} s1 - First string
 * @param {string} s2 - Second string
 * @returns {number} Similarity score 0-1
 */
function jaroWinkler(s1, s2) {
  if (s1 === s2) return 1.0;

  if (!s1 || !s2) return 0.0;

  const len1 = s1.length;
  const len2 = s2.length;

  // Maximum distance for matching characters
  const matchDistance = Math.floor(Math.max(len1, len2) / 2) - 1;

  // Arrays to track matching characters
  const s1Matches = new Array(len1).fill(false);
  const s2Matches = new Array(len2).fill(false);

  let matches = 0;
  let transpositions = 0;

  // Find matching characters
  for (let i = 0; i < len1; i++) {
    const start = Math.max(0, i - matchDistance);
    const end = Math.min(i + matchDistance + 1, len2);

    for (let j = start; j < end; j++) {
      if (s2Matches[j] || s1[i] !== s2[j]) continue;

      s1Matches[i] = true;
      s2Matches[j] = true;
      matches++;
      break;
    }
  }

  if (matches === 0) return 0.0;

  // Count transpositions
  let k = 0;
  for (let i = 0; i < len1; i++) {
    if (!s1Matches[i]) continue;

    while (!s2Matches[k]) k++;

    if (s1[i] !== s2[k]) transpositions++;
    k++;
  }

  // Jaro similarity
  const jaro = (
    matches / len1 +
    matches / len2 +
    (matches - transpositions / 2) / matches
  ) / 3;

  // Jaro-Winkler adjustment (boost for common prefix)
  let prefix = 0;
  for (let i = 0; i < Math.min(len1, len2, 4); i++) {
    if (s1[i] === s2[i]) prefix++;
    else break;
  }

  return jaro + prefix * 0.1 * (1 - jaro);
}

/**
 * Quick validation for single product
 *
 * @param {Object} product - Product to validate
 * @param {Object} intent - Original intent
 * @returns {Object} Product with confidence score
 */
export function quickValidate(product, intent) {
  const score = calculateConfidence(product, intent);
  return { ...product, _confidence: score };
}
