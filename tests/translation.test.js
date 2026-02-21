/**
 * Unit Tests for Hybrid Translation Lookup System
 * @module tests/translation.test
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  translateTag,
  translateTags,
  needsTranslation,
  getAllTranslations,
  clearUnknownTagsLog,
  getUnknownTags,
  SERVICE_TAG_MAP,
  BADGE_MAP,
  TAG_PATTERNS,
} from '../src/data/translations';

describe('translateTag', () => {
  beforeEach(() => {
    clearUnknownTagsLog();
  });

  describe('Service Tags', () => {
    test('translates "退货包运费" to "Free return shipping"', () => {
      expect(translateTag('退货包运费')).toBe('Free return shipping');
    });

    test('translates "先采后付" to "Buy now, pay later"', () => {
      expect(translateTag('先采后付')).toBe('Buy now, pay later');
    });

    test('translates "7天无理由" to "7-day no-reason returns"', () => {
      expect(translateTag('7天无理由')).toBe('7-day no-reason returns');
    });

    test('translates "24小时发货" to "Ships within 24h"', () => {
      expect(translateTag('24小时发货')).toBe('Ships within 24h');
    });

    test('translates "现货" to "In stock"', () => {
      expect(translateTag('现货')).toBe('In stock');
    });
  });

  describe('Badges', () => {
    test('translates "运费险" to "Shipping insurance"', () => {
      expect(translateTag('运费险')).toBe('Shipping insurance');
    });

    test('translates "深度验商" to "Verified supplier"', () => {
      expect(translateTag('深度验商')).toBe('Verified supplier');
    });

    test('translates "深度验厂" to "Verified factory"', () => {
      expect(translateTag('深度验厂')).toBe('Verified factory');
    });

    test('translates "假一赔四" to "4x counterfeit guarantee"', () => {
      expect(translateTag('假一赔四')).toBe('4x counterfeit guarantee');
    });

    test('translates "金牌供应商" to "Gold medal supplier"', () => {
      expect(translateTag('金牌供应商')).toBe('Gold medal supplier');
    });
  });

  describe('Regex Patterns', () => {
    test('translates "回头率40%" to "Repurchase rate: 40%"', () => {
      expect(translateTag('回头率40%')).toBe('Repurchase rate: 40%');
    });

    test('translates "回头率35" to "Repurchase rate: 35"', () => {
      expect(translateTag('回头率35')).toBe('Repurchase rate: 35');
    });

    test('translates "15天无理由" to "15-day no-reason returns"', () => {
      expect(translateTag('15天无理由')).toBe('15-day no-reason returns');
    });

    test('translates "72小时发货" to "Ships within 72h"', () => {
      expect(translateTag('72小时发货')).toBe('Ships within 72h');
    });

    test('translates "2件起批" to "MOQ: 2 pcs"', () => {
      expect(translateTag('2件起批')).toBe('MOQ: 2 pcs');
    });

    test('translates "假一赔十" to "10x counterfeit guarantee"', () => {
      expect(translateTag('假一赔十')).toBe('10x counterfeit guarantee');
    });
  });

  describe('English/Numeric Pass-through', () => {
    test('passes through English text unchanged', () => {
      expect(translateTag('ISO9001')).toBe('ISO9001');
    });

    test('passes through numeric values unchanged', () => {
      expect(translateTag('24/7')).toBe('24/7');
    });

    test('passes through mixed alphanumeric unchanged', () => {
      expect(translateTag('48V')).toBe('48V');
    });

    test('passes through percentages unchanged', () => {
      expect(translateTag('99.9%')).toBe('99.9%');
    });
  });

  describe('Unknown Tags', () => {
    test('returns original text for unknown Chinese tags', () => {
      const unknown = '未知标签';
      expect(translateTag(unknown, false)).toBe(unknown);
    });

    test('logs unknown tags when logUnknown is true', () => {
      translateTag('未知标签', true);
      expect(getUnknownTags()).toContain('未知标签');
    });

    test('does not log unknown tags when logUnknown is false', () => {
      translateTag('未知标签', false);
      expect(getUnknownTags()).not.toContain('未知标签');
    });

    test('logs each unknown tag only once per session', () => {
      translateTag('未知标签A', true);
      translateTag('未知标签A', true);
      expect(getUnknownTags().filter(t => t === '未知标签A')).toHaveLength(1);
    });
  });

  describe('Edge Cases', () => {
    test('handles empty string', () => {
      expect(translateTag('')).toBe('');
    });

    test('handles null - returns empty string', () => {
      expect(translateTag(null)).toBe('');
    });

    test('handles undefined - returns empty string', () => {
      expect(translateTag(undefined)).toBe('');
    });

    test('handles whitespace-only string', () => {
      expect(translateTag('   ')).toBe('   ');
    });

    test('trims whitespace from tags', () => {
      expect(translateTag('  退货包运费  ')).toBe('Free return shipping');
    });
  });
});

describe('translateTags', () => {
  beforeEach(() => {
    clearUnknownTagsLog();
  });

  test('translates array of tags', () => {
    const tags = ['退货包运费', '运费险', '24小时发货'];
    const expected = ['Free return shipping', 'Shipping insurance', 'Ships within 24h'];
    expect(translateTags(tags)).toEqual(expected);
  });

  test('handles empty array', () => {
    expect(translateTags([])).toEqual([]);
  });

  test('handles null input', () => {
    expect(translateTags(null)).toEqual([]);
  });

  test('handles undefined input', () => {
    expect(translateTags(undefined)).toEqual([]);
  });

  test('filters unknown Chinese when filterUnknown is true', () => {
    const tags = ['退货包运费', '未知标签', 'ISO9001'];
    const result = translateTags(tags, true);
    expect(result).toContain('Free return shipping');
    expect(result).toContain('ISO9001');
    expect(result).not.toContain('未知标签');
  });

  test('keeps unknown Chinese when filterUnknown is false', () => {
    const tags = ['退货包运费', '未知标签'];
    const result = translateTags(tags, false);
    expect(result).toContain('Free return shipping');
    expect(result).toContain('未知标签');
  });
});

describe('needsTranslation', () => {
  test('returns true for Chinese service tags', () => {
    expect(needsTranslation('退货包运费')).toBe(true);
  });

  test('returns true for Chinese badges', () => {
    expect(needsTranslation('运费险')).toBe(true);
  });

  test('returns true for pattern-matched tags', () => {
    expect(needsTranslation('回头率40%')).toBe(true);
  });

  test('returns true for Chinese text', () => {
    expect(needsTranslation('中文文本')).toBe(true);
  });

  test('returns false for English text', () => {
    expect(needsTranslation('ISO9001')).toBe(false);
  });

  test('returns false for numeric text', () => {
    expect(needsTranslation('24/7')).toBe(false);
  });

  test('returns false for empty string', () => {
    expect(needsTranslation('')).toBe(false);
  });

  test('returns false for null', () => {
    expect(needsTranslation(null)).toBe(false);
  });
});

describe('getAllTranslations', () => {
  test('returns service tags object', () => {
    const { serviceTags } = getAllTranslations();
    expect(serviceTags).toBeDefined();
    expect(serviceTags['退货包运费']).toBe('Free return shipping');
  });

  test('returns badges object', () => {
    const { badges } = getAllTranslations();
    expect(badges).toBeDefined();
    expect(badges['运费险']).toBe('Shipping insurance');
  });

  test('returns patterns array', () => {
    const { patterns } = getAllTranslations();
    expect(patterns).toBeDefined();
    expect(patterns.length).toBeGreaterThan(0);
  });

  test('returns copies, not references', () => {
    const { serviceTags } = getAllTranslations();
    serviceTags['test'] = 'test value';
    expect(SERVICE_TAG_MAP['test']).toBeUndefined();
  });
});

describe('clearUnknownTagsLog', () => {
  beforeEach(() => {
    clearUnknownTagsLog();
  });

  test('clears logged unknown tags', () => {
    translateTag('未知标签A', true);
    translateTag('未知标签B', true);
    expect(getUnknownTags().length).toBe(2);

    clearUnknownTagsLog();
    expect(getUnknownTags().length).toBe(0);
  });
});

describe('Lookup Table Completeness', () => {
  test('SERVICE_TAG_MAP has expected number of entries', () => {
    const entryCount = Object.keys(SERVICE_TAG_MAP).length;
    expect(entryCount).toBeGreaterThanOrEqual(15);
  });

  test('BADGE_MAP has expected number of entries', () => {
    const entryCount = Object.keys(BADGE_MAP).length;
    expect(entryCount).toBeGreaterThanOrEqual(10);
  });

  test('TAG_PATTERNS has expected number of patterns', () => {
    expect(TAG_PATTERNS.length).toBeGreaterThanOrEqual(5);
  });

  test('all SERVICE_TAG_MAP values are non-empty strings', () => {
    Object.values(SERVICE_TAG_MAP).forEach(translation => {
      expect(typeof translation).toBe('string');
      expect(translation.length).toBeGreaterThan(0);
    });
  });

  test('all BADGE_MAP values are non-empty strings', () => {
    Object.values(BADGE_MAP).forEach(translation => {
      expect(typeof translation).toBe('string');
      expect(translation.length).toBeGreaterThan(0);
    });
  });
});
