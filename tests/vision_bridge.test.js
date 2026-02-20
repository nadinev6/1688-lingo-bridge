
import 'dotenv/config';
import { validateResults } from '../src/core/validator.js';
import { validateWithVision } from '../src/core/visionValidator.js';
import mockData from '../docs/artifacts/validated_results.json' with { type: 'json' };

async function testVisionBridge() {
  console.log('👁️  Starting Vision Bridge Test...');

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || apiKey === 'sk-...') {
    console.error('❌ OPENAI_API_KEY is missing or invalid in .env');
    process.exit(1);
  } else {
    console.log('✅ OpenAI API Key detected');
  }

  // 1. Prepare Intent & Data (Using mock data from validated_results.json)
  const { results, search_bundle } = mockData;
  const intent = {
    query: search_bundle.original_query,
    context: search_bundle._metadata.context,
    negative_keywords: search_bundle.negative_keywords,
    chinese_query: search_bundle.primary
  };

  console.log(`original query: ${intent.query}`);
  console.log(`chinese query: ${intent.chinese_query}`);

  // 2. Run Text Validation First (to simulate the pipeline)
  // This uses the NEW scoring logic we just fixed
  const validated = await validateResults(results, intent);

  // 3. Filter for candidates that would actually be sent to Vision
  // In production, we filter by >= 70% confidence.
  // We'll take top 3 regardless of score for this test if < 70, just to prove it works
  let candidates = validated.results
    .filter(p => p._confidence >= 70)
    .slice(0, 3);

    if (candidates.length === 0) {
        console.log('⚠️ No candidates >= 70%, taking top 3 regardless for test purposes.');
        candidates = validated.results.slice(0, 3);
    }

  console.log(`\n📋 Selected ${candidates.length} candidates for Vision API Check:`);
  candidates.forEach(c => console.log(`   - [${c._confidence}%] ${c.offer_subject} \n     Image: ${c.offer_pic_url}`));

  // 4. Run Vision Validation
  console.log('\n🚀 Sending images to GPT-4o-mini for Visual Analysis...');
  const startTime = Date.now();

  // Call the actual vision validator
  const visionResponse = await validateWithVision(candidates, intent);
  const visionResults = visionResponse.results || [];

  const duration = Date.now() - startTime;
  console.log(`\n⏱️  Vision Analysis Complete in ${duration}ms`);

  // 5. Display Results
  console.log('\n📊 VISION RESULTS:');
  visionResults.forEach(p => {
    // _vision_confidence might be undefined if API failed or skipped
    const score = p._vision_confidence || 0;
    const status = score >= 80 ? '✅ MATCH' : score > 0 ? '❌ MISMATCH' : '⚠️ ERROR';

    console.log(`${status} [${score}%] ${p.offer_subject}`);
    if (p._vision_reason) console.log(`   📝 Reasoning: ${p._vision_reason}`);
  });
}

testVisionBridge().catch(err => {
    console.error('Test Failed:', err);
});
