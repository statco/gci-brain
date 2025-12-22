// types.ts
// Core type definitions for GCI Tire AI Match 2.0

// Language support
export type Language = 'en' | 'fr';

// Processing stages for AI workflow
export type ProcessingStage = 
  | 'idle'
  | 'understanding'
  | 'searching'
  | 'analyzing'
  | 'recommending'
  | 'complete'
  | 'error';

// Processing log entry
export interface ProcessingLog {
  stage: ProcessingStage;
  message: string;
  timestamp: number;
  details?: string;
}

// Tire product from Shopify
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

// Vehicle information
export interface VehicleData {
  year?: number;
  make?: string;
  model?: string;
  trim?: string;
}

// Main application state
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

// Search parameters
export interface SearchParams {
  query: string;
  language?: Language;
  vehicleData?: VehicleData;
  filters?: AppState['filters'];
}

// API response wrapper
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

// Shopify checkout
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

// Installer data
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

// Installation job
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

// User location
export interface UserLocation {
  lat: number;
  lng: number;
  city?: string;
  province?: string;
}

// Tire recommendation from AI
export interface TireRecommendation {
  size: string;
  season: 'All-Season' | 'Winter' | 'Summer';
  brands: string[];
  priceRange: { min: number; max: number };
  confidence: number;
  reasoning: string;
}

// Fitment data
export interface FitmentData {
  oemSize: string;
  alternativeSizes: string[];
  rimDiameter: string;
  width: string;
  aspectRatio: string;
  speedRating?: string;
  loadIndex?: string;
}

// Market insights
export interface MarketInsight {
  averagePrice: number;
  popularBrands: string[];
  recentReviews: string[];
  trends: string[];
}
