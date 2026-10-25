import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { cloudflare } from '@cloudflare/vite-plugin';
import { existsSync, readFileSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'dotenv';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const viteEnv = loadEnv(mode, process.cwd(), 'VITE_');
  const devVarsPath = resolve(process.cwd(), '.dev.vars');
  const devVars = existsSync(devVarsPath) ? parse(readFileSync(devVarsPath, 'utf8')) : {};
  const publicSupabaseConfig = {
    VITE_SUPABASE_URL: process.env.VITE_SUPABASE_URL || viteEnv.VITE_SUPABASE_URL || devVars.VITE_SUPABASE_URL || '',
    VITE_SUPABASE_ANON_KEY: process.env.VITE_SUPABASE_ANON_KEY || viteEnv.VITE_SUPABASE_ANON_KEY || devVars.VITE_SUPABASE_ANON_KEY || '',
  };

  return {
    define: {
      'import.meta.env.VITE_SUPABASE_URL': JSON.stringify(publicSupabaseConfig.VITE_SUPABASE_URL),
      'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify(publicSupabaseConfig.VITE_SUPABASE_ANON_KEY),
    },
    plugins: [
      react(),
      tailwindcss(),
      cloudflare(),
      {
        name: 'remove-local-worker-secrets-from-build-output',
        apply: 'build',
        enforce: 'post',
        closeBundle() {
          const generatedDevVarsPath = resolve(process.cwd(), 'dist/uptrends_english_academy/.dev.vars');
          if (existsSync(generatedDevVarsPath)) unlinkSync(generatedDevVarsPath);
        },
      },
    ],
    resolve: {
      alias: {
        '@': import.meta.dirname,
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
