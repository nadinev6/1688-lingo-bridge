export interface ProcurementItem {
    id: string;
    title: string;
    chineseTitle: string;
    price: number;
    imageUrl: string;
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
    specTags: string[];
    productSpecs?: string[];   // Translated key-value spec strings e.g. "Material: ABS"
    serviceTags?: string[];    // Translated trust/service tags e.g. "Free return shipping"
    imageError?: boolean;
    visionConfidence?: number | null;
    blacklisted?: boolean;      // Marked by blacklist filter
    blacklistReason?: string;   // Reason for blacklisting
    _en?: {                    // English translation data for language toggle
        offer_subject: string;
    };
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
    image_url?: string;
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
    _blacklisted?: boolean;
    _blacklistReason?: string;
}

export interface PipelineData {
    pipeline_summary: PipelineSummary;
    search_bundle: SearchBundle;
    search_bundles?: Record<string, SearchBundle>; // NEW: Map of query -> bundle
    results: RawProduct[];
    metadata: {
        generated_at: string;
        pipeline_version: string;
    };
}

export type ConfidenceFilter = 'all' | 'high' | 'low';
export type SortMode = 'confidence' | 'price-asc' | 'price-desc';
