import { defineConfig } from 'wxt';
import fs from 'node:fs';
import path from 'node:path';

function sanitizeOutput(outputDir: string) {
  if (!fs.existsSync(outputDir)) return;
  
  function walk(dir: string) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.name.endsWith('.js') || entry.name.endsWith('.json') || entry.name.endsWith('.html')) {
        try {
          const content = fs.readFileSync(fullPath, 'utf8');
          const sanitized = content.replace(/[\uFDD0-\uFDEF\uFFFE\uFFFF]/g, (char: string) => {
            return '\\u' + char.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0');
          });
          if (sanitized !== content) {
            fs.writeFileSync(fullPath, sanitized, 'utf8');
            console.log(`[WXT Hook] Sanitized Chromium noncharacters in: ${entry.name}`);
          }
        } catch {
          // ignore read error
        }
      }
    }
  }

  walk(outputDir);
}

// See https://wxt.dev/api/config.html
export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  hooks: {
    'build:done': (wxt) => {
      sanitizeOutput(wxt.config.outDir);
    },
  },
  manifest: {
    name: 'AutoApply AI - Autonomous Job Application Assistant',
    description:
      'Autonomously navigates, parses, generates tailored content for, and applies to jobs across LinkedIn, Wellfound, Naukri, and Indeed.',
    version: '1.0.0',
    permissions: [
      'sidePanel',
      'storage',
      'activeTab',
      'scripting',
      'tabs',
      'unlimitedStorage',
    ],
    host_permissions: [
      'https://*.linkedin.com/*',
      'https://*.wellfound.com/*',
      'https://*.naukri.com/*',
      'https://*.indeed.com/*',
      'http://127.0.0.1/*',
      'http://localhost/*',
    ],
    action: {
      default_title: 'AutoApply AI Side Panel',
    },
  },
});
