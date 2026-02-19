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
    detailUrl?: string;
    companyName?: string;
    factoryLevel?: string;
    province?: string;
    city?: string;
    searchQuery?: string;
}

export interface PipelineSummary {
    original_query: string;
    chinese_query: string;
    total_results: number;
    average_confidence: number;
    high_confidence_count: number;
    low_confidence_count: number;
    suspicious_count: number;
    filtered_by_blacklist: number;
    vision_checks: number;
    vision_mismatches: number;
    total_latency_ms: number;
}

export interface SearchBundle {
    primary: string;
    technical: string;
    synonyms: string[];
    negative_keywords: string[];
    original_query: string;
    _metadata?: {
        knownTerms: number;
        translatedTerms: number;
        synonymSource: string;
        context: string;
        market: string;
        timestamp: string;
    };
}

export interface RawProduct {
    offer_subject: string;
    main_category: string;
    categoryName: string;
    company_name: string;
    offer_price: string;
    offer_pic_url: string;
    offer_detail_url: string;
    company_url: string;
    province: string;
    city: string;
    is_factory: boolean;
    factory_level: string;
    _search_query: string;
    _scraped_at: string;
    _confidence: number;
    _visualConfidence?: number | null;
    _visionReason?: string;
}

export interface PipelineData {
    pipeline_summary: PipelineSummary;
    search_bundle: SearchBundle;
    results: RawProduct[];
    metadata: {
        generated_at: string;
        pipeline_version: string;
    };
}

export type ConfidenceFilter = 'all' | 'high' | 'low';
export type SortMode = 'confidence' | 'price-asc' | 'price-desc';
