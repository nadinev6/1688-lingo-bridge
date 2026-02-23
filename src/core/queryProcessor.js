/**
 * Query Processor - Intent-to-Native Logic
 * Transforms English search intent into Chinese search bundles for 1688.com
 *
 * @module lib/queryProcessor
 * @see i18n.json - Single Source of Truth for glossary, negative keywords, and synonyms
 */

import { LingoDotDevEngine } from "lingo.dev/sdk";
import glossaryData from '../data/i18n.json' with { type: 'json' };
import 'dotenv/config';

// Initialize Lingo.dev Engine
const lingo = new LingoDotDevEngine({ apiKey: process.env.LINGODOTDEV_API_KEY });

// Build reverse glossary map: English (lowercase) -> Chinese
// Flatten category-keyed glossary into a single array of { src, tgt } pairs
const flatGlossary = Object.entries(glossaryData.glossary)
  .filter(([key]) => key !== '_comment')
  .flatMap(([, entries]) => entries);

const reverseGlossary = new Map(
  flatGlossary.map(g => [g.tgt.toLowerCase(), g.src])
);

// In-memory cache for Lingo.dev translations
const translationCache = new Map();

/**
 * Transforms English intent into a Chinese search bundle
 *
 * @param {Object} intentObject - The intent object
 * @param {string} intentObject.query - English search query (e.g., "outdoor power supply energy storage")
 * @param {string} [intentObject.context] - Context hints (e.g., "consumer electronics, camping gear")
 * @param {string} [intentObject.market] - Target market (e.g., "International B2B")
 * @returns {Promise<Object>} Chinese search bundle
 *
 * @example
 * const bundle = await generateSearchBundle({
 *   query: "outdoor power supply energy storage",
 *   context: "consumer electronics, camping gear, high-capacity batteries",
 *   market: "International B2B"
 * });
 * // Returns:
 * // {
 * //   primary: "户外电源",
 * //   technical: "户外电源 储能",
 * //   synonyms: ["便携式储能", "露营电源"],
 * //   negative_keywords: ["模具", "餐垫", "硅胶", "烘焙"],
 * //   original_query: "outdoor power supply energy storage"
 * // }
 */
export async function generateSearchBundle(intentObject) {
  console.log(`\n🔍 Mapping intent: "${intentObject.query}"...`);

  const { query, context, market } = intentObject;

  // 1. Tokenize and check glossary for known terms
  const queryWords = query.toLowerCase().split(/\s+/);

  const knownTerms = [];
  const unknownWords = [];

  // Check multi-word phrases first (e.g., "portable power station")
  const multiWordMatches = findMultiWordMatches(query.toLowerCase(), reverseGlossary);

  for (const match of multiWordMatches) {
    knownTerms.push(match.chinese);
    // Remove matched words from queryWords
    match.words.forEach(w => {
      const idx = queryWords.indexOf(w);
      if (idx > -1) queryWords.splice(idx, 1);
    });
  }

  // Check remaining single words
  for (const word of queryWords) {
    if (reverseGlossary.has(word)) {
      knownTerms.push(reverseGlossary.get(word));
    } else {
      unknownWords.push(word);
    }
  }

  // 2. Translate unknown terms using Lingo.dev SDK
  let translatedTerms = [];
  let translationFailed = false;

  if (unknownWords.length > 0) {
    const textToTranslate = unknownWords.join(' ');
    console.log(`  📡 Translating unknown terms: "${textToTranslate}"...`);

    try {
      let translated;
      if (translationCache.has(textToTranslate)) {
        console.log(`  ⚡ Using cached translation for: "${textToTranslate}"`);
        translated = translationCache.get(textToTranslate);
      } else {
        translated = await lingo.localizeText(textToTranslate, {
          sourceLocale: "en-GB",
          targetLocale: "zh-CN"
        });
        translationCache.set(textToTranslate, translated);
      }

      // Check if translation actually returned Chinese
      const hasChinese = /[\u4e00-\u9fff]/.test(translated);

      if (!hasChinese) {
        console.warn(`  ⚠️ Translation returned non-Chinese text: "${translated}"`);
        translationFailed = true;
        translatedTerms = [];
      } else {
        // OPTIMIZATION 1: Split Chinese text into individual terms for better 1688 SEO
        translatedTerms = splitChineseTerms(translated);
      }
    } catch (error) {
      console.warn(`  ⚠️ Translation failed for "${textToTranslate}": ${error.message}`);
      translationFailed = true;
      translatedTerms = [];
    }
  }

  // 3. Combine all terms
  const allTerms = [...knownTerms, ...translatedTerms];

  // HARD STOP: If we have no Chinese terms, we cannot search 1688 effectively
  if (allTerms.length === 0 || (knownTerms.length === 0 && translationFailed)) {
    const error = new Error('Bridge Connection Weak: Could not generate native Chinese search terms. Translation failed and no glossary matches found.');
    error.code = 'TRANSLATION_FAILED';
    error.originalQuery = query;
    throw error;
  }

  // 4. Determine primary term (first known term, or first translated)
  const primary = knownTerms[0] || translatedTerms[0] || query;

  // 5. Build technical query with SPACES for 1688 SEO (acts as AND operator)
  const technical = allTerms.join(' ');

  // 6. Get synonyms for primary term (with SDK fallback)
  const synonyms = await getSynonyms(primary, context);

  // 7. Get negative keywords based on context
  const negativeKeywords = getNegativeKeywords(context);

  // 8. Generate dynamic scoring signals via GPT
  const scoringSignals = await generateScoringSignals(intentObject, primary);

  // 9. Build and return the search bundle
  const bundle = {
    primary,
    technical,
    synonyms,
    negative_keywords: negativeKeywords,
    original_query: query,
    scoring_signals: scoringSignals,
    _metadata: {
      knownTerms: knownTerms.length,
      translatedTerms: translatedTerms.length,
      synonymSource: synonyms._source || 'glossary',
      signalsSource: scoringSignals._source || 'fallback',
      context: context || null,
      market: market || null,
      timestamp: new Date().toISOString()
    }
  };

  // Remove internal tracking properties
  delete bundle.synonyms._source;
  delete bundle.scoring_signals._source;

  console.log(`✅ Generated search bundle:`);
  console.log(`   Primary: ${bundle.primary}`);
  console.log(`   Technical: ${bundle.technical}`);
  console.log(`   Synonyms: [${bundle.synonyms.join(', ')}]`);
  console.log(`   Negative: [${bundle.negative_keywords.join(', ')}]`);
  console.log(`   Scoring signals: ${scoringSignals.positive_keywords?.length || 0} positive, ${scoringSignals.negative_keywords?.length || 0} negative keywords`);

  return bundle;
}

/**
 * OPTIMIZATION 1: Split Chinese text into individual terms for better 1688 SEO
 * In Chinese SEO, spaces act as "AND" operators, helping the algorithm find listings
 * that contain all specific tokens without needing exact sequence matches.
 *
 * @param {string} chineseText - The Chinese text to split
 * @returns {Array} Array of individual Chinese terms
 */
function splitChineseTerms(chineseText) {
  const cleaned = chineseText.trim();

  // If text is short (≤6 chars), keep as single term
  if (cleaned.length <= 6) {
    return [cleaned];
  }

  const terms = [];
  let currentTerm = '';
  let prevCharType = null;

  // Character type detection
  const getCharType = (char) => {
    if (/[\u4e00-\u9fff]/.test(char)) return 'chinese';
    if (/[a-zA-Z]/.test(char)) return 'latin';
    if (/[0-9]/.test(char)) return 'number';
    if (/[\s]/.test(char)) return 'space';
    return 'other';
  };

  // Process character by character
  for (const char of cleaned) {
    const charType = getCharType(char);

    if (charType === 'space') {
      // Space = term boundary
      if (currentTerm.length > 0) {
        terms.push(currentTerm);
        currentTerm = '';
        prevCharType = null;
      }
      continue;
    }

    // Decision: should we start a new term?
    let shouldSplit = false;

    if (prevCharType === 'chinese' && currentTerm.length >= 3) {
      // Chinese terms are typically 2-4 chars
      // If we have 3+ Chinese chars, consider splitting
      if (charType === 'chinese' && currentTerm.length >= 4) {
        shouldSplit = true;
      } else if (charType !== 'chinese') {
        // Switching from Chinese to non-Chinese
        shouldSplit = true;
      }
    } else if (prevCharType === 'latin' && charType === 'chinese') {
      // Switching from Latin to Chinese
      shouldSplit = true;
    } else if (prevCharType !== 'latin' && charType === 'latin') {
      // Starting a Latin sequence
      if (currentTerm.length > 0 && prevCharType === 'chinese') {
        shouldSplit = true;
      }
    }

    if (shouldSplit && currentTerm.length > 0) {
      terms.push(currentTerm);
      currentTerm = '';
    }

    currentTerm += char;
    prevCharType = charType;
  }

  // Don't forget the last term
  if (currentTerm.length > 0) {
    terms.push(currentTerm);
  }

  // Post-process: merge very short terms with neighbors if appropriate
  const mergedTerms = [];
  for (let i = 0; i < terms.length; i++) {
    const term = terms[i];
    // Keep terms that are substantial or contain Latin characters
    if (term.length >= 2 || /[a-zA-Z0-9]/.test(term)) {
      mergedTerms.push(term);
    } else if (mergedTerms.length > 0) {
      // Merge single-char Chinese with previous term
      mergedTerms[mergedTerms.length - 1] += term;
    }
  }

  return mergedTerms.filter(t => t.length > 0);
}

/**
 * Check if a string looks like a valid Chinese term
 * @param {string} term - The term to check
 * @returns {boolean} True if it looks like a valid term
 */
function isValidChineseTerm(term) {
  // Check if term contains mostly Chinese characters
  const chineseChars = term.match(/[\u4e00-\u9fff]/g);
  return chineseChars && chineseChars.length >= 2;
}

/**
 * Find multi-word phrase matches in the glossary
 * @param {string} query - Lowercase query string
 * @param {Map} glossary - Reverse glossary map
 * @returns {Array} Array of {chinese, words} matches
 */
function findMultiWordMatches(query, glossary) {
  const matches = [];

  // Check each glossary entry for multi-word matches
  for (const [english, chinese] of glossary.entries()) {
    if (query.includes(english)) {
      matches.push({
        chinese,
        words: english.split(' ')
      });
    }
  }

  // Sort by length (longest first) to prioritize specific matches
  matches.sort((a, b) => b.words.length - a.words.length);

  return matches;
}

/**
 * OPTIMIZATION 2: Get synonyms for a Chinese term with intelligent fallbacks
 * First checks i18n.json, then uses pattern matching for common terms
 *
 * @param {string} primaryTerm - The primary Chinese term
 * @param {string} context - Context for synonym selection
 * @returns {Promise<Array>} Array of synonym strings
 */
async function getSynonyms(primaryTerm, context = '') {
  // Check if synonyms are defined in i18n.json
  if (glossaryData.synonyms && glossaryData.synonyms[primaryTerm]) {
    const result = [...glossaryData.synonyms[primaryTerm]];
    result._source = 'glossary';
    return result;
  }

  // Fallback: intelligent synonym mapping based on term patterns
  // This avoids SDK calls which can return unpredictable results
  const synonymPatterns = {
    // Power/Energy related
    '户外电源': ['便携式储能', '露营电源', '移动电源'],
    '便携式储能': ['户外电源', '移动电源', '储能电源', '备用电源'],
    '储能': ['蓄电', '储电', '备用电源'],
    '储能电源': ['蓄电', '储电', '备用电源'],
    '便携式电源': ['移动电源', '户外电源', '储能电源'],
    '移动电源': ['充电宝', '便携充电', '电源银行'],

    // Electronics
    '氮化镓': ['GaN充电器', 'GaN', '氮化镓充电器'],
    '充电器': ['适配器', '充电头', '快充'],
    '快充': ['快速充电', '闪充', '极速充'],

    // Textiles
    '桑蚕丝': ['真丝', '丝绸', '蚕丝'],
    '真丝': ['桑蚕丝', '丝绸', '蚕丝'],

    // Compound terms (extracted from common patterns)
    '户外电源储能': ['便携式储能', '露营电源', '移动储能'],
    '氮化镓充电器': ['GaN充电器', '快充头', '氮化镓快充']
  };

  // Direct match
  if (synonymPatterns[primaryTerm]) {
    const result = [...synonymPatterns[primaryTerm]];
    result._source = 'pattern';
    return result;
  }

  // Partial match: find synonyms for terms containing known keywords
  for (const [key, synonyms] of Object.entries(synonymPatterns)) {
    if (primaryTerm.includes(key) || key.includes(primaryTerm)) {
      const result = [...synonyms];
      result._source = 'pattern-partial';
      return result;
    }
  }

  // Extract root term and try again (e.g., "氮化镓GaN" -> "氮化镓")
  const chineseOnly = primaryTerm.replace(/[a-zA-Z0-9]/g, '').trim();
  if (chineseOnly.length >= 2 && chineseOnly !== primaryTerm) {
    if (synonymPatterns[chineseOnly]) {
      const result = [...synonymPatterns[chineseOnly]];
      result._source = 'pattern-extracted';
      return result;
    }
  }

  // No synonyms found - return empty array
  const result = [];
  result._source = 'none';
  return result;
}

/**
 * Get negative keywords based on context from i18n.json
 * @param {string} context - Context string (e.g., "consumer electronics, camping gear")
 * @returns {Array} Array of negative keyword strings
 */
function getNegativeKeywords(context) {
  const negatives = new Set();
  const contextLower = context?.toLowerCase() || '';

  // Check i18n.json negative_keywords for relevant categories
  if (glossaryData.negative_keywords) {
    for (const [category, keywords] of Object.entries(glossaryData.negative_keywords)) {
      // Check if the context mentions this category
      if (contextLower.includes(category.toLowerCase())) {
        keywords.forEach(k => negatives.add(k));
      }
    }
  }

  // Default negative keywords for electronics context
  if (contextLower.includes('electronic') || contextLower.includes('battery') || contextLower.includes('power')) {
    // Add common irrelevant terms that appear in wrong results
    const defaultElectronicsNegatives = ['模具', '餐垫', '硅胶', '烘焙', '厨房'];
    defaultElectronicsNegatives.forEach(k => negatives.add(k));
  }

  return Array.from(negatives);
}

/**
 * Simplified function for quick query transformation
 * @param {string} englishQuery - English search query
 * @returns {Promise<string>} Chinese search query
 */
export async function quickTranslate(englishQuery) {
  const bundle = await generateSearchBundle({ query: englishQuery });
  return bundle.primary;
}

/**
 * Generate dynamic scoring signals for a query using GPT.
 * Every query gets its own relevance model, generated on the fly.
 *
 * Falls back to a generic default if OpenAI is unavailable.
 *
 * @param {Object} intentObject - Full intent object (must have synonyms)
 * @param {string} primaryChinese - Primary Chinese term
 * @returns {Promise<Object>} Scoring signals
 */
async function generateScoringSignals(intentObject, primaryChinese) {
  const { query, context } = intentObject;
  const HAS_OPENAI_KEY = !!process.env.OPENAI_API_KEY;

  if (!HAS_OPENAI_KEY) {
    console.log(`   ⚡ Scoring signals: using fallback (no OPENAI_API_KEY)`);
    const fb = getDefaultSignals(primaryChinese);
    fb._source = 'fallback';
    return fb;
  }

  try {
    // Dynamic import for OpenAI (ESM)
    const { default: OpenAI } = await import('openai');
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const prompt = `You are a 1688.com product relevance expert. Given a buyer's search query, generate scoring signals to rank products by relevance on 1688.com (China's largest B2B marketplace).

Query (English): "${query}"
Primary Chinese term: "${primaryChinese}"
Related Synonyms: ${Array.isArray(intentObject?.synonyms) ? intentObject.synonyms.join(', ') : 'None'}
Context: ${context || 'general'}

Return ONLY valid JSON (no markdown, no explanation) with this exact structure:
{
  "positive_keywords": ["term1", "term2"],
  "moderate_keywords": ["term1", "term2"],
  "weak_keywords": ["term1", "term2"],
  "negative_keywords": ["term1", "term2"],
  "spec_patterns": [
    { "regex": "\\\\d+[wW](?!h)", "label": "wattage", "high_threshold": 1000, "mid_threshold": 200 },
    { "regex": "\\\\d+HRC", "label": "hardness" }
  ],
  "price_tiers": { "high": 500, "mid": 200, "low": 50 },
  "theoretical_max": 130
}

Rules:
- positive_keywords: 3-5 Chinese terms that STRONGLY indicate the product is what the buyer wants (+20 points each)
- moderate_keywords: 2-4 Chinese terms that are related but less specific (+10 points each)
- weak_keywords: 1-3 generic terms that partially match (+3 points each)
- negative_keywords: 3-5 Chinese terms that indicate the product is WRONG (-20 points each)
- spec_patterns: 1-3 regex patterns for extracting numerical specs from titles (like wattage, capacity, weight, hardness). Use double-escaped backslashes for JSON.
- price_tiers: expected ¥CNY price ranges for genuine products in this category
- theoretical_max: sum of all positive signals (used for normalization to 0-100)

All keywords MUST be in Chinese. Think about what terms a real buyer on 1688.com would use to distinguish genuine products from irrelevant ones.`;

    const response = await Promise.race([
      openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: 'You are a 1688.com product scoring expert. Return ONLY valid JSON.' },
          { role: 'user', content: prompt }
        ],
        max_tokens: 800,
        temperature: 0.2
      }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Scoring signals timeout')), 8000))
    ]);

    const content = response.choices[0]?.message?.content;
    if (!content) throw new Error('Empty GPT response');

    // Parse JSON (handle markdown code blocks)
    let jsonStr = content;
    const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) jsonStr = jsonMatch[1];

    const signals = JSON.parse(jsonStr);

    // Validate structure
    if (!signals.positive_keywords || !Array.isArray(signals.positive_keywords)) {
      throw new Error('Invalid signals structure');
    }

    console.log(`   🤖 Scoring signals generated by GPT (${signals.positive_keywords.length} positive, ${signals.negative_keywords?.length || 0} negative)`);
    signals._source = 'gpt';
    return signals;

  } catch (error) {
    console.warn(`   ⚠️ GPT scoring signals failed: ${error.message}, using fallback`);
    const fb = getDefaultSignals(primaryChinese);
    fb._source = 'fallback';
    return fb;
  }
}

/**
 * Default fallback scoring signals when GPT is unavailable.
 * Uses the primary Chinese term to generate basic signals.
 *
 * @param {string} primaryChinese - Primary Chinese term
 * @returns {Object} Default scoring signals
 */
function getDefaultSignals(primaryChinese) {
  return {
    positive_keywords: [primaryChinese],
    moderate_keywords: [],
    weak_keywords: [],
    negative_keywords: ['磁吸', '迷你', '礼品', '手机壳'],
    spec_patterns: [],
    price_tiers: { high: 500, mid: 200, low: 50 },
    theoretical_max: 80
  };
}
