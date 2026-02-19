import Papa from 'papaparse';
import type { ProcurementItem, PipelineData, ConfidenceFilter, SortMode, RawProduct } from './types';
import pipelineData from '../docs/artifacts/validated_results.json';

const data = pipelineData as PipelineData;

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

// ─── Helpers ──────────────────────────────────────────────────────────────────
function parsePriceCny(priceStr: string): number {
    const match = priceStr.match(/[\d.]+/);
    return match ? parseFloat(match[0]) : 0;
}

function cnyToGbp(cny: number): number {
    return parseFloat((cny * 0.11).toFixed(2));
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

function mapRawToItem(raw: RawProduct, index: number): ProcurementItem {
    const cny = parsePriceCny(raw.offer_price);
    const hasVisionMismatch =
        raw._visualConfidence !== undefined &&
        raw._visualConfidence !== null &&
        raw._visualConfidence < 50 &&
        raw._confidence >= 70;

    return {
        id: String(index + 1),
        title: raw.offer_subject,
        chineseTitle: raw.offer_subject,
        price: cnyToGbp(cny),
        isFlagged: hasVisionMismatch || raw._confidence < 50,
        systemNote: hasVisionMismatch
            ? `Vision mismatch detected. Image confidence: ${raw._visualConfidence}%. ${raw._visionReason ?? ''}`
            : undefined,
        confidence: mapConfidence(raw._confidence, hasVisionMismatch),
        visionVerified: raw._visualConfidence !== undefined && raw._visualConfidence !== null && raw._visualConfidence >= 70,
        specStatus: `${raw._confidence}% CONF`,
        imageUrl: raw.offer_pic_url,
        detailUrl: raw.offer_detail_url,
        companyName: raw.company_name,
        factoryLevel: raw.factory_level,
        province: raw.province,
        city: raw.city,
        searchQuery: raw._search_query,
        specTags: extractSpecTags(raw.offer_subject),
        visionConfidence: raw._visualConfidence ?? undefined,
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

// ─── All items from pipeline data ────────────────────────────────────────────
const allItems: ProcurementItem[] = deduplicateItems(
    data.results.map((raw, i) => mapRawToItem(raw, i))
);

// ─── Populate Pipeline Summary ───────────────────────────────────────────────
function populateSummary(items: ProcurementItem[] = allItems): void {
    const s = data.pipeline_summary;

    // Always update static properties
    if (originalQueryEl) originalQueryEl.textContent = s.original_query;
    if (chineseQueryEl) chineseQueryEl.textContent = s.chinese_query;
    if (statLatency) statLatency.textContent = `${s.total_latency_ms}ms`;

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
    const bundle = data.search_bundle;
    const tags: { text: string; type: 'primary' | 'synonym' | 'negative' }[] = [
        { text: bundle.primary, type: 'primary' },
        ...bundle.synonyms.map(s => ({ text: s, type: 'synonym' as const })),
        ...bundle.negative_keywords.slice(0, 4).map(k => ({ text: `-${k}`, type: 'negative' as const })),
    ];

    synonymTagsEl.innerHTML = tags.map(tag => {
        const base = 'px-3 py-1 rounded-full text-[11px] font-bold border font-mono';
        if (tag.type === 'primary') {
            return `<span class="${base} bg-[#1a1d23] text-white border-[#1a1d23]" title="Primary Chinese query">${tag.text}</span>`;
        }
        if (tag.type === 'synonym') {
            return `<span class="${base} bg-blue-50 text-blue-700 border-blue-200" title="Synonym expansion">${tag.text}</span>`;
        }
        return `<span class="${base} bg-red-50 text-red-600 border-red-200" title="Negative keyword">${tag.text}</span>`;
    }).join('');
}

// ─── Render Dashboard ─────────────────────────────────────────────────────────
function renderDashboard(): void {
    let filtered = allItems.filter(item => {
        const query = currentSearch.toLowerCase();
        const matchesSearch = !query ||
            item.title.toLowerCase().includes(query) ||
            item.chineseTitle.toLowerCase().includes(query) ||
            (item.companyName?.toLowerCase().includes(query) ?? false);

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

    cardGrid.innerHTML = filtered.map(item => {
        const factory = item.factoryLevel ? mapFactoryLevel(item.factoryLevel) : null;
        const confClass = confidenceBadgeClass(item.confidence);
        const location = [item.city, item.province].filter(Boolean).join(', ');

        return `
        <div class="hybrid-card p-6 ${item.isFlagged ? 'flagged' : ''} group">
            <div class="img-container relative">
                <img src="${item.imageUrl}" alt="${item.title}" loading="lazy" onerror="this.src='./src/components/bridge.svg'" />
                <div class="absolute top-2 right-2 flex gap-1">
                    <span class="px-2 py-0.5 text-[9px] font-black uppercase rounded-full ${confClass}" style="white-space:nowrap">
                        ${item.confidence === 'High' ? 'HIGH CONF' : item.confidence === 'Mismatch' ? 'MISMATCH' : 'LOW CONF'}
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
                    <h2 class="text-[14px] font-bold leading-tight mb-0.5 text-slate-900 group-hover:text-indigo-600 transition-colors line-clamp-2 uppercase tracking-tight">${item.title}</h2>
                </a>
            ` : `<h2 class="text-[14px] font-bold leading-tight mb-0.5 text-slate-900 line-clamp-2 uppercase tracking-tight">${item.title}</h2>`}

            <p class="text-[10px] font-medium text-slate-400 mb-3 uppercase tracking-wider">${item.chineseTitle}</p>

            ${item.companyName ? `<p class="text-[11px] font-medium text-slate-400 mb-3 truncate">${item.companyName}</p>` : ''}

            <div class="mt-auto pt-3 border-t border-slate-100 flex justify-between items-end">
                <div>
                    <span class="text-xl font-black text-slate-900">£${item.price.toFixed(2)}</span>
                    <span class="text-[10px] text-slate-400 ml-1">GBP est.</span>
                </div>
                <span class="text-[10px] font-mono font-bold text-slate-400 uppercase tracking-widest">${item.specStatus}</span>
            </div>
        </div>
        `;
    }).join('');
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
            'Price (GBP est.)': item.price.toFixed(2),
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
    clearBtn.classList.toggle('hidden', value.length === 0);
    renderDashboard();
});

clearBtn?.addEventListener('click', () => {
    searchInput.value = '';
    currentSearch = '';
    clearBtn.classList.add('hidden');
    renderDashboard();
    searchInput.focus();
});

document.querySelectorAll('[data-filter]').forEach(btn => {
    btn.addEventListener('click', () => {
        currentFilter = (btn as HTMLElement).dataset.filter as ConfidenceFilter;
        document.querySelectorAll('[data-filter]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        renderDashboard();
    });
});

document.querySelectorAll('[data-sort]').forEach(btn => {
    btn.addEventListener('click', () => {
        currentSort = (btn as HTMLElement).dataset.sort as SortMode;
        document.querySelectorAll('[data-sort]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        renderDashboard();
    });
});

exportBtn?.addEventListener('click', exportCSV);

// ─── Search Suggestions ──────────────────────────────────────────────────────
function populateSuggestions(): void {
    const suggestionsEl = document.getElementById('searchSuggestions');
    if (!suggestionsEl) return;

    // Count title frequencies
    const counts: Record<string, number> = {};
    allItems.forEach(item => {
        const title = item.title;
        counts[title] = (counts[title] || 0) + 1;
    });

    // Sort by frequency and take top 4 unique
    const uniqueTitles = Object.keys(counts).sort((a, b) => counts[b] - counts[a]);
    const top4 = uniqueTitles.slice(0, 4);

    suggestionsEl.innerHTML = top4.map(title =>
        `<span class="suggestion-tag cursor-pointer bg-slate-100 hover:bg-indigo-50 hover:text-indigo-600 px-3 py-1 rounded-full text-[11px] font-bold border border-slate-200 transition-colors" data-query="${title}">${title}</span>`
    ).join('');

    // Add listeners to new elements
    suggestionsEl.querySelectorAll('.suggestion-tag').forEach(tag => {
        tag.addEventListener('click', () => {
            const query = (tag as HTMLElement).dataset.query || '';
            if (searchInput) {
                searchInput.value = query;
                currentSearch = query;
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
populateSummary();
populateSynonymTags();
populateSuggestions();
renderDashboard();
