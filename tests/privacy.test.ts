import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const PROJECT_ROOT = resolve(process.cwd());

const FORBIDDEN_PATTERNS = [
  'ownerUserId',
  'user-14b72fb6',
  'quantity',
  'currentValue',
  'faceValueAfterApply',
  'access_token',
  'request_token',
  'checksum',
  'password'
];

function getAllFiles(dir: string, fileList: string[] = []): string[] {
  const files = readdirSync(dir);
  for (const file of files) {
    const filePath = join(dir, file);
    if (file === 'node_modules' || file === 'dist' || file === '.git' || file === 'evidence' || file === 'tests') continue;
    if (statSync(filePath).isDirectory()) {
      getAllFiles(filePath, fileList);
    } else {
      fileList.push(filePath);
    }
  }
  return fileList;
}

describe('Standalone Bond Tracker Privacy & Isolation Contract', () => {
  it('scans all project files for forbidden personal holding fields and credentials', () => {
    const files = getAllFiles(PROJECT_ROOT);
    const violations: { file: string; pattern: string }[] = [];

    for (const file of files) {
      if (file.endsWith('.db') || file.endsWith('.sqlite')) continue;
      const content = readFileSync(file, 'utf8');

      for (const pattern of FORBIDDEN_PATTERNS) {
        if (content.includes(pattern)) {
          violations.push({ file, pattern });
        }
      }
    }

    expect(violations).toEqual([]);
  });
});
