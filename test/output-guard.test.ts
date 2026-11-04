import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { initializeAllowedOutputRoots, resolveOutputFile } from "../src/security/output-guard.js";

let dir: string;
test.before(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "oguard-"));
  await writeFile(path.join(dir, "ada.txt"), "x", "utf8");
});
test.after(async () => { if (dir) await rm(dir, { recursive: true, force: true }); });

test("initializeAllowedOutputRoots me-resolve canonical direktori", async () => {
  const roots = await initializeAllowedOutputRoots([dir]);
  assert.ok(roots.length === 1);
  assert.ok(roots[0] === path.resolve(dir));
});

test("initializeAllowedOutputRoots menolak path yang tidak ada", async () => {
  await assert.rejects(() => initializeAllowedOutputRoots([path.join(dir, "tidak-ada")]), /tidak ditemukan|tidak dapat diakses/);
});

test("resolveOutputFile menerima basename valid", async () => {
  const out = await resolveOutputFile("hasil.pdf", [dir], new Set([".pdf"]), false);
  assert.equal(out.canonicalPath, path.join(dir, "hasil.pdf"));
  assert.equal(out.extension, ".pdf");
});

test("resolveOutputFile menolak traversal, absolute, dan path ber-arah", async () => {
  for (const bad of ["../x.pdf", "a/b.pdf", "C:\\x.pdf", "", ".."]) {
    await assert.rejects(() => resolveOutputFile(bad, [dir], new Set([".pdf"]), false), /basename|Nama file output/);
  }
});

test("resolveOutputFile menolak ekstensi di luar izin", async () => {
  await assert.rejects(() => resolveOutputFile("salah.docx", [dir], new Set([".pdf"]), false), /Format output tidak diizinkan/);
});

test("resolveOutputFile menolak menimpa tanpa overwrite; mengizinkan dengan overwrite", async () => {
  await assert.rejects(() => resolveOutputFile("ada.txt", [dir], new Set([".txt"]), false), /sudah ada/);
  const ok = await resolveOutputFile("ada.txt", [dir], new Set([".txt"]), true);
  assert.equal(ok.overwrite, true);
});
