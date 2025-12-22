import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  
  return {
    plugins: [react()],
    
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './'),
      },
    },
    
    define: {
      'process.env.API_KEY': JSON.stringify(env.VITE_GEMINI_API_KEY || env.GEMINI_API_KEY || env.API_KEY || ''),
      'process.env.GEMINI_API_KEY': JSON.stringify(env.VITE_GEMINI_API_KEY || env.GEMINI_API_KEY || ''),
      'process.env.PERPLEXITY_API_KEY': JSON.stringify(env.VITE_PERPLEXITY_API_KEY || env.PERPLEXITY_API_KEY || ''),
      'process.env.GROK_API_KEY': JSON.stringify(env.VITE_GROK_API_KEY || env.GROK_API_KEY || ''),
      'process.env.WHEEL_SIZE_API_KEY': JSON.stringify(env.VITE_WHEEL_SIZE_API_KEY || env.WHEEL_SIZE_API_KEY || ''),
      'process.env.SHOPIFY_STOREFRONT_TOKEN': JSON.stringify(env.VITE_SHOPIFY_STOREFRONT_TOKEN || env.SHOPIFY_STOREFRONT_TOKEN || ''),
      'process.env.SHOPIFY_STORE_DOMAIN': JSON.stringify(env.VITE_SHOPIFY_STORE_DOMAIN || env.SHOPIFY_STORE_DOMAIN || ''),
      'process.env.AIRTABLE_API_KEY': JSON.stringify(env.VITE_AIRTABLE_API_KEY || env.AIRTABLE_API_KEY || ''),
      'process.env.AIRTABLE_BASE_ID': JSON.stringify(env.VITE_AIRTABLE_BASE_ID || env.AIRTABLE_BASE_ID || ''),
      'process.env.GOOGLE_MAPS_API_KEY': JSON.stringify(env.VITE_GOOGLE_MAPS_API_KEY || env.GOOGLE_MAPS_API_KEY || ''),
    },
    
    build: {
      outDir: 'dist',
      sourcemap: false,
      rollupOptions: {
        output: {
          manualChunks: {
            'react-vendor': ['react', 'react-dom', 'react-router-dom'],
            'ai-services': ['@google/generative-ai'],
          },
        },
      },
    },
    
    server: {
      proxy: {
        '/api': {
          target: 'http://localhost:3000',
          changeOrigin: true,
        },
      },
    },
  };
});
