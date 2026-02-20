
import { validateResults } from '../src/core/validator.js';
import mockData from '../docs/artifacts/validated_results.json' with { type: 'json' };

const { results, search_bundle } = mockData;

// We need to simulate the "Intent" object expected by validator
// The mock data has 'search_bundle' which is close, but let's be precise
const intent = {
  query: search_bundle.original_query,
  context: search_bundle._metadata.context,
  negative_keywords: search_bundle.negative_keywords,
  chinese_query: search_bundle.primary
};

console.log('🧪 Starting Scoring Validation Test...');

// Run Validation
const validated = await validateResults(results, intent);

console.log('\n--- 🔍 Detailed Analysis ---');

// Check Top 5
console.log('\n🏆 Top 5 Ranked Products:');
validated.results.slice(0, 5).forEach((p, i) => {
  console.log(`${i+1}. [${p._confidence}%] ${p.offer_subject} (¥${p.price})`);
  console.log(`   Category: ${p.main_category}`);
});

// Check Suspicious / Price Guard
const suspicious = validated.results.filter(p => p._suspicious);
console.log(`\n🚨 Suspicious Items Identified: ${suspicious.length}`);
suspicious.forEach(p => {
  console.log(`- [${p._confidence}%] ${p.offer_subject} (¥${p.price})`);
  console.log(`  Reason: ${p._suspiciousReason}`);
});

// Check Category Discrimination
// "户外用品" (Outdoor Supplies) vs "电源、储能" (Power, Energy)
const powerItems = validated.results.filter(p => p.main_category.includes('电源') || p.main_category.includes('储能'));
const outdoorItems = validated.results.filter(p => p.main_category === '户外用品');

if (powerItems.length > 0 && outdoorItems.length > 0) {
    const avgPowerScore = powerItems.reduce((sum, p) => sum + p._confidence, 0) / powerItems.length;
    const avgOutdoorScore = outdoorItems.reduce((sum, p) => sum + p._confidence, 0) / outdoorItems.length;

    console.log('\n⚖️  Category Calibration Check:');
    console.log(`   ⚡ Power/Energy Avg Score: ${avgPowerScore.toFixed(1)}%`);
    console.log(`   ⛺ Outdoor Supplies Avg Score: ${avgOutdoorScore.toFixed(1)}%`);

    if (avgPowerScore > avgOutdoorScore) {
        console.log('   ✅ PASS: Technical categories are scoring higher.');
    } else {
        console.log('   ❌ FAIL: Technical categories are NOT scoring higher.');
    }
}
