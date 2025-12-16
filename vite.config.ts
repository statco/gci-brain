import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  // Use '.' instead of process.cwd() for better compatibility
  const env = loadEnv(mode, '.', '');

  return {
    plugins: [react()],
    define: {
      'process.env.API_KEY': JSON.stringify(env.API_KEY || ''),
      'process.env.PERPLEXITY_API_KEY': JSON.stringify(env.PERPLEXITY_API_KEY || ''),
      'process.env.GROK_API_KEY': JSON.stringify(env.GROK_API_KEY || ''),
      'process.env.WHEEL_SIZE_API_KEY': JSON.stringify(env.WHEEL_SIZE_API_KEY || ''),
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