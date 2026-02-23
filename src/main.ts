import Papa from 'papaparse';
import type { ProcurementItem, PipelineData, ConfidenceFilter, SortMode, RawProduct, SearchBundle } from './types';
import { translateTags, translateBundleTag, translateStaticText } from './data/translations';

// Dynamic data loading - fetch at runtime instead of static import
let data: PipelineData = { pipeline_summary: {} as any, search_bundle: {} as any, results: [], metadata: {} as any };
let allItems: ProcurementItem[] = [];

// Fetch pipeline data from JSON file
async function loadPipelineData(): Promise<void> {
    try {
        const response = await fetch('/validated_results.json');
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const jsonData = await response.json();

        // Handle both array and single object formats
        const pipelineArray = Array.isArray(jsonData) ? jsonData : [jsonData];

        // Merge all results, summaries, and bundles from all pipelines
        let mergedResults: RawProduct[] = [];
        let mergedMetadata = pipelineArray[0]?.metadata || {};

        // Combine all primary queries, synonyms, and negative keywords
        const allPrimaries: string[] = [];
        const allSynonyms: string[] = [];
        const allNegatives: string[] = [];
        const allOriginalQueries: string[] = [];
        const allChineseQueries: string[] = [];

        // Initialize summary accumulators
        let totalResults = 0;
        let totalHighConfidence = 0;
        let totalLatency = 0;
        const mergedBundles: Record<string, SearchBundle> = {};

        for (const pipeline of pipelineArray) {
            // Merge results
            if (pipeline.results?.length) {
                mergedResults = mergedResults.concat(pipeline.results);
            }

            // Merge search bundles
            if (pipeline.search_bundles) {
                Object.assign(mergedBundles, pipeline.search_bundles);
            }
            if (pipeline.search_bundle) {
                const q = pipeline.search_bundle.original_query || pipeline.search_bundle.primary;
                if (q) mergedBundles[q] = pipeline.search_bundle;
            }

            if (pipeline.search_bundle) {
                if (pipeline.search_bundle.primary) allPrimaries.push(pipeline.search_bundle.primary);
                if (pipeline.search_bundle.original_query) allOriginalQueries.push(pipeline.search_bundle.original_query);
                if (pipeline.search_bundle.synonyms?.length) {
                    allSynonyms.push(...pipeline.search_bundle.synonyms);
                }
                if (pipeline.search_bundle.negative_keywords?.length) {
                    allNegatives.push(...pipeline.search_bundle.negative_keywords);
                }
            }
            // Accumulate summary stats from all pipelines
            if (pipeline.pipeline_summary) {
                if (pipeline.pipeline_summary.original_query) {
                    allOriginalQueries.push(pipeline.pipeline_summary.original_query);
                }
                if (pipeline.pipeline_summary.chinese_query) {
                    allChineseQueries.push(pipeline.pipeline_summary.chinese_query);
                }
                totalResults += pipeline.pipeline_summary.total_results || 0;
                totalHighConfidence += pipeline.pipeline_summary.high_confidence_count || 0;
                totalLatency += pipeline.pipeline_summary.total_latency_ms || 0;
            }
        }

        // Create merged summary from first pipeline as template, then update totals
        const mergedSummary = {
            ...pipelineArray[0]?.pipeline_summary,
            original_query: [...new Set(allOriginalQueries)].join(' + '),
            chinese_query: [...new Set(allChineseQueries)].join(' + '),
            total_results: totalResults,
            high_confidence_count: totalHighConfidence,
            total_latency_ms: totalLatency,
        };

        // Combine search bundle from all pipelines
        const mergedBundle = {
            ...pipelineArray[0]?.search_bundle,
            primary: [...new Set(allPrimaries)].join(' + '),
            original_query: [...new Set(allOriginalQueries)].join(' + '),
            synonyms: [...new Set(allSynonyms)], // Remove duplicates
            negative_keywords: [...new Set(allNegatives)]
        };

        data = {
            pipeline_summary: mergedSummary,
            search_bundle: mergedBundle,
            search_bundles: mergedBundles,
            results: mergedResults,
            metadata: mergedMetadata
        } as PipelineData;

        allItems = deduplicateItems(data.results.map((raw, i) => mapRawToItem(raw, i)));
        console.log(`✅ Loaded ${allItems.length} products from validated_results.json`);
    } catch (error) {
        console.error('❌ Failed to load pipeline data:', error);
        // Show error in UI
        const cardGrid = document.getElementById('cardGrid');
        if (cardGrid) {
            cardGrid.innerHTML = `<div class="col-span-full text-center py-12 text-red-500">
                <p>Failed to load data. Make sure validated_results.json exists.</p>
                <p class="text-sm text-slate-400 mt-2">Run: node main.js phase4 "your query"</p>
            </div>`;
        }
    }
}

// ─── DOM Elements ─────────────────────────────────────────────────────────────
const searchInput = document.getElementById('procurementSearch') as HTMLInputElement;
const clearBtn = document.getElementById('clearSearch') as HTMLButtonElement;
const noResultsMsg = document.getElementById('noResults') as HTMLDivElement;
const cardGrid = document.getElementById('cardGrid') as HTMLElement;
const exportBtn = document.getElementById('exportBtn') as HTMLButtonElement;
const howItWorksToggle = document.getElementById('howItWorksToggle') as HTMLButtonElement;
const howItWorksPanel = document.getElementById('how-it-works') as HTMLDivElement;
const totalBadge = document.getElementById('totalBadge') as HTMLSpanElement;
const originalQueryEl = document.getElementById('originalQuery') as HTMLSpanElement;
const chineseQueryEl = document.getElementById('chineseQuery') as HTMLSpanElement;
const statTotal = document.getElementById('statTotal') as HTMLElement | null;
const statAvgConf = document.getElementById('statAvgConf') as HTMLElement | null;
const statHighConf = document.getElementById('statHighConf') as HTMLElement | null;
const statLatency = document.getElementById('statLatency') as HTMLElement | null;
const synonymTagsEl = document.getElementById('synonymTags') as HTMLDivElement;

// ─── State ────────────────────────────────────────────────────────────────────
let currentFilter: ConfidenceFilter = 'all';
let currentSort: SortMode = 'confidence';
let currentSearch = '';
let currentLanguage: 'cn' | 'en' = 'cn';
let currentPage = 1;
const itemsPerPage = 10;

// ─── Helpers ──────────────────────────────────────────────────────────────────
function parsePriceCny(priceStr: string): number {
    const match = priceStr.match(/[\d.]+/);
    return match ? parseFloat(match[0]) : 0;
}

function cnyToUsd(cny: number): number {
    return parseFloat((cny * 0.14).toFixed(2));
}

function mapFactoryLevel(level: string): { label: string; cssClass: string } {
    if (level.includes('金')) return { label: 'Gold Factory', cssClass: 'badge-gold' };
    if (level.includes('银')) return { label: 'Silver Factory', cssClass: 'badge-silver' };
    if (level.includes('铜')) return { label: 'Bronze Factory', cssClass: 'badge-bronze' };
    return { label: level, cssClass: 'bg-slate-200 text-slate-600' };
}

function mapConfidence(score: number, hasVisionMismatch: boolean): ProcurementItem['confidence'] {
    if (hasVisionMismatch) return 'Mismatch';
    if (score >= 70) return 'High';
    return 'Low';
}

function confidenceBadgeClass(conf: ProcurementItem['confidence']): string {
    if (conf === 'High') return 'confidence-high';
    if (conf === 'Mismatch') return 'confidence-mismatch';
    return 'confidence-low';
}

function extractSpecTags(title: string): string[] {
    // Regex to match numerical specs: patterns like "48V", "55HRC", "99.9%", etc.
    // Matches: digits followed by 1-4 letters/symbols, or number+unit combinations
    const specPattern = /(\d+(?:\.\d+)?(?:[A-Z%a-z]{1,4}|\s*[A-Z]{1,3}))/g;
    const matches = title.match(specPattern) || [];

    // Filter out common words and keep only meaningful specs
    const filtered = matches
        .map(s => s.trim())
        .filter(s => s.length > 1 && !/^(an|as|at|by|is|or|to|of|in|cm|mm|for)$/i.test(s))
        .slice(0, 5); // Limit to 5 specs

    return [...new Set(filtered)]; // Remove duplicates
}

// ─── Extract and Translate Service Tags from Title ─────────────────────────────
// Known Chinese service tag patterns to extract from product titles
const SERVICE_TAG_PATTERNS_IN_TITLE = [
    /退货包运费/g,           // Free return shipping
    /先采后付/g,             // Buy now, pay later
    /\d+天无理由/g,          // X-day no-reason returns
    /\d+小时发货/g,          // Ships within X hours
    /包邮/g,                 // Free shipping
    /现货/g,                 // In stock
    /支持定制/g,             // Customization available
    /回头率\d+%?/g,          // Repurchase rate
];

function extractAndTranslateServiceTags(title: string): string[] {
    const foundTags: string[] = [];

    for (const pattern of SERVICE_TAG_PATTERNS_IN_TITLE) {
        const matches = title.match(pattern);
        if (matches) {
            foundTags.push(...matches);
        }
    }

    // Translate all found tags using the hybrid lookup system
    return translateTags(foundTags);
}


// ─── Map Raw Product to Procurement Item ──────────────────────────────────────
function mapRawToItem(raw: RawProduct, index: number): ProcurementItem {
    const title = raw.title || raw.offer_subject || '';
    const price = raw.price || parsePriceCny(raw.offer_price || '0');
    const imageUrl = raw.image_url || raw.offer_pic_url || '';
    const detailUrl = raw.detail_url || raw.offer_detail_url || '';
    const companyName = raw.shop_name || raw.company_name || '';
    const confidence = raw._confidence || 0;
    const hasVisionMismatch = raw._visionMatch === false;

    return {
        id: `item-${index}-${raw.offer_id || Date.now()}`,
        title: title,
        chineseTitle: title,
        price: price,
        imageUrl: imageUrl,
        isFlagged: raw._blacklisted || false,
        systemNote: raw._blacklistReason || raw._mismatchReason || '',
        confidence: mapConfidence(confidence, hasVisionMismatch),
        visionVerified: raw._visionMatch === true,
        specStatus: `${confidence}% Match`,
        scoreBreakdown: raw._scoreBreakdown,
        detailUrl: detailUrl,
        companyName: companyName,
        factoryLevel: raw.factory_level || '',
        province: raw.province || '',
        city: raw.city || '',
        searchQuery: raw._search_query || raw.query || '',
        specTags: extractSpecTags(title),
        productSpecs: raw.product_specs,
        serviceTags: raw.service_tags ? translateTags(raw.service_tags) : undefined,
        visionConfidence: raw._visualConfidence ?? null,
        blacklisted: raw._blacklisted,
        blacklistReason: raw._blacklistReason,
        _en: raw._en,
    };
}

// ─── Deduplicate by detailUrl ────────────────────────────────────────────────
function deduplicateItems(items: ProcurementItem[]): ProcurementItem[] {
    const seen = new Set<string>();
    return items.filter(item => {
        const key = item.detailUrl ? item.detailUrl : `${item.title}|${item.companyName}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

// ─── Create Score Tooltip HTML ───────────────────────────────────────────────
function createScoreTooltip(item: ProcurementItem): string {
    const score = parseInt(item.specStatus.match(/\d+/) ? item.specStatus.match(/\d+/)![0] : '0');
    const visionScore = item.visionConfidence !== undefined && item.visionConfidence !== null
        ? Math.round(item.visionConfidence)
        : null;

    const breakdown = item.scoreBreakdown;

    // No real breakdown data — show honest "legacy" tooltip
    if (!breakdown) {
        return `
            <div class="score-tooltip-content">
                <div class="score-header">
                    <span class="score-label">Confidence Score</span>
                    <span class="score-value">${score}%</span>
                </div>
                ${visionScore !== null ? `
                    <div class="vision-row">
                        <span class="vision-label">Visual Confidence</span>
                        <span class="vision-value">${visionScore}%</span>
                    </div>
                ` : ''}
                <div class="signals-section">
                    <div class="signals-title" style="opacity:0.6;">Signal Breakdown</div>
                    <div class="signal-item" style="opacity:0.5; font-style:italic;">
                        No detailed breakdown available for this product.<br/>
                        Re-run the pipeline to generate full signal analysis.
                    </div>
                </div>
            </div>
        `;
    }

    // Real breakdown exists — show all relevant signal groups
    const signalGroups: { label: string; type: string; items: string[] }[] = [];

    if (breakdown.positiveKeywords.length > 0) {
        signalGroups.push({ label: 'Keyword Match', type: 'positive', items: breakdown.positiveKeywords });
    }
    if (breakdown.moderateKeywords.length > 0) {
        signalGroups.push({ label: 'Partial Match', type: 'neutral', items: breakdown.moderateKeywords });
    }
    if (breakdown.specMatches.length > 0) {
        signalGroups.push({ label: 'Spec / Vision', type: 'positive', items: breakdown.specMatches });
    }
    if (breakdown.priceSignals.length > 0) {
        const isPriceConcern = breakdown.priceSignals.some(s => s.includes('concern') || s.includes('anomaly'));
        signalGroups.push({ label: 'Price', type: isPriceConcern ? 'warning' : 'positive', items: breakdown.priceSignals });
    }
    if (breakdown.negativeKeywords.length > 0) {
        signalGroups.push({ label: 'Mismatch', type: 'negative', items: breakdown.negativeKeywords });
    }
    if (breakdown.weakKeywords && breakdown.weakKeywords.length > 0) {
        signalGroups.push({ label: 'Weak Match', type: 'neutral', items: breakdown.weakKeywords });
    }
    if (breakdown.suspiciousFlags.length > 0) {
        signalGroups.push({ label: 'Flags', type: 'warning', items: breakdown.suspiciousFlags });
    }

    const iconMap: Record<string, string> = { positive: '+', negative: '−', warning: '⚠️', neutral: '~' };
    const signalsList = signalGroups.map(g => {
        const items = g.items.slice(0, 4).join(', ') + (g.items.length > 4 ? ` +${g.items.length - 4} more` : '');
        return `<div class="signal-item ${g.type}">
            <span style="opacity:0.6; font-size:9px; min-width:14px; display:inline-block;">${iconMap[g.type]}</span>
            <strong>${g.label}:</strong>
            <span style="margin-left:4px;">${items}</span>
        </div>`;
    }).join('');

    return `
        <div class="score-tooltip-content">
            <div class="score-header">
                <span class="score-label">Confidence Score</span>
                <span class="score-value">${score}%</span>
            </div>
            ${visionScore !== null ? `
                <div class="vision-row">
                    <span class="vision-label">Visual Confidence</span>
                    <span class="vision-value">${visionScore}%</span>
                </div>
            ` : ''}
            <div class="signals-section">
                <div class="signals-title">Contributing Signals:</div>
                ${signalGroups.length > 0
                    ? signalsList
                    : '<div class="signal-item" style="opacity:0.5;">Pipeline returned no signal details</div>'}
            </div>
            ${breakdown.reason ? `
                <div class="reason-section">
                    <div class="reason-text">${breakdown.reason}</div>
                </div>
            ` : ''}
        </div>
    `;
}

// ─── All items from pipeline data ────────────────────────────────────────────
// allItems is now populated dynamically in loadPipelineData()

// ─── Populate Pipeline Summary ───────────────────────────────────────────────
function populateSummary(items: ProcurementItem[] = allItems): void {
    const s = data.pipeline_summary;

    // Translate all elements with data-i18n attribute
    document.querySelectorAll('[data-i18n]').forEach(el => {
        const key = (el as HTMLElement).dataset.i18n || '';
        if (key) el.textContent = translateStaticText(key, currentLanguage);
    });

    // Show current search term if active, otherwise show pipeline queries
    if (currentSearch) {
        if (originalQueryEl) originalQueryEl.textContent = currentLanguage === 'en' ? (translateBundleTag(currentSearch) || currentSearch) : currentSearch;
        if (chineseQueryEl) chineseQueryEl.textContent = `(Searching: ${currentSearch})`;
    } else {
        if (originalQueryEl) {
            const display = currentLanguage === 'en' ? (translateBundleTag(s.original_query) || s.original_query) : s.original_query;
            originalQueryEl.textContent = display;
        }
        if (chineseQueryEl) chineseQueryEl.textContent = s.chinese_query;
    }

    if (statLatency) statLatency.textContent = `${(s.total_latency_ms / 1000).toFixed(1)}s`;

    // Calculate dynamic stats from filtered items
    const total = items.length;

    // Parse confidence from "85% CONF" string
    const totalScore = items.reduce((sum, item) => {
        const match = item.specStatus.match(/(\d+)%/);
        return sum + (match ? parseInt(match[1]) : 0);
    }, 0);

    const avg = total > 0 ? Math.round(totalScore / total) : 0;
    const highCount = items.filter(i => i.confidence === 'High').length;

    if (statTotal) statTotal.textContent = String(total);
    if (statAvgConf) statAvgConf.textContent = `${avg}%`;
    if (statHighConf) statHighConf.textContent = String(highCount);
    if (totalBadge) totalBadge.textContent = `${total} suppliers`;
}

// ─── Populate Synonym Tags ────────────────────────────────────────────────────
function populateSynonymTags(): void {
    // Try to find a bundle matching the current search query or part of it
    let bundle = data.search_bundle;
    const searchBundles = data.search_bundles || {};

    if (currentSearch) {
        const sLower = currentSearch.toLowerCase();
        // Match by Chinese key OR by English original_query
        const matchKey = Object.keys(searchBundles).find(k => {
            const b = searchBundles[k];
            return k.toLowerCase().includes(sLower) ||
                sLower.includes(k.toLowerCase()) ||
                b.original_query?.toLowerCase().includes(sLower) ||
                sLower.includes(b.original_query?.toLowerCase() || '');
        });
        if (matchKey) {
            bundle = searchBundles[matchKey];
        }
    }

    if (!bundle) return;

    const tags: { text: string; type: 'primary' | 'synonym' | 'negative'; originalText: string }[] = [
        { text: bundle.primary, type: 'primary', originalText: bundle.primary },
        ...bundle.synonyms.map(s => ({ text: s, type: 'synonym' as const, originalText: s })),
        ...bundle.negative_keywords.slice(0, 4).map(k => ({ text: `-${k}`, type: 'negative' as const, originalText: k })),
    ];

    synonymTagsEl.innerHTML = tags.map(tag => {
        const base = 'px-3 py-1 rounded-full text-[11px] font-bold border font-mono cursor-pointer hover:opacity-80 transition-opacity';
        const displayText = currentLanguage === 'en' ? translateBundleTag(tag.text) : tag.text;

        if (tag.type === 'primary') {
            return `<span class="${base} bg-[#1a1d23] text-white border-[#1a1d23]" title="Primary Chinese query" data-query="${tag.originalText}">${displayText}</span>`;
        }
        if (tag.type === 'synonym') {
            return `<span class="${base} bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100" title="Synonym expansion - click to search" data-query="${tag.originalText}">${displayText}</span>`;
        }
        return `<span class="${base} bg-red-50 text-red-600 border-red-200 hover:bg-red-100" title="Negative keyword" data-query="${tag.originalText}">${displayText}</span>`;
    }).join('');

    // Add event listeners to synonym tags
    synonymTagsEl.querySelectorAll('span').forEach(tag => {
        tag.addEventListener('click', () => {
            const query = (tag as HTMLElement).dataset.query || '';
            if (query && searchInput) {
                searchInput.value = query;
                currentSearch = query;
                clearBtn?.classList.remove('hidden');
                renderDashboard();
            }
        });
    });
}

// ─── Render Dashboard ─────────────────────────────────────────────────────────
function renderDashboard(): void {
    let filtered = allItems.filter(item => {
        const query = currentSearch.trim();

        // For empty search, match all
        if (!query) return true;

        // Search in: title, company name, category, and search query
        const searchableText = [
            item.title,
            item.chineseTitle,
            item.companyName || '',
            item.searchQuery || '',
            item.factoryLevel || ''
        ].join(' ');

        // Case-insensitive search that works with Chinese characters
        const matchesSearch = searchableText.includes(query) ||
            searchableText.toLowerCase().includes(query.toLowerCase());

        const matchesFilter =
            currentFilter === 'all' ||
            (currentFilter === 'high' && item.confidence === 'High') ||
            (currentFilter === 'low' && (item.confidence === 'Low' || item.confidence === 'Mismatch'));

        return matchesSearch && matchesFilter;
    });

    if (currentSort === 'confidence') {
        const order = { 'High': 0, 'Low': 1, 'Mismatch': 2 };
        filtered.sort((a, b) => order[a.confidence] - order[b.confidence]);
    } else if (currentSort === 'price-asc') {
        filtered.sort((a, b) => a.price - b.price);
    } else if (currentSort === 'price-desc') {
        filtered.sort((a, b) => b.price - a.price);
    }

    noResultsMsg.classList.toggle('hidden', filtered.length > 0);

    // Update dynamic stats
    populateSummary(filtered);

    // Calculate Pagination
    const totalPages = Math.ceil(filtered.length / itemsPerPage) || 1;
    if (currentPage > totalPages) currentPage = totalPages;

    const pageIndicator = document.getElementById('pageIndicator');
    const prevPageBtn = document.getElementById('prevPageBtn') as HTMLButtonElement | null;
    const nextPageBtn = document.getElementById('nextPageBtn') as HTMLButtonElement | null;
    const paginationControls = document.getElementById('paginationControls');

    if (paginationControls) {
        paginationControls.classList.toggle('hidden', filtered.length <= itemsPerPage);
    }
    if (pageIndicator) {
        pageIndicator.textContent = `Page ${currentPage} of ${totalPages}`;
    }
    if (prevPageBtn && nextPageBtn) {
        prevPageBtn.disabled = currentPage === 1;
        nextPageBtn.disabled = currentPage === totalPages;
    }

    const paginatedItems = filtered.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

    cardGrid.innerHTML = paginatedItems.map(item => {
        const factory = item.factoryLevel ? mapFactoryLevel(item.factoryLevel) : null;
        const confClass = confidenceBadgeClass(item.confidence);
        const location = [item.city, item.province].filter(Boolean).join(', ');

        return `
        <div class="hybrid-card p-6 ${item.isFlagged ? 'flagged' : ''} group">
            <div class="img-container relative">
                <img src="${item.imageUrl}" alt="${item.title}" loading="lazy" onerror="this.src='./src/components/bridge.svg'" />
                <div class="absolute top-2 right-2 flex gap-1">
                    <span class="score-tooltip-trigger px-2 py-0.5 text-[9px] font-black uppercase rounded-full ${confClass} cursor-help" style="white-space:nowrap" title="Click for score breakdown">
                        ${item.confidence === 'High' ? 'HIGH CONF' : item.confidence === 'Mismatch' ? 'MISMATCH' : 'LOW CONF'}
                        <div class="score-tooltip hidden">
                            ${createScoreTooltip(item)}
                        </div>
                    </span>
                </div>
                ${item.visionVerified ? `
                    <div class="vision-guard absolute bottom-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity duration-300" title="Verified by GPT-4o-mini">
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#4f46e5" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="vision-eye-icon">
                            <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/>
                            <circle cx="12" cy="12" r="3"/>
                        </svg>
                    </div>
                ` : ''}
            </div>

            <div class="flex justify-between items-start mb-2">
                <div class="flex flex-col gap-1">
                    ${factory ? `<span class="px-2 py-0.5 text-[10px] font-black uppercase rounded-full ${factory.cssClass}" style="width:fit-content">${factory.label}</span>` : ''}
                    ${location ? `<span class="text-[10px] text-slate-400 font-medium">${location}</span>` : ''}
                </div>
            </div>

            ${item.specTags.length > 0 ? `
                <div class="flex flex-wrap gap-1 mb-3">
                    ${item.specTags.map(tag => `<span class="inline-flex items-center px-2 py-0.5 text-[9px] font-bold bg-blue-50 text-blue-700 border border-blue-200 rounded-full uppercase tracking-tight">${tag}</span>`).join('')}
                </div>
            ` : ''}

            ${item.systemNote ? `
                <div class="bg-slate-50 border-l-4 border-slate-300 p-3 text-[11px] text-slate-600 mb-3">
                    System Note: Semantic Drift detected. ${item.systemNote}
                </div>
            ` : ''}

            <div class="flex items-center gap-2 mb-2">
                ${item.visionVerified ? `
                    <span class="glass-seal px-2 py-1 text-[9px] text-indigo-700 font-bold uppercase tracking-widest" title="Vision AI Verified">
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="display:inline; margin-right:4px;">
                            <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/>
                            <circle cx="12" cy="12" r="3"/>
                        </svg>
                        Vision Verified
                    </span>
                ` : ''}
            </div>

            ${item.detailUrl ? `
                <a href="${item.detailUrl}" target="_blank" rel="noopener" class="block group">
                    <h2 class="text-[14px] font-bold leading-tight mb-0.5 text-slate-900 group-hover:text-indigo-600 transition-colors line-clamp-3 uppercase tracking-tight">${currentLanguage === 'en' && item._en?.offer_subject
                    ? item._en.offer_subject
                    : item.title
                }</h2>
                </a>
            ` : `<h2 class="text-[14px] font-bold leading-tight mb-0.5 text-slate-900 line-clamp-3 uppercase tracking-tight">${currentLanguage === 'en' && item._en?.offer_subject
                ? item._en.offer_subject
                : item.title
            }</h2>`}

            <p class="text-[10px] font-medium text-slate-400 mb-3 uppercase tracking-wider">${item.chineseTitle}</p>

            ${item.companyName ? `<p class="text-[11px] font-medium text-slate-400 mb-3 truncate">${item.companyName}</p>` : ''}

            <div class="mt-auto pt-3 border-t border-slate-100 flex justify-between items-end">
                <div>
                    <span class="text-xl font-black text-slate-900">$${item.price.toFixed(2)}</span>
                    <span class="text-[10px] text-slate-400 ml-1">USD est.</span>
                </div>
                <span class="text-[10px] font-mono font-bold text-slate-400 uppercase tracking-widest">${item.specStatus}</span>
            </div>
        </div>
        `;
    }).join('');

    // Helper function to position tooltip at trigger element
    function positionTooltip(trigger: Element, tooltip: HTMLElement): void {
        const rect = trigger.getBoundingClientRect();

        // Position tooltip offset from the trigger element
        // Below and slightly to the right of the badge
        const top = rect.bottom + 8; // 8px gap below trigger
        const left = Math.max(16, Math.min(rect.right - 120, window.innerWidth - 300)); // Keep 16px margin from edges

        tooltip.style.top = `${top}px`;
        tooltip.style.left = `${left}px`;
    }

    // Add event listener for tooltip interactions with reliable click handling
    // Using a singleton tooltip element attached to body to prevent z-index issues
    let activeTooltip: HTMLElement | null = null;
    let activeTrigger: Element | null = null;

    const tooltipTriggers = cardGrid.querySelectorAll('.score-tooltip-trigger');
    tooltipTriggers.forEach(trigger => {
        trigger.addEventListener('click', (e: Event) => {
            e.stopPropagation();

            // Should we close the active tooltip?
            if (activeTrigger === trigger) {
                if (activeTooltip) {
                    activeTooltip.remove();
                    activeTooltip = null;
                    activeTrigger = null;
                }
                return;
            }

            // Close existing tooltip if open
            if (activeTooltip) {
                activeTooltip.remove();
                activeTooltip = null;
            }

            // Create new tooltip
            const template = trigger.querySelector('.score-tooltip');
            if (!template) return;

            // Clone content to a new body-level element
            const tooltip = document.createElement('div');
            tooltip.className = 'score-tooltip fixed-tooltip';
            tooltip.innerHTML = template.innerHTML;

            // Style it
            tooltip.style.display = 'block';
            tooltip.style.visibility = 'visible';
            tooltip.style.opacity = '0';
            tooltip.style.zIndex = '99999';
            tooltip.style.position = 'fixed';

            document.body.appendChild(tooltip);

            // Position it
            positionTooltip(trigger, tooltip);

            // Animate in
            requestAnimationFrame(() => {
                tooltip.style.opacity = '1';
                tooltip.style.transform = 'translateY(0)';
            });

            activeTooltip = tooltip;
            activeTrigger = trigger;
        });
    });

    // Close tooltips when clicking outside
    document.addEventListener('click', (e: Event) => {
        const target = e.target as HTMLElement;
        if (activeTooltip && !target.closest('.score-tooltip') && !target.closest('.score-tooltip-trigger')) {
            activeTooltip.style.opacity = '0';
            setTimeout(() => {
                if (activeTooltip) {
                    activeTooltip.remove();
                    activeTooltip = null;
                    activeTrigger = null;
                }
            }, 200);
        }
    });

    // Reposition tooltips on window resize
    window.addEventListener('resize', () => {
        if (activeTooltip && activeTrigger) {
            positionTooltip(activeTrigger, activeTooltip);
        }
    });

    // Update the Search Bundle UI (synonyms, technical terms) for the active query
    populateSynonymTags();
}

// ─── Export CSV ───────────────────────────────────────────────────────────────
function exportCSV(): void {
    const rows = allItems
        .filter(item =>
            currentFilter === 'all' ||
            (currentFilter === 'high' && item.confidence === 'High') ||
            (currentFilter === 'low' && (item.confidence === 'Low' || item.confidence === 'Mismatch'))
        )
        .map(item => ({
            'English Title': item.title,
            'Chinese Title': item.chineseTitle,
            'Price (USD est.)': item.price.toFixed(2),
            'Confidence': item.confidence,
            'Spec Status': item.specStatus,
            'Company': item.companyName ?? '',
            'Factory Level': item.factoryLevel ?? '',
            'Province': item.province ?? '',
            'City': item.city ?? '',
            'Vision Verified': item.visionVerified ? 'Yes' : 'No',
            '1688 Listing': item.detailUrl ?? '',
        }));

    const csv = Papa.unparse(rows);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `procurement_${data.pipeline_summary.original_query.replace(/\s+/g, '_')}.csv`;
    link.click();
    URL.revokeObjectURL(url);
}

// ─── Event Listeners ──────────────────────────────────────────────────────────
searchInput?.addEventListener('input', (e: Event) => {
    const value = (e.target as HTMLInputElement).value;
    currentSearch = value;
    currentPage = 1;
    clearBtn.classList.toggle('hidden', value.length === 0);
    renderDashboard();
});

clearBtn?.addEventListener('click', () => {
    searchInput.value = '';
    currentSearch = '';
    currentPage = 1;
    clearBtn.classList.add('hidden');
    renderDashboard();
    searchInput.focus();
});

document.querySelectorAll('[data-filter]').forEach(btn => {
    btn.addEventListener('click', () => {
        currentFilter = (btn as HTMLElement).dataset.filter as ConfidenceFilter;
        document.querySelectorAll('[data-filter]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentPage = 1;
        renderDashboard();
    });
});

document.querySelectorAll('[data-sort]').forEach(btn => {
    btn.addEventListener('click', () => {
        currentSort = (btn as HTMLElement).dataset.sort as SortMode;
        document.querySelectorAll('[data-sort]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentPage = 1;
        renderDashboard();
    });
});

exportBtn?.addEventListener('click', exportCSV);

// ─── Language Toggle ─────────────────────────────────────────────────────────
const langToggleInput = document.getElementById('dashboard-lang-toggle') as HTMLInputElement;

langToggleInput?.addEventListener('change', (e) => {
    // Checkbox checked = ZH (CN), unchecked = EN
    currentLanguage = (e.target as HTMLInputElement).checked ? 'cn' : 'en';

    console.log(`🌐 Language toggled to: ${currentLanguage}`);
    populateSuggestions();
    populateSynonymTags();
    populateSummary();
    renderDashboard();
});

// ─── Search Suggestions ──────────────────────────────────────────────────────
function populateSuggestions(): void {
    const suggestionsEl = document.getElementById('searchSuggestions');
    if (!suggestionsEl) return;

    // Count queries frequencies
    const queryCounts: Record<string, number> = {};
    allItems.forEach(item => {
        const sq = item.searchQuery || data.pipeline_summary?.chinese_query || 'Unknown';
        if (!queryCounts[sq]) {
            queryCounts[sq] = 0;
        }
        queryCounts[sq] += 1;
    });

    // Sort by frequency and take top 4 unique
    const uniqueQueries = Object.keys(queryCounts).sort((a, b) => queryCounts[b] - queryCounts[a]);
    const top4 = uniqueQueries.slice(0, 4);

    suggestionsEl.innerHTML = top4.map(query => {
        let displayTitle = query;

        // Try to find the English name from bundles first
        const bundle = data.search_bundles?.[query];
        if (currentLanguage === 'en') {
            if (bundle?.original_query) {
                displayTitle = bundle.original_query;
            } else {
                displayTitle = translateBundleTag(query);
            }
        }

        return `<span class="suggestion-tag cursor-pointer bg-slate-100 hover:bg-indigo-50 hover:text-indigo-600 px-3 py-1 rounded-full text-[11px] font-bold border border-slate-200 transition-colors truncate max-w-[200px]" data-query="${query}" title="${displayTitle}">${displayTitle}</span>`;
    }).join('');

    // Add listeners to new elements
    suggestionsEl.querySelectorAll('.suggestion-tag').forEach(tag => {
        tag.addEventListener('click', () => {
            const query = (tag as HTMLElement).dataset.query || '';
            if (searchInput) {
                searchInput.value = query;
                currentSearch = query;
                currentPage = 1;
                clearBtn?.classList.remove('hidden');
                renderDashboard();
            }
        });
    });
}

howItWorksToggle?.addEventListener('click', () => {
    howItWorksPanel.classList.toggle('open');
    howItWorksToggle.textContent = howItWorksPanel.classList.contains('open')
        ? 'Hide pipeline'
        : 'How it works';
});

// ─── Init ─────────────────────────────────────────────────────────────────────
async function init() {
    await loadPipelineData();
    populateSummary();
    populateSynonymTags();
    populateSuggestions();
    renderDashboard();
}

// Refresh data without page reload (call after running phase4-append)
async function refreshData(): Promise<void> {
    console.log('🔄 Refreshing pipeline data...');
    await loadPipelineData();
    populateSummary();
    populateSynonymTags();
    populateSuggestions();
    renderDashboard();
    console.log('✅ Dashboard refreshed!');
}

// ─── API Search Integration ────────────────────────────────────────────────────
const runSearchBtn = document.getElementById('runSearchBtn') as HTMLButtonElement;
const searchIcon = document.getElementById('searchIcon') as Element;
const searchSpinner = document.getElementById('searchSpinner') as Element;
const searchBtnText = document.getElementById('searchBtnText') as HTMLElement;
const loaderOverlay = document.getElementById('loader-overlay') as HTMLDivElement;
const mainLoadingMsg = document.getElementById('main-loading-msg') as HTMLElement;

function setLoadingState(isLoading: boolean): void {
    if (isLoading) {
        runSearchBtn.disabled = true;
        searchIcon.classList.add('hidden');
        searchSpinner.classList.remove('hidden');
        if (searchBtnText) searchBtnText.textContent = 'Searching...';
        loaderOverlay.style.display = 'flex';
        mainLoadingMsg.textContent = 'Running pipeline...';
    } else {
        runSearchBtn.disabled = false;
        searchIcon.classList.remove('hidden');
        searchSpinner.classList.add('hidden');
        if (searchBtnText) searchBtnText.textContent = 'Search 1688';
        loaderOverlay.style.display = 'none';
    }
}

async function runApiSearch(query: string): Promise<void> {
    if (!query.trim()) {
        alert('Please enter a search term');
        return;
    }

    setLoadingState(true);
    console.log(`🔍 Starting API search for: "${query}"`);

    try {
        const response = await fetch('/api/search', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                query: query.trim(),
                enableVision: true
            }),
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Search failed');
        }

        const result = await response.json();
        console.log(`✅ Search complete: ${result.results?.length || 0} results`);

        // Refresh the dashboard with new data
        await refreshData();

        // Update the search input to show the query
        if (searchInput) {
            searchInput.value = '';
            currentSearch = '';
        }

    } catch (error) {
        console.error('❌ Search failed:', error);
        alert(`Search failed: ${(error as Error).message} `);
    } finally {
        setLoadingState(false);
    }
}

// Add click handler for search button
runSearchBtn?.addEventListener('click', () => {
    const query = searchInput?.value || '';
    runApiSearch(query);
});

// Add Enter key handler for search input
searchInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        const query = searchInput.value;
        runApiSearch(query);
    }
});

// Pagination event handlers
document.getElementById('prevPageBtn')?.addEventListener('click', () => {
    if (currentPage > 1) {
        currentPage--;
        renderDashboard();
        cardGrid.scrollIntoView({ behavior: 'smooth' });
    }
});
document.getElementById('nextPageBtn')?.addEventListener('click', () => {
    currentPage++;
    renderDashboard();
    cardGrid.scrollIntoView({ behavior: 'smooth' });
});

// Expose refresh function globally for console access
(window as any).refreshData = refreshData;

init();
