import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const serverPath = path.join(root, 'dist', 'index.js');
await import('node:fs/promises').then(({ access }) => access(serverPath)).catch(() => { throw new Error('dist/index.js tidak ditemukan. Jalankan npm run build terlebih dahulu.'); });
const temp = await mkdtemp(path.join(os.tmpdir(), 'document-mcp-smoke-'));
const csvPath = path.join(temp, 'smoke.csv');
await writeFile(csvPath, 'name,department\nAlya,Finance\nBima,Operations\n', 'utf8');

const child = spawn(process.execPath, [serverPath], {
  cwd: root,
  env: {
    ...process.env,
    ALLOWED_DIRS: temp,
    MAX_PROCESSING_TIMEOUT_MS: '15000',
    MAX_CONCURRENT_TOOLS: '1',
    MAX_FILE_SIZE_MB: '50',
  },
  stdio: ['pipe', 'pipe', 'pipe'],
});

let stdoutBuffer = '';
let stderrBuffer = '';
const pending = new Map();
let nextId = 1;
child.stdout.setEncoding('utf8');
child.stderr.setEncoding('utf8');
child.stdout.on('data', (chunk) => {
  stdoutBuffer += chunk;
  for (;;) {
    const newline = stdoutBuffer.indexOf('\n');
    if (newline < 0) break;
    const line = stdoutBuffer.slice(0, newline).trim();
    stdoutBuffer = stdoutBuffer.slice(newline + 1);
    if (!line) continue;
    try {
      const message = JSON.parse(line);
      if (message.id !== undefined && pending.has(message.id)) {
        const { resolve } = pending.get(message.id);
        pending.delete(message.id);
        resolve(message);
      }
    } catch { /* Ignore non-JSON diagnostic lines; server must not write these to stdout. */ }
  }
});
child.stderr.on('data', (chunk) => { stderrBuffer += chunk; });

function request(method, params = {}) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`Timeout menunggu respons ${method}. STDERR: ${stderrBuffer.slice(-2000)}`));
    }, 12_000);
    pending.set(id, {
      resolve: (message) => { clearTimeout(timer); resolve(message); },
      reject,
    });
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
  });
}

function notify(method, params = {}) {
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`);
}

function assertOk(condition, message) {
  if (!condition) throw new Error(message);
  console.log(`PASS  ${message}`);
}

try {
  const init = await request('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'document-mcp-smoke-test', version: '1.0.0' },
  });
  assertOk(Boolean(init.result?.serverInfo?.name === 'universal-document-reader'), 'MCP initialize handshake');
  notify('notifications/initialized');

  const listed = await request('tools/list');
  const names = (listed.result?.tools ?? []).map((tool) => tool.name);
  const expected = ['get_document_info', 'read_pdf', 'read_word', 'read_excel', 'search_in_document'];
  assertOk(expected.every((name) => names.includes(name)), 'Lima MCP tools terdaftar');

  const info = await request('tools/call', { name: 'get_document_info', arguments: { filePath: csvPath } });
  assertOk(!info.result?.isError && info.result?.content?.[0]?.text?.includes('smoke.csv'), 'get_document_info pada CSV fixture');

  const read = await request('tools/call', { name: 'read_excel', arguments: { filePath: csvPath, maxRows: 10, outputFormat: 'json' } });
  const parsed = JSON.parse(read.result.content[0].text);
  assertOk(!read.result?.isError && parsed.rowsReturned === 2, 'read_excel mengembalikan dua baris data');

  const search = await request('tools/call', { name: 'search_in_document', arguments: { filePath: csvPath, query: 'Operations', maxResults: 3 } });
  assertOk(!search.result?.isError && search.result?.content?.[0]?.text?.includes('Bima'), 'search_in_document menemukan istilah pada CSV');

  const created = await request('tools/call', { name: 'create_pdf', arguments: { fileName: 'smoke-out.pdf', text: 'Smoke PDF dibuat', overwrite: false } });
  assertOk(!created.result?.isError, 'create_pdf menulis file');
  const createdRead = await request('tools/call', { name: 'read_pdf', arguments: { filePath: path.join(temp, 'smoke-out.pdf'), startPage: 1, maxChars: 2000 } });
  assertOk(!createdRead.result?.isError && createdRead.result.content[0].text.includes('Smoke PDF dibuat'), 'read_pdf membaca hasil create_pdf');

  const converted = await request('tools/call', { name: 'convert_document', arguments: { sourcePath: csvPath, fileName: 'smoke-converted.pdf', targetFormat: 'pdf', overwrite: false } });
  assertOk(!converted.result?.isError, 'convert_document CSV→PDF');

  console.log('\nSMOKE TEST LULUS. handshake, tools, metadata, CSV read, search, create_pdf, dan convert berjalan.');
} catch (error) {
  console.error('\nSMOKE TEST GAGAL:', error instanceof Error ? error.message : String(error));
  if (stderrBuffer) console.error('\nServer STDERR (bagian akhir):\n', stderrBuffer.slice(-5000));
  process.exitCode = 1;
} finally {
  if (child.exitCode === null && child.signalCode === null) {
    const exited = new Promise((resolve) => child.once('exit', resolve));
    child.kill('SIGTERM');
    const didExit = await Promise.race([exited.then(() => true), new Promise((resolve) => setTimeout(() => resolve(false), 3_000))]);
    if (!didExit && child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  }
  await rm(temp, { recursive: true, force: true });
}
