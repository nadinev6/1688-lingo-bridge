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

**Status:** 🔮 Future

**Description:**
Use `lingo.localizeObject` not just to translate, but to **verify** if the resulting product category matches the original intent.

**Approach:**
1. Post-translation validation
2. Category matching against original query intent
3. Confidence scoring for result relevance
4. Automatic filtering of mismatched products

**Expected Outcome:**
Quality-assured results that pass a semantic validation check before being presented to the user.

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
