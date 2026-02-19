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
const statTotal = document.getElementById('statTotal') as HTMLElement;
const statAvgConf = document.getElementById('statAvgConf') as HTMLElement;
const statHighConf = document.getElementById('statHighConf') as HTMLElement;
const statLatency = document.getElementById('statLatency') as HTMLElement;
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
        detailUrl: raw.offer_detail_url,
        companyName: raw.company_name,
        factoryLevel: raw.factory_level,
        province: raw.province,
        city: raw.city,
        searchQuery: raw._search_query,
    };
}

// ─── Deduplicate by title+company (for display) ───────────────────────────────
function deduplicateItems(items: ProcurementItem[]): ProcurementItem[] {
    const seen = new Set<string>();
    return items.filter(item => {
        const key = `${item.title}|${item.companyName}`;
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
function populateSummary(): void {
    const s = data.pipeline_summary;
    originalQueryEl.textContent = s.original_query;
    chineseQueryEl.textContent = s.chinese_query;
    statTotal.textContent = String(allItems.length);
    statAvgConf.textContent = `${s.average_confidence}%`;
    statHighConf.textContent = String(s.high_confidence_count);
    statLatency.textContent = `${s.total_latency_ms}ms`;
    totalBadge.textContent = `${allItems.length} suppliers`;
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

    cardGrid.innerHTML = filtered.map(item => {
        const factory = item.factoryLevel ? mapFactoryLevel(item.factoryLevel) : null;
        const confClass = confidenceBadgeClass(item.confidence);
        const location = [item.city, item.province].filter(Boolean).join(', ');

        return `
        <div class="hybrid-card p-6 ${item.isFlagged ? 'flagged' : ''}">
            <div class="flex justify-between items-start mb-4">
                <div class="flex flex-col gap-1">
                    ${factory ? `<span class="px-2 py-0.5 text-[10px] font-black uppercase rounded-full ${factory.cssClass}" style="width:fit-content">${factory.label}</span>` : ''}
                    ${location ? `<span class="text-[10px] text-slate-400 font-medium">${location}</span>` : ''}
                </div>
                <span class="px-3 py-1 text-[10px] font-black uppercase tracking-widest rounded-full ${confClass}" style="white-space:nowrap">
                    ${item.confidence === 'High' ? 'HIGH CONFIDENCE' : item.confidence === 'Mismatch' ? 'INTENT MISMATCH' : 'LOW CONFIDENCE'}
                </span>
            </div>

            ${item.systemNote ? `
                <div class="bg-slate-50 border-l-4 border-slate-300 p-3 text-[11px] text-slate-600 mb-3">
                    System Note: Semantic Drift detected. ${item.systemNote}
                </div>
            ` : ''}

            ${item.visionVerified ? `
                <div class="flex gap-2 mb-3">
                    <span class="glass-seal px-2 py-1 text-[10px] text-indigo-700 font-bold uppercase tracking-widest">&#9679; Vision Verified</span>
                </div>
            ` : ''}

            ${item.detailUrl ? `
                <a href="${item.detailUrl}" target="_blank" rel="noopener" class="block group">
                    <h2 class="text-[15px] font-bold leading-snug mb-1 text-slate-900 group-hover:text-indigo-600 transition-colors line-clamp-2 uppercase tracking-tight">${item.title}</h2>
                </a>
            ` : `<h2 class="text-[15px] font-bold leading-snug mb-1 text-slate-900 line-clamp-2 uppercase tracking-tight">${item.title}</h2>`}

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

howItWorksToggle?.addEventListener('click', () => {
    howItWorksPanel.classList.toggle('open');
    howItWorksToggle.textContent = howItWorksPanel.classList.contains('open')
        ? 'Hide pipeline'
        : 'How it works';
});

// ─── Init ─────────────────────────────────────────────────────────────────────
populateSummary();
populateSynonymTags();
renderDashboard();
