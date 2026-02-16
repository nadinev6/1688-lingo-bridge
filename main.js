import { LingoDotDevEngine } from "lingo.dev/sdk";
import { readFile, writeFile } from 'fs/promises'; // To read sample data and save localised results
import 'dotenv/config';

// 1. Initialise Lingo.dev Client
const lingo = new LingoDotDevEngine({ apiKey: process.env.LINGODOTDEV_API_KEY });

async function translate1688Data() {
    try {
        console.log("🚀 Starting 1688 Global Bridge...");

        // 2. Read data from local sample_data.json
        const rawData = await readFile('./sample_data.json', 'utf-8');
        const rawChineseData = JSON.parse(rawData);

        if (rawChineseData.length === 0) {
            console.log("⚠️ No data found in sample_data.json. Please check the file.");
            return;
        }

        console.log(`📦 Fetched ${rawChineseData.length} products. Starting localisation...`);

        // 3. Localise each product individually
        // This approach is more robust: better error handling, progress tracking, and avoids token limits
        const translatedData = await Promise.all(
            rawChineseData.map(async (product, index) => {
                const translated = await lingo.localizeObject(product, {
                    sourceLocale: "zh-CN",
                    targetLocale: "en-GB",
                });
                console.log(`  ✓ Translated product ${index + 1}/${rawChineseData.length}: ${translated.offer_subject?.substring(0, 30) || 'Unknown'}...`);
                return translated;
            })
        );

        // 4. Persistence: Save the clean English data locally
        // This creates a file you can use for your demo/frontend
        const outputPath = './localized_products.json';
        await writeFile(outputPath, JSON.stringify(translatedData, null, 2));

            console.log(`✅ Success! Localised data saved to: ${outputPath}`);
        console.log("All Localised Products:", JSON.stringify(translatedData, null, 2));

            // Count how many products we got per category to show data diversity
            const categories = translatedData.reduce((acc, item) => {
                const cat = item.categoryName || "Uncategorised";
                acc[cat] = (acc[cat] || 0) + 1;
                return acc;
            }, {});

            console.log("📊 Translation Diversity Report:", categories);
    } catch (error) {
        console.error("❌ An error occurred during the pipeline:", error.message);
    }
}

translate1688Data();
