/**
 * Validator - Signal-Based Confidence Scoring
 * Phase 3 of 1688 Lingo Bridge
 *
 * Scores products using domain-specific signals:
 * category keywords, wattage, capacity, price, supplier badges
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
 * Calculate confidence score for a single product using signal-based scoring.
 * Returns both the score and a breakdown of applied signals.
 *
 * @param {Object} product - Product to score
 * @param {Object} intent - Original intent
 * @param {number} medianPrice - Median price of all results (unused, kept for API compat)
 * @returns {{score: number, breakdown: Object}} Confidence score 0-100 and signal breakdown
 */
function calculateConfidence(product, intent, medianPrice) {
  const signals = intent.scoring_signals;
  let score = 0;
  const title = (product.offer_subject || product.title || '').toLowerCase();
  const breakdown = {
    positiveKeywords: [],
    moderateKeywords: [],
    weakKeywords: [],
    negativeKeywords: [],
    specMatches: [],
    priceSignals: [],
    suspiciousFlags: [],
    reason: ''
  };

  // If we have dynamic signals from GPT, use them
  if (signals) {
    // 1. Keyword Signals (Dynamic)
    (signals.positive_keywords || []).forEach(k => {
      if (fuzzyMatchKeyword(title, k)) {
        score += 20;
        breakdown.positiveKeywords.push(k);
      }
    });
    (signals.moderate_keywords || []).forEach(k => {
      if (fuzzyMatchKeyword(title, k)) {
        score += 10;
        breakdown.moderateKeywords.push(k);
      }
    });
    (signals.weak_keywords || []).forEach(k => {
      if (fuzzyMatchKeyword(title, k)) {
        score += 3;
        breakdown.weakKeywords.push(k);
      }
    });
    (signals.negative_keywords || []).forEach(k => {
      if (title.includes(k.toLowerCase())) {
        score -= 20;
        breakdown.negativeKeywords.push(k);
      }
    });

    // 1b. Extra bonus for any term from the search bundle (ensures synonyms are covered)
    const bundleTerms = [intent.chinese_query, ...(intent.synonyms || [])].filter(Boolean);
    bundleTerms.forEach(term => {
      if (fuzzyMatchKeyword(title, term)) {
        score += 20;
        breakdown.positiveKeywords.push(`primary: ${term}`);
      }
    });

    // 2. Spec Patterns (Dynamic)
    (signals.spec_patterns || []).forEach(pattern => {
      const match = title.match(new RegExp(pattern.regex, 'i'));
      if (match) {
        const val = parseInt(match[1]);
        if (!isNaN(val)) {
          if (pattern.high_threshold && val >= pattern.high_threshold) {
            score += 15;
            breakdown.specMatches.push(`${pattern.regex}: ${val} (high)`);
          }
          else if (pattern.mid_threshold && val >= pattern.mid_threshold) {
            score += 10;
            breakdown.specMatches.push(`${pattern.regex}: ${val} (mid)`);
          }
          else if (!pattern.high_threshold) {
            score += 15;
            breakdown.specMatches.push(`spec match: ${match[0]}`);
          }
        } else {
          score += 10;
          breakdown.specMatches.push(`spec pattern: ${match[0]}`);
        }
      }
    });

    // 3. Price Signals (Dynamic & Median-Based Price Guard)
    const tiers = signals.price_tiers || { high: 500, mid: 200, low: 50 };
    const price = parseFloat(product.price || 0);

    // Static tiers (GPT-generated or fallback)
    if (price >= tiers.high) {
      score += 10;
      breakdown.priceSignals.push(`premium tier (≥${tiers.high})`);
    }
    else if (price >= tiers.mid) {
      score += 5;
      breakdown.priceSignals.push(`mid tier (≥${tiers.mid})`);
    }
    else if (price < tiers.low && price > 0) {
      score -= 10;
      breakdown.priceSignals.push(`budget tier (<${tiers.low})`);
    }

    // Price Guard (Relative to Median)
    // described in README: detect <10% of median (accessory bait)
    if (medianPrice > 0 && price > 0) {
      if (price < medianPrice * 0.1) {
        score -= 30;
        product._suspicious = true;
        product._suspiciousReason = 'Price Guard: Possible accessory bait (<10% median)';
        breakdown.suspiciousFlags.push('accessory bait (<10% median): -30');
      } else if (price > medianPrice * 1.5) {
        // Also flag outliers > 1.5x median as per dashboard guardrail bar
        product._suspicious = true;
        product._suspiciousReason = 'Price Guard: Outlier price (>1.5x median)';
        breakdown.suspiciousFlags.push('price outlier (>1.5x median): -30');
      }
    }

    // ── SUSPICIOUS TERMS PENALTY ──
    if (containsSuspiciousTerms(product)) {
      score -= 30;
      product._suspicious = true;
      product._suspiciousReason = (product._suspiciousReason ? product._suspiciousReason + ' + ' : '') + getSuspiciousReason(product);
      breakdown.suspiciousFlags.push(`suspicious term detected: -30`);
    }

    // Build reason string
    if (breakdown.positiveKeywords.length > 0) breakdown.reason += `Matched: ${breakdown.positiveKeywords.slice(0, 2).join(', ')}. `;
    if (breakdown.specMatches.length > 0) breakdown.reason += `Specs verified. `;
    if (breakdown.priceSignals.length > 0) breakdown.reason += `${breakdown.priceSignals[0]}. `;
    if (breakdown.suspiciousFlags.length > 0) breakdown.reason = `⚠️ ${breakdown.suspiciousFlags[0]}`;

    // Normalization
    // A "perfect" title usually matches: Primary Term (20) + 1 High Spec (15) + 2 Positive Keywords (40) = 75
    // Plus maybe a bonus from bundleTerms (20) = 95.
    // Setting max to 90 makes 63 points (70%) achievable for strong matches.
    const theoreticalMax = signals.theoretical_max || 90;
    const normalized = Math.round((score / theoreticalMax) * 100);
    const finalScore = Math.max(0, Math.min(100, normalized));

    product._scoreBreakdown = breakdown;
    return finalScore;
  }

  // FALLBACK: Hardcoded rubric for Outdoor Power Supply (if GPT signals missing)
  // ═══════════════════════════════════════════════════════════════
  //  CATEGORY SIGNALS
  // ═══════════════════════════════════════════════════════════════
  if (title.includes('储能')) {
    score += 20;
    breakdown.specMatches.push('energy storage');
  }
  if (/220v|110v/i.test(title)) {
    score += 15;
    breakdown.specMatches.push('voltage specified');
  }
  if (title.includes('正弦波') || title.includes('逆变')) {
    score += 15;
    breakdown.specMatches.push('sine wave inverter');
  }
  if (title.includes('户外电源') || (title.includes('户外') && title.includes('电源'))) {
    score += 10;
    breakdown.specMatches.push('outdoor power');
  }
  if (title.includes('露营')) {
    score += 10;
    breakdown.specMatches.push('camping');
  }
  if (title.includes('充电宝') || title.includes('移动电源')) {
    score += 3;
    breakdown.weakKeywords.push('power bank');
  }
  if (/磁吸|迷你|礼品/.test(title)) {
    score -= 20;
    breakdown.suspiciousFlags.push('likely accessory: -20');
  }

  // ═══════════════════════════════════════════════════════════════
  //  SPECS SIGNALS
  // ═══════════════════════════════════════════════════════════════
  const kwhMatch = title.match(/(\d+)\s*度电/);
  if (kwhMatch && parseInt(kwhMatch[1]) >= 1) {
    score += 15;
    breakdown.specMatches.push(`${kwhMatch[0]} capacity`);
  }

  const whMatch = title.match(/(\d+)\s*[wW]h/i);
  if (whMatch && parseInt(whMatch[1]) >= 300) {
    score += 10;
    breakdown.specMatches.push(`${whMatch[0]} capacity`);
  }

  const wattMatch = title.match(/(\d+)\s*[wW](?!h)/i);
  if (wattMatch) {
    const watts = parseInt(wattMatch[1]);
    if (watts >= 1000) {
      score += 15;
      breakdown.specMatches.push(`${wattMatch[0]} power`);
    }
    else if (watts >= 200) {
      score += 10;
      breakdown.specMatches.push(`${wattMatch[0]} power`);
    }
  }

  // ═══════════════════════════════════════════════════════════════
  //  SUPPLIER TRUST & RELEVANCE
  // ═══════════════════════════════════════════════════════════════
  const price = parseFloat(product.price || 0);
  if (price >= 500) {
    score += 10;
    breakdown.priceSignals.push('premium pricing');
  }
  else if (price >= 200) {
    score += 5;
    breakdown.priceSignals.push('mid-range pricing');
  }
  else if (price < 50 && price > 0) {
    score -= 10;
    breakdown.priceSignals.push('suspiciously low price');
  }

  const badges = product.product_badges || [];
  if (badges.includes('深度验厂')) {
    score += 5;
    breakdown.positiveKeywords.push('factory verified');
  }
  if (badges.includes('深度验商')) {
    score += 5;
    breakdown.positiveKeywords.push('merchant verified');
  }

  const coverageScore = calculateTitleRelevance(
    product.offer_subject,
    intent.chinese_query || intent.query
  );
  score += Math.round((coverageScore / 100) * 15);

  // ── SUSPICIOUS TERMS PENALTY ──
  if (containsSuspiciousTerms(product)) {
    score -= 30;
    product._suspicious = true;
    product._suspiciousReason = getSuspiciousReason(product);
    breakdown.suspiciousFlags.push(`suspicious term: -30`);
  }

  // Build reason string
  if (breakdown.specMatches.length > 0) breakdown.reason += `${breakdown.specMatches.slice(0, 2).join(', ')}. `;
  if (breakdown.priceSignals.length > 0) breakdown.reason += `${breakdown.priceSignals[0]}. `;
  if (breakdown.suspiciousFlags.length > 0) breakdown.reason = `⚠️ ${breakdown.suspiciousFlags[0]}`;

  // Normalize: theoretical max ~130 → 0-100
  const THEORETICAL_MAX = 130;
  const normalized = Math.round((score / THEORETICAL_MAX) * 100);
  const finalScore = Math.max(0, Math.min(100, normalized));

  product._scoreBreakdown = breakdown;
  return finalScore;
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
 * Checks if a keyword matches a title, allowing for "fuzzy" phrase matching.
 * Handles 1688 titles where keywords like "硬质合金铣刀" might be split
 * into "硬质合金 ... 铣刀".
 *
 * @param {string} title - Product title
 * @param {string} keyword - Keyword or phrase to match
 * @returns {boolean} True if match found
 */
function fuzzyMatchKeyword(title, keyword) {
  const t = title.toLowerCase();
  const k = keyword.toLowerCase();

  // Direct sequence match
  if (t.includes(k)) return true;

  // Split into CJK characters or Latin tokens
  const chars = k.length > 3 ? k.split('').filter(c => c.trim()) : [k];

  // For long technical phrases, ensure at least 70% characters are present
  if (k.length > 5) {
    let matches = 0;
    for (const char of chars) {
      if (t.includes(char)) matches++;
    }
    return (matches / chars.length) >= 0.8;
  }

  return false;
}

/**
 * Quick validation for single product
 *
 * @param {Object} product - Product to validate
 * @param {Object} intent - Original intent
 * @returns {Object} Product with confidence score and breakdown
 */
export function quickValidate(product, intent) {
  const score = calculateConfidence(product, intent);
  return { ...product, _confidence: score, _scoreBreakdown: product._scoreBreakdown };
}
