export enum AppStates {
  IDLE = 'IDLE',
  PROCESSING = 'PROCESSING',
  RESULTS = 'RESULTS',
  INSTALLER_SELECT = 'INSTALLER_SELECT',
  CHECKOUT = 'CHECKOUT',
  SUCCESS = 'SUCCESS',
  ERROR = 'ERROR'
}

export enum ProcessingStages {
  ANALYZING = 'ANALYZING',
  VALIDATING = 'VALIDATING',
  INVENTORY = 'INVENTORY'
}

export const isValidAppState = (value: unknown): value is AppStates =>
  Object.values(AppStates).includes(value as AppStates);
