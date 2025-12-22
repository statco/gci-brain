// types.ts - Complete type definitions for GCI Tire AI Match

export type Language = 'en' | 'fr';

export type ProcessingStage = 
  | 'idle'
  | 'understanding'
  | 'searching'
  | 'analyzing'
  | 'recommending'
  | 'complete'
  | 'error';

export interface ProcessingLog {
  stage: ProcessingStage;
  message: string;
  timestamp: number;
  details?: string;
}

export interface TireProduct {
  id: string;
  title: string;
  brand: string;
  model: string;
  size: string;
  season: 'All-Season' | 'Winter' | 'Summer';
  price: number;
  rating?: number;
  reviews?: number;
  imageUrl?: string;
  description?: string;
  features?: string[];
  inStock: boolean;
  warranty?: string;
  speedRating?: string;
  loadIndex?: string;
  shopifyVariantId?: string;
}

export interface VehicleData {
  year?: number;
  make?: string;
  model?: string;
  trim?: string;
}

export interface TireRecommendation {
  size: string;
  season: 'All-Season' | 'Winter' | 'Summer';
  brands: string[];
  priceRange: { min: number; max: number };
  confidence: number;
  reasoning: string;
}

export interface AppState {
  // User input
  searchQuery: string;
  language: Language;
  
  // Processing state
  isProcessing: boolean;
  currentStage: ProcessingStage;
  processingLogs: ProcessingLog[];
  
  // Results
  recommendations: TireProduct[];
  vehicleData: VehicleData | null;
  error: string | null;
  
  // UI state
  showResults: boolean;
  showComparison: boolean;
  showFavorites: boolean;
  selectedTires: TireProduct[];
  favoriteTires: TireProduct[];
  
  // Filters
  filters: {
    season?: 'All-Season' | 'Winter' | 'Summer';
    minPrice?: number;
    maxPrice?: number;
    brands?: string[];
    minRating?: number;
  };
}

export interface SearchParams {
  query: string;
  language?: Language;
  vehicleData?: VehicleData;
  filters?: AppState['filters'];
}

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

export interface ShopifyCheckoutInput {
  items: {
    variantId: string;
    quantity: number;
  }[];
  customerInfo?: {
    email?: string;
    phone?: string;
  };
  note?: string;
}

export interface InstallerData {
  id: string;
  name: string;
  email: string;
  phone?: string;
  address: string;
  city: string;
  province: string;
  postalCode: string;
  latitude?: number;
  longitude?: number;
  calendlyLink?: string;
  serviceRadius?: number;
  pricePerTire?: number;
  status: 'Active' | 'Inactive' | 'Pending';
  rating?: number;
  totalInstallations?: number;
}

export interface InstallationJob {
  id: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  installerId: string;
  tireProduct: string;
  quantity: number;
  installationPrice: number;
  scheduledDate?: string;
  status: 'Pending' | 'Confirmed' | 'Completed' | 'Cancelled';
  shopifyOrderId?: string;
  notes?: string;
  createdAt: string;
}

export interface UserLocation {
  lat: number;
  lng: number;
  city?: string;
  province?: string;
}

export interface FitmentData {
  oemSize: string;
  alternativeSizes: string[];
  rimDiameter: string;
  width: string;
  aspectRatio: string;
  speedRating?: string;
  loadIndex?: string;
}

export interface MarketInsight {
  averagePrice: number;
  popularBrands: string[];
  recentReviews: string[];
  trends: string[];
}

// Utility types
export type Nullable<T> = T | null;
export type Optional<T> = T | undefined;
export type PartialBy<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>;
