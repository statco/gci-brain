/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_GEMINI_API_KEY: string
  readonly VITE_SHOPIFY_STORE_DOMAIN: string
  readonly VITE_SHOPIFY_STOREFRONT_ACCESS_TOKEN: string
  readonly VITE_SHOPIFY_API_VERSION: string
  readonly VITE_SHOPIFY_INSTALLATION_PRODUCT_ID: string
  readonly VITE_AIRTABLE_API_KEY: string
  readonly VITE_AIRTABLE_BASE_ID: string
  readonly VITE_AIRTABLE_INSTALLERS_TABLE: string
  readonly VITE_AIRTABLE_JOBS_TABLE: string
  readonly VITE_AIRTABLE_PAYMENTS_TABLE: string
  readonly VITE_AIRTABLE_NOTIFICATIONS_TABLE: string
  readonly VITE_WHEEL_SIZE_API_KEY: string
  readonly VITE_GOOGLE_MAPS_API_KEY: string
  // Server-side only (used by api/syncProducts.ts, not exposed to frontend)
  // readonly SHOPIFY_ADMIN_ACCESS_TOKEN: string
  // readonly CT_CONSUMER_KEY: string
  // readonly CT_CONSUMER_SECRET: string
  // readonly CT_TOKEN_ID: string
  // readonly CT_TOKEN_SECRET: string
  // readonly CT_CUSTOMER_NUMBER: string
  // readonly CT_CUSTOMER_API_TOKEN: string
  // readonly CT_USE_SANDBOX: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
