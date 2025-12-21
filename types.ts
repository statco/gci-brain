export type Language = 'en' | 'fr';

export type ProcessingStage = 
  | 'idle'
  | 'analyzing'
  | 'searching'
  | 'matching'
  | 'complete'
  | 'error';

export interface ProcessingLog {
  stage: ProcessingStage;
  message: string;
  timestamp: number;
}

export interface AppState {
  stage: ProcessingStage;
  logs: ProcessingLog[];
  recommendations: TireProduct[];
  error?: string;
}

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
