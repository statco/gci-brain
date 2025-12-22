// utils/appStates.ts
// Runtime enum for application states
// These are actual JavaScript values that exist at runtime

export enum AppStates {
  IDLE = 'IDLE',
  PROCESSING = 'PROCESSING',
  RESULTS = 'RESULTS',
  CHECKOUT = 'CHECKOUT',
  SUCCESS = 'SUCCESS',
  ERROR = 'ERROR'
}

export enum ProcessingStages {
  ANALYZING = 'ANALYZING',
  VALIDATING = 'VALIDATING',
  INVENTORY = 'INVENTORY'
}

// Helper to check if a value is a valid app state
export const isValidAppState = (value: unknown): value is AppStates => {
  return Object.values(AppStates).includes(value as AppStates);
};
