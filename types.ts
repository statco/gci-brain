
export type Language = 'en' | 'fr';

export enum AppState {
  IDLE = 'IDLE',
  PROCESSING = 'PROCESSING',
  RESULTS = 'RESULTS',
  CHECKOUT = 'CHECKOUT',
  SUCCESS = 'SUCCESS',
  ERROR = 'ERROR'
}

export enum ProcessingStage {
  ANALYZING = 'ANALYZING',
  INVENTORY = 'INVENTORY',
  VALIDATING = 'VALIDATING'
}

export interface ProcessingLog {
  stage: ProcessingStage;
  message: string;
  status: 'pending' | 'active' | 'completed';
}

export interface Review {
  id: string;
  user: string;
  rating: number;
  comment: string;
  date: string;
}

export interface FitmentSpecs {
  loadIndex: string; // e.g., "98"
  speedRating: string; // e.g., "V"
  utqg?: string; // e.g., "500 A A"
  warranty: string; // e.g., "60,000 Miles"
  oemMatch: boolean;
}

export interface VehicleInfo {
  year?: string;
  make?: string;
  model?: string;
  trim?: string;
  detected: boolean;
  tireSizes?: string[]; // Retrieved from Wheel-Size API
}

export type QualityTier = 'Good' | 'Better' | 'Best';

export interface Installer {
  id: string;
  name: string;
  address: string;
  distance: string;
  rating: number;
  mapPosition?: { top: number; left: number };
}

export interface TireProduct {
  id: string;
  variantId?: string; // Added for Shopify Checkout Permalinks
  brand: string;
  model: string;
  type: string;
  description: string;
  pricePerUnit: number;
  installationFeePerUnit: number;
  imageUrl: string; // The official product image (white background)
  visualizationUrl?: string; // The AI-generated vehicle visualization
  features: string[];
  matchScore: number;
  fitmentVerified: boolean;
  inStock: boolean;
  searchSourceTitle?: string;
  searchSourceUrl?: string;
  
  // Extended Features
  reviews: Review[];
  reviewCount: number;
  averageRating: number;
  fitmentSpecs: FitmentSpecs;
  tier: QualityTier;
  has3PMSF: boolean; // Three-Peak Mountain Snowflake symbol
}
