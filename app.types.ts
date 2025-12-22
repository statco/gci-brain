// Base types first (no dependencies)
export type Language = 'en' | 'fr';

export type ProcessingStage = 
  | 'idle'
  | 'analyzing'
  | 'searching'
  | 'matching'
  | 'complete'
  | 'error';

// TireProduct MUST come before AppState (AppState depends on it)
export interface TireProduct {
  id: string;
  variantId: string;
  brand: string;
  model: string;
  type: string;
  description: string;
  pricePerUnit: number;
  installationFeePerUnit: number;
  imageUrl: string;
  matchScore: number;
  features: string[];
  inStock: boolean;
  quantityAvailable: number;
}

// ProcessingLog (depends on ProcessingStage)
export interface ProcessingLog {
  stage: ProcessingStage;
  message: string;
  timestamp: number;
}

// AppState (depends on ProcessingStage and TireProduct)
export interface AppState {
  stage: ProcessingStage;
  logs: ProcessingLog[];
  recommendations: TireProduct[];
  error?: string;
}

// TireRecommendation (no dependencies)
export interface TireRecommendation {
  brand: string;
  model: string;
  size: string;
  season: string;
  priceRange: string;
  matchScore: number;
  reason: string;
  features: string[];
}

// Installer (no dependencies)
export interface Installer {
  id: string;
  businessName: string;
  contactName: string;
  email: string;
  phone: string;
  address: string;
  city: string;
  province: string;
  postalCode: string;
  serviceArea: string[];
  rating: number;
  reviewCount: number;
  verified: boolean;
  availability: 'available' | 'busy' | 'unavailable';
}

// InstallationJob (no dependencies)
export interface InstallationJob {
  id: string;
  orderId: string;
  customerId: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  customerAddress: string;
  installerId?: string;
  tireDetails: {
    brand: string;
    model: string;
    quantity: number;
  };
  status: 'pending' | 'assigned' | 'scheduled' | 'completed' | 'cancelled';
  scheduledDate?: string;
  completedDate?: string;
  notes?: string;
}
