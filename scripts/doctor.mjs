import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: path.join(root, '.env'), override: false });
const failures = [];
const pass = (message) => console.log(`PASS  ${message}`);
const warn = (message) => console.log(`WARN  ${message}`);
const fail = (message) => { failures.push(message); console.error(`FAIL  ${message}`); };

const [major, minor] = process.versions.node.split('.').map(Number);
if (major > 20 || (major === 20 && minor >= 19)) pass(`Node.js ${process.versions.node}`);
else fail(`Node.js ${process.versions.node}; minimum required 20.19.0 (recommended 22 LTS).`);

for (const dependency of ['@modelcontextprotocol/sdk', 'pdf-parse', 'mammoth', 'exceljs', 'zod', 'dotenv']) {
  try { await import.meta.resolve(dependency); pass(`Dependency tersedia: ${dependency}`); }
  catch { fail(`Dependency belum terpasang: ${dependency}. Jalankan npm install.`); }
}

for (const artifact of ['index.js', 'parser-child.js']) {
  try {
    await fs.access(path.join(root, 'dist', artifact));
    pass(`Build production dist/${artifact} ditemukan`);
  } catch {
    fail(`Build dist/${artifact} belum ditemukan. Jalankan npm run build.`);
  }
}

const rawRoots = process.env.ALLOWED_DIRS ?? '';
if (!rawRoots.trim()) {
  fail('ALLOWED_DIRS belum diatur pada .env atau environment Claude/Cursor.');
} else {
  const delimiter = process.platform === 'win32' ? ';' : path.delimiter;
  const roots = rawRoots.split(delimiter).map((item) => item.trim()).filter(Boolean);
  if (!roots.length) fail('ALLOWED_DIRS kosong.');
  for (const rootPath of roots) {
    if (!path.isAbsolute(rootPath)) { fail(`Path allowlist bukan absolute path: ${rootPath}`); continue; }
    try {
      const stat = await fs.stat(rootPath);
      if (!stat.isDirectory()) fail(`Allowlist bukan direktori: ${rootPath}`);
      else pass(`Direktori allowlist tersedia: ${rootPath}`);
    } catch { fail(`Direktori allowlist tidak ditemukan/tidak dapat diakses: ${rootPath}`); }
  }
}

const outputRootsRaw = process.env.ALLOWED_OUTPUT_DIRS ?? '';
if (outputRootsRaw.trim()) {
  const outputDelimiter = process.platform === 'win32' ? ';' : path.delimiter;
  for (const outputRoot of outputRootsRaw.split(outputDelimiter).map((item) => item.trim()).filter(Boolean)) {
    try {
      const stat = await fs.stat(outputRoot);
      if (!stat.isDirectory()) fail(`Allowlist output bukan direktori: ${outputRoot}`);
      else pass(`Direktori output tersedia: ${outputRoot}`);
    } catch { fail(`Direktori output tidak ditemukan/tidak dapat diakses: ${outputRoot}`); }
  }
} else {
  pass('ALLOWED_OUTPUT_DIRS tidak diatur; default menurun ke ALLOWED_DIRS');
}

const maxFile = Number(process.env.MAX_FILE_SIZE_MB ?? 50);
if (!Number.isInteger(maxFile) || maxFile < 1 || maxFile > 50) fail('MAX_FILE_SIZE_MB harus berada pada rentang 1–50.');
else pass(`Batas ukuran file ${maxFile} MB`);

if (failures.length) {
  console.error(`\nDoctor menemukan ${failures.length} masalah. Perbaiki FAIL di atas sebelum menghubungkan MCP client.`);
  process.exitCode = 1;
} else {
  console.log('\nDoctor selesai: pemeriksaan konfigurasi lokal lulus. Ini bukan pengganti integration/security test dokumen nyata.');
}
