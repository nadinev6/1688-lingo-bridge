# 1688 Lingo Bridge - Project Roadmap

## Overview

This project aims to bridge the gap between English-speaking buyers and Chinese suppliers on 1688.com through intelligent translation and semantic understanding.

---

## Phase 1 (Current): Raw Scraping

**Status:** ✅ Completed

**Description:**
Naive English queries leading to mismatched results. The current implementation translates product data post-scraping, but the search query itself ("outdoor power supply energy storage") returns irrelevant results like "Cake Moulds" and "Silicone Placemats".

**Key Observation:**
The translated results in [`artifacts/localized_products.json`](artifacts/localized_products.json) show the problem clearly:
- Query: "outdoor power supply energy storage" (户外电源 储能)
- Results: Cake moulds, placemats, baking tools

**Deliverables:**
- [x] Basic translation pipeline using Lingo.dev
- [x] Sample data processing
- [x] Environment configuration

---

## Phase 2 (In Progress): The Semantic Bridge

**Status:** 🔄 In Progress

**Description:**
Use Lingo.dev SDK to translate the **intent** of the query into native Chinese keywords **before** the scraper even starts.

**Goal:**
Transform "outdoor power supply energy storage" → "户外便携式电源" (outdoor portable power station) or similar terms that Chinese suppliers actually use.

**Implementation:**
- [`lib/queryProcessor.js`](../lib/queryProcessor.js) - Intent-to-Native logic
- [`i18n.json`](../i18n.json) - Single Source of Truth (glossary, negative keywords, synonyms)

**Approach:**
1. ✅ Pre-processing layer for search queries (`generateSearchBundle`)
2. ✅ Glossary lookup for known terms (zero drift)
3. ✅ SDK `localizeText` for unknown terms
4. ✅ Negative keywords to filter irrelevant results
5. ✅ Synonym generation for broader search coverage

**Input/Output Example:**
```javascript
// Input
{
  query: "outdoor power supply energy storage",
  context: "consumer electronics, camping gear, high-capacity batteries",
  market: "UK B2B"
}

// Output
{
  primary: "户外电源",
  technical: "户外电源 储能",
  synonyms: ["便携式储能", "露营电源"],
  negative_keywords: ["模具", "餐垫", "硅胶", "烘焙"],
  original_query: "outdoor power supply energy storage"
}
```

**Expected Outcome:**
Search results that actually match the buyer's intent, with:

1. **Semantic Precision**: The `primary` field returns the most relevant Chinese term (e.g., "户外电源储能" instead of literal "户外电源 储能")

2. **1688 SEO Optimization**: The `technical` field uses proper spacing (acts as AND operator) for better search matching: `氮化镓 GaN 充电器快充`

3. **Negative Keyword Shield**: Automatically excludes irrelevant categories:
   - Electronics queries exclude: 模具, 餐垫, 硅胶, 烘焙, 厨房, 蛋糕, 餐具
   - This prevents "Cake Mould" results when searching for "Power Supplies"

4. **Synonym Expansion**: Broadens search coverage with alternative terms:
   - 户外电源储能 → [便携式储能, 露营电源, 移动储能]
   - 氮化镓 → [GaN充电器, GaN, 氮化镓充电器]

5. **Zero Drift for Known Terms**: Glossary terms (e.g., "Mulberry Silk" → "桑蚕丝") are always translated consistently

---

## Phase 3: Validation Layer

**Status:** 🔄 In Progress

**Description:**
Validated pipeline with confidence scoring, smart scraping, and duplicate detection.

**Implementation:**
- [`lib/scraper.js`](../lib/scraper.js) - Smart/Adaptive scraper with deduplication
- [`lib/validator.js`](../lib/validator.js) - Confidence scoring with fuzzy matching
- [`i18n.json`](../i18n.json) - Added `suspicious_terms` and `category_mappings`

**Features:**
1. ✅ **Smart/Adaptive Scraping**
   - Primary-first strategy (60 results)
   - Synonym expansion when results ≤ 20 (1688 pages come in 20s)
   - Duplicate detection by product URL

2. ✅ **Two-Tier Filtering**
   - **Blacklist** (removes data): 模具, 餐垫, 硅胶, 烘焙, 蛋糕
   - **Suspicious** (penalty only): 二手, 配件, 维修, 拆机

3. ✅ **Confidence Scoring**
   - Category match with Jaro-Winkler fuzzy matching (40 points)
   - Title relevance (30 points)
   - Passing blacklist bonus (30 points)
   - Suspicious term penalty (-30 points)

4. ✅ **Latency Transparency**
   ```
   ⏱️ Primary scrape: 294ms (16 results)
   ⏱️ Synonym "便携式储能": 406ms (+0 unique, 3 dupes)
   ✅ Total Pipeline Latency: 11268ms
   ```

**Example Output:**
```
📊 PIPELINE SUMMARY
   Original Query: "outdoor power supply energy storage"
   Chinese Query: "户外电源储能"
   Total Results: 64
   Average Confidence: 50.5%
   High Confidence: 12
   Filtered by Blacklist: 0

📦 Top 3 Results (by confidence):
   1. [70%] 便携式户外电源 1000W 露营应急电源
   2. [70%] 便携式户外电源 1000W 露营应急电源
   3. [70%] 便携式户外电源 1000W 露营应急电源
```

**Confidence Improvement Through Pivot:**
| Metric | Before Pivot | After Pivot | Improvement |
|--------|--------------|-------------|-------------|
| Average Confidence | 37.5% | 50.5% | +13.0% |
| High Confidence Products | 3 | 12 | +300% |
| Total Results | 16 | 64 | +300% |
| Duplicates | - | 0 | 0% dupes |

**Expected Outcome:**
Quality-assured results with confidence scores, filtered blacklist, and full latency transparency.

---

## Phase 4: Image-to-Image Validation

**Status:** 🔮 Future

**Description:**
Use AI vision to validate that product images actually match the search intent. A secondary check that verifies the70% confidence results look like the target object.

**Goal:**
Prevent "bait and switch" listings where the title says "Power Station" but the image shows "Cake Mould".

**Approach:**
1. Extract product image URLs from scrape results
2. Use **OpenAI GPT-4o / GPT-4V** for image analysis
3. Compare image content against original English intent
4. Generate visual confidence score (0-100%)
5. Filter products where text confidence ≠ visual confidence

**Example Flow:**
```
Product: "便携式户外电源 1000W"
Image URL: https://cbu01.alicdn.com/img/ibank/...
Vision Check: "Does this image show a portable power station?"
Result: ✅ YES (95% visual confidence)

Product: "硅胶餐垫 户外电源" (keyword stuffing)
Image URL: https://cbu01.alicdn.com/img/ibank/...
Vision Check: "Does this image show a portable power station?"
Result: ❌ NO (shows silicone placemats, 5% visual confidence)
```

**Implementation Ideas:**
- [`lib/visionValidator.js`] - AI vision validation module
- Batch processing for efficiency (check top 10 results only)
- Cache vision results to avoid re-processing same images
- Fallback to text-only validation if vision API unavailable

**Expected Outcome:**
Visual verification that eliminates "keyword stuffing" products and ensures buyers see what they're searching for.

---

## Phase 5: Frontend Dashboard

**Status:** 🔮 Future

**Description:**
User interface for the 1688 Lingo Bridge pipeline.

**Goal:**
Provide a visual interface for buyers to search, review, and export validated product results.

**Key Feature - Export to Sourcing Sheet:**
A one-click button that generates a CSV/PDF with:
- Chinese title (original 1688 listing)
- English translation
- Price in GBP
- Confidence Score

This is a document a buyer can actually send to their boss or a freight forwarder.

---

## Architecture Vision

### Phase 1: Raw Scraping

```text
English Query --> 1688 Scraper --> Chinese Results --> Translate --> Mismatched Results
```

### Phase 2: Semantic Bridge

```text
English Query --> LLM Intent Translation --> Native Chinese Query --> 1688 Scraper --> Relevant Results
```

### Phase 3: Validated Pipeline

```text
English Query --> Intent Translation --> Chinese Query --> Scraper --> Results --> Validate --> Verified Results
```

---

## Quick Links

- [Localized Products Sample](artifacts/localized_products.json)
- [Sample Chinese Data](../sample_data.json)
- [Main Application](../main.js)
