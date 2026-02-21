/**
 * Hybrid Translation Lookup System for 1688 Tags and Badges
 *
 * This module provides zero-cost, instant translations for known service tags
 * and product badges using static lookup tables and regex patterns.
 *
 * @module src/data/translations
 * @see plans/hybrid-translation-lookup-plan.md
 */

// ═══════════════════════════════════════════════════════════════════════════════
// SERVICE TAGS - Trust/Service indicators (~20 unique values across 1688)
// ═══════════════════════════════════════════════════════════════════════════════

export const SERVICE_TAG_MAP: Record<string, string> = {
  // Return policies
  "退货包运费": "Free return shipping",
  "7天无理由": "7-day no-reason returns",
  "15天无理由": "15-day no-reason returns",
  "30天无理由": "30-day no-reason returns",

  // Payment options
  "先采后付": "Buy now, pay later",
  "诚e赊": "Credit payment",
  "账期支付": "Payment terms available",
  "分期付款": "Installment payment",

  // Shipping guarantees
  "24小时发货": "Ships within 24h",
  "48小时发货": "Ships within 48h",
  "72小时发货": "Ships within 72h",
  "现货": "In stock",
  "极速发货": "Express shipping",
  "当日发货": "Same-day shipping",

  // Quality assurances
  "正品保障": "Authentic guarantee",
  "质量保证": "Quality guaranteed",
  "售后无忧": "Worry-free after-sales",
};

// ═══════════════════════════════════════════════════════════════════════════════
// PRODUCT BADGES - Verification and trust badges (~15-20 unique values)
// ═══════════════════════════════════════════════════════════════════════════════

export const BADGE_MAP: Record<string, string> = {
  // Insurance & guarantees
  "运费险": "Shipping insurance",
  "假一赔四": "4x counterfeit guarantee",
  "假一赔十": "10x counterfeit guarantee",
  "假一赔三": "3x counterfeit guarantee",

  // Supplier verification
  "深度验商": "Verified supplier",
  "深度验厂": "Verified factory",
  "金牌供应商": "Gold medal supplier",
  "超级工厂": "Super factory",
  "实力商家": "Verified merchant",
  "源头工厂": "Source factory",
  "诚信通": "TrustPass member",

  // Response time
  "7×24H响应": "24/7 response",
  "24H响应": "24h response",

  // Special badges
  "新品首发": "New arrival",
  "热销": "Best seller",
  "爆款": "Hot item",
  "推荐": "Recommended",
};

// ═══════════════════════════════════════════════════════════════════════════════
// REGEX PATTERNS - For dynamic tag values
// ═══════════════════════════════════════════════════════════════════════════════

export interface TagPattern {
  pattern: RegExp;
  template: string;
  type: 'service' | 'badge';
  description: string;
}

export const TAG_PATTERNS: TagPattern[] = [
  // Repurchase rate: 回头率40% → Repurchase rate: 40%
  {
    pattern: /^回头率(\d+%?)$/,
    template: "Repurchase rate: $1",
    type: 'service',
    description: "Repurchase rate percentage"
  },

  // No-reason returns: 7天无理由 → 7-day no-reason returns
  {
    pattern: /^(\d+)天无理由$/,
    template: "$1-day no-reason returns",
    type: 'service',
    description: "X-day no-reason return policy"
  },

  // Ships within X hours: 48小时发货 → Ships within 48h
  {
    pattern: /^(\d+)小时发货$/,
    template: "Ships within $1h",
    type: 'service',
    description: "Shipping time guarantee in hours"
  },

  // X year warranty: 1年质保 → 1-year warranty
  {
    pattern: /^(\d+)年质保$/,
    template: "$1-year warranty",
    type: 'badge',
    description: "Warranty period in years"
  },

  // Minimum order: 2件起批 → MOQ: 2 pieces
  {
    pattern: /^(\d+)件起批$/,
    template: "MOQ: $1 pcs",
    type: 'service',
    description: "Minimum order quantity"
  },

  // Custom processing: 支持定制 → Customization available
  {
    pattern: /^支持定制$/,
    template: "Customization available",
    type: 'service',
    description: "Custom order support"
  },

  // Free shipping: 包邮 → Free shipping
  {
    pattern: /^包邮$/,
    template: "Free shipping",
    type: 'service',
    description: "Free shipping offer"
  },

  // Counterfeit guarantee variations: 假一赔X → Xx counterfeit guarantee
  {
    pattern: /^假一赔(\d+)$/,
    template: "$1x counterfeit guarantee",
    type: 'badge',
    description: "Counterfeit guarantee multiplier"
  },
];

// ═══════════════════════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════════

// Track unknown tags for future additions (session-based)
const unknownTagsLogged = new Set<string>();

/**
 * Translate a single tag or badge using hybrid lookup system
 *
 * Priority order:
 * 1. Exact match in SERVICE_TAG_MAP
 * 2. Exact match in BADGE_MAP
 * 3. Regex pattern match
 * 4. Already English/numeric - pass through
 * 5. Unknown - log and return original
 *
 * @param tag - Chinese tag/badge text
 * @param logUnknown - Whether to log unknown tags (default: true)
 * @returns Translated text or original if no translation found
 */
export function translateTag(tag: string, logUnknown = true): string {
  if (!tag || typeof tag !== 'string') {
    return tag ?? '';
  }

  const trimmedTag = tag.trim();
  if (!trimmedTag) {
    return tag;
  }

  // 1. Exact match in service tags
  if (SERVICE_TAG_MAP[trimmedTag]) {
    return SERVICE_TAG_MAP[trimmedTag];
  }

  // 2. Exact match in badges
  if (BADGE_MAP[trimmedTag]) {
    return BADGE_MAP[trimmedTag];
  }

  // 3. Regex pattern match
  for (const { pattern, template } of TAG_PATTERNS) {
    const match = trimmedTag.match(pattern);
    if (match) {
      // Replace $1, $2, etc. with captured groups
      return template.replace(/\$(\d)/g, (_, index) => {
        const groupIndex = parseInt(index, 10);
        return match[groupIndex] ?? '';
      });
    }
  }

  // 4. Already English/numeric - pass through
  // Allow letters, numbers, spaces, and common symbols
  if (/^[\w\s\d%+\-×.:/]+$/.test(trimmedTag)) {
    return trimmedTag;
  }

  // 5. Unknown - log once per session and return original
  if (logUnknown && !unknownTagsLogged.has(trimmedTag)) {
    unknownTagsLogged.add(trimmedTag);
    console.warn(`[i18n] Unknown tag: "${trimmedTag}" - consider adding to lookup table`);
  }

  return trimmedTag;
}

/**
 * Translate an array of tags
 *
 * @param tags - Array of Chinese tags
 * @param filterUnknown - Remove tags that couldn't be translated (default: false)
 * @returns Array of translated tags
 */
export function translateTags(tags: string[], filterUnknown = false): string[] {
  if (!Array.isArray(tags)) {
    return [];
  }

  const translated = tags.map(tag => translateTag(tag));

  if (filterUnknown) {
    // Filter out tags that remained unchanged (unknown Chinese)
    return translated.filter((t, i) => {
      const original = tags[i];
      // Keep if translated differently, or if it was already English
      return t !== original || /^[\w\s\d%+\-×.:/]+$/.test(original);
    });
  }

  return translated;
}

/**
 * Check if a tag needs translation
 * Useful for filtering or highlighting untranslated content
 *
 * @param tag - Tag to check
 * @returns true if the tag would be translated to something different
 */
export function needsTranslation(tag: string): boolean {
  if (!tag || typeof tag !== 'string') {
    return false;
  }

  const trimmed = tag.trim();

  // Check if it's in any lookup table
  if (SERVICE_TAG_MAP[trimmed] || BADGE_MAP[trimmed]) {
    return true;
  }

  // Check if it matches a pattern
  for (const { pattern } of TAG_PATTERNS) {
    if (pattern.test(trimmed)) {
      return true;
    }
  }

  // Check if it's Chinese (needs translation)
  // Unicode range for common Chinese characters
  return /[\u4e00-\u9fff]/.test(trimmed);
}

/**
 * Get all known translations (useful for documentation/debugging)
 *
 * @returns Object with all known translations grouped by type
 */
export function getAllTranslations(): {
  serviceTags: Record<string, string>;
  badges: Record<string, string>;
  patterns: TagPattern[];
} {
  return {
    serviceTags: { ...SERVICE_TAG_MAP },
    badges: { ...BADGE_MAP },
    patterns: [...TAG_PATTERNS],
  };
}

/**
 * Clear the unknown tags log (useful for testing)
 */
export function clearUnknownTagsLog(): void {
  unknownTagsLogged.clear();
}

/**
 * Get all unknown tags logged in this session
 */
export function getUnknownTags(): string[] {
  return Array.from(unknownTagsLogged);
}
