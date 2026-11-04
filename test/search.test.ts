import assert from "node:assert/strict";
import test from "node:test";
import { rankMatches } from "../src/utils/search.js";

test("search ranks exact phrase above all-token matches", () => {
  const matches = rankMatches([
    { location: "Halaman 1", text: "Metode penelitian digunakan dalam studi ini." },
    { location: "Halaman 2", text: "Penelitian ini menggunakan metode campuran." },
  ], "metode penelitian", 5);
  assert.equal(matches.length, 2);
  assert.equal(matches[0]?.location, "Halaman 1");
  assert.ok(matches[0]!.score > matches[1]!.score);
});

test("multi-word search requires every term in the same unit", () => {
  const matches = rankMatches([
    { location: "Paragraf 1", text: "Metode penelitian digunakan." },
    { location: "Paragraf 2", text: "Metode yang digunakan dalam analisis." },
    { location: "Paragraf 3", text: "Penelitian dilakukan pada sampel." },
  ], "metode penelitian", 5);
  assert.deepEqual(matches.map((match) => match.location), ["Paragraf 1"]);
});
