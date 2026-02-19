export interface ProcurementItem {
    id: string;
    title: string;
    chineseTitle: string;
    price: number;
    isFlagged: boolean;
    systemNote?: string;
    confidence: 'High' | 'Low' | 'Mismatch';
    visionVerified: boolean;
    specStatus: string;
}
