import fs from 'node:fs';
import path from 'node:path';

function sanitizeFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  let replacedCount = 0;

  const sanitized = content.replace(/[\uFDD0-\uFDEF\uFFFE\uFFFF]/g, (char) => {
    replacedCount++;
    return '\\u' + char.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0');
  });

  if (replacedCount > 0) {
    fs.writeFileSync(filePath, sanitized, 'utf8');
    console.log(`[Sanitizer] Escaped ${replacedCount} noncharacter(s) in: ${filePath}`);
  }
}

function walkDir(dir) {
  if (!fs.existsSync(dir)) return;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkDir(fullPath);
    } else if (entry.name.endsWith('.js') || entry.name.endsWith('.json') || entry.name.endsWith('.html')) {
      sanitizeFile(fullPath);
    }
  }
}

const targetDir = path.resolve(process.cwd(), '.output/chrome-mv3');
console.log(`[Sanitizer] Checking output directory: ${targetDir}`);
walkDir(targetDir);
console.log('[Sanitizer] All files checked and sanitized for Chromium UTF-8 compliance.');
