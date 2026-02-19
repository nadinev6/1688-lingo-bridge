import { ProcurementItem } from './types';

// 1. Elements with Type Casting
const searchInput = document.getElementById('procurementSearch') as HTMLInputElement;
const clearBtn = document.getElementById('clearSearch') as HTMLButtonElement;
const noResultsMsg = document.getElementById('noResults') as HTMLDivElement;
const cardGrid = document.getElementById('cardGrid') as HTMLElement;

// 2. State Management
// In a real app, this would come from a Node.js API fetch
const items: ProcurementItem[] = [
    {
        id: '1',
        title: 'Heavy Duty Pulley',
        chineseTitle: '重型滑轮',
        price: 214.00,
        isFlagged: false,
        confidence: 'High',
        visionVerified: true,
        specStatus: 'SPEC_CONFORMANT'
    },
    {
        id: '2',
        title: 'Cast Iron Bracket',
        chineseTitle: '铸铁支架',
        price: 4.20,
        isFlagged: true,
        systemNote: 'Semantic Drift detected. Unit dimensions do not meet industrial requirements.',
        confidence: 'Mismatch',
        visionVerified: false,
        specStatus: 'VARIANCE: 84%'
    }
];

// 3. Render Function (Instead of hiding/showing hardcoded HTML)
function renderDashboard(filter: string = ''): void {
    const query = filter.toLowerCase();

    // Filter the data
    const filteredData = items.filter(item =>
        item.title.toLowerCase().includes(query) ||
        item.chineseTitle.toLowerCase().includes(query)
    );

    // Toggle No Results
    noResultsMsg.classList.toggle('hidden', filteredData.length > 0);

    // Clear and Redraw
    cardGrid.innerHTML = filteredData.map(item => `
        <div class="hybrid-card p-8 ${item.isFlagged ? 'flagged' : ''}">
            <div class="flex justify-between items-start mb-6">
                <div class="img-container">
                    <div class="w-full h-full bg-slate-200 flex items-center justify-center text-slate-400 text-[10px] font-bold">
                        ${item.id}
                    </div>
                </div>
                <span class="px-4 py-1 ${item.isFlagged ? 'bg-slate-400' : 'bg-emerald-600'} text-white text-[10px] font-black uppercase rounded-full">
                    ${item.confidence}
                </span>
            </div>

            ${item.systemNote ? `
                <div class="bg-slate-200/50 border-l-4 border-slate-400 p-4 text-[11px] text-slate-500 mb-4 rounded-r-lg">
                    <strong>System Note:</strong> ${item.systemNote}
                </div>
            ` : ''}

            ${item.visionVerified ? `
                <div class="flex gap-2 mb-4">
                    <span class="glass-seal px-2 py-1 rounded-lg text-[10px] text-indigo-600 font-bold">👁 VISION VERIFIED</span>
                </div>
            ` : ''}

            <h2 class="text-xl font-bold uppercase leading-none mb-1">${item.title}</h2>
            <p class="text-sm font-medium text-slate-400 mb-6 italic">${item.chineseTitle}</p>

            <div class="mt-auto flex justify-between items-end">
                <span class="text-3xl font-bold">£${item.price.toFixed(2)}</span>
                <span class="text-[10px] font-mono font-bold text-slate-400 uppercase">${item.specStatus}</span>
            </div>
        </div>
    `).join('');
}

// 4. Event Listeners
searchInput?.addEventListener('input', (e: Event) => {
    const target = e.target as HTMLInputElement;
    const value = target.value;

    clearBtn.classList.toggle('hidden', value.length === 0);
    renderDashboard(value);
});

clearBtn?.addEventListener('click', () => {
    searchInput.value = '';
    clearBtn.classList.add('hidden');
    renderDashboard('');
    searchInput.focus();
});

// Initial Load
renderDashboard();
