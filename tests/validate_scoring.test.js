
import { validateResults } from '../src/core/validator.js';
import mockData from '../docs/artifacts/validated_results.json' with { type: 'json' };

const { results, search_bundle } = mockData;

// We need to simulate the "Intent" object expected by validator
const intent = {
  query: search_bundle.original_query,
  context: search_bundle._metadata.context,
  negative_keywords: search_bundle.negative_keywords,
  chinese_query: search_bundle.primary
};

console.log('🧪 Starting Signal-Based Scoring Validation Test...');

// Run Validation
const validated = await validateResults(results, intent);

console.log('\n--- 🔍 Detailed Analysis ---');

// Check Top 5
console.log('\n🏆 Top 5 Ranked Products:');
validated.results.slice(0, 5).forEach((p, i) => {
  console.log(`${i + 1}. [${p._confidence}%] ${p.offer_subject} (¥${p.price})`);
});

// Check Bottom 5
console.log('\n📉 Bottom 5 Ranked Products:');
validated.results.slice(-5).forEach((p, i) => {
  console.log(`${validated.results.length - 4 + i}. [${p._confidence}%] ${p.offer_subject} (¥${p.price})`);
});

// Check Suspicious / Price Guard
const suspicious = validated.results.filter(p => p._suspicious);
console.log(`\n🚨 Suspicious Items Identified: ${suspicious.length}`);
suspicious.forEach(p => {
  console.log(`- [${p._confidence}%] ${p.offer_subject} (¥${p.price})`);
  console.log(`  Reason: ${p._suspiciousReason}`);
});

// Signal-based scoring differentiation test
console.log('\n⚖️  Score Differentiation Check:');
const scores = validated.results.map(p => p._confidence);
const uniqueScores = new Set(scores);
const minScore = Math.min(...scores);
const maxScore = Math.max(...scores);
const spread = maxScore - minScore;

console.log(`   Unique scores: ${uniqueScores.size} (out of ${scores.length} products)`);
console.log(`   Score range: ${minScore}% – ${maxScore}% (spread: ${spread})`);

if (uniqueScores.size >= 3) {
  console.log('   ✅ PASS: Scores are well-differentiated (>= 3 distinct scores).');
} else {
  console.log('   ❌ FAIL: Scores lack differentiation (< 3 distinct scores).');
}

if (spread >= 20) {
  console.log('   ✅ PASS: Score spread >= 20 points.');
} else {
  console.log('   ❌ FAIL: Score spread too narrow (< 20 points).');
}

// High-wattage products should score higher than phone power banks
const highWattage = validated.results.filter(p => {
  const title = (p.offer_subject || '').toLowerCase();
  return /\d{3,}w/.test(title) && parseFloat(p.price) >= 200;
});
const phoneBanks = validated.results.filter(p => {
  const title = (p.offer_subject || '').toLowerCase();
  return title.includes('充电宝') && parseFloat(p.price) < 100;
});

if (highWattage.length > 0 && phoneBanks.length > 0) {
  const avgHW = highWattage.reduce((s, p) => s + p._confidence, 0) / highWattage.length;
  const avgPB = phoneBanks.reduce((s, p) => s + p._confidence, 0) / phoneBanks.length;
  console.log(`\n⚡ High-wattage power stations avg: ${avgHW.toFixed(1)}% (${highWattage.length} products)`);
  console.log(`🔋 Phone power banks avg: ${avgPB.toFixed(1)}% (${phoneBanks.length} products)`);

  if (avgHW > avgPB) {
    console.log('   ✅ PASS: High-wattage products score higher than phone power banks.');
  } else {
    console.log('   ❌ FAIL: High-wattage products should score higher than phone power banks.');
  }
}
