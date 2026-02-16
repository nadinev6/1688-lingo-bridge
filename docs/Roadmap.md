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

## Phase 2 (Tomorrow): The Semantic Bridge

**Status:** 🔜 Planned

**Description:**
Use an LLM (via Lingo.dev or similar) to translate the **intent** of the query into native Chinese keywords **before** the scraper even starts.

**Goal:**
Transform "outdoor power supply energy storage" → "户外便携式电源" (outdoor portable power station) or similar terms that Chinese suppliers actually use.

**Approach:**
1. Pre-processing layer for search queries
2. Semantic understanding of product categories
3. Cultural/contextual keyword mapping

**Expected Outcome:**
Search results that actually match the buyer's intent.

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
