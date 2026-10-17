import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { itemsToTable, itemsToText } from "./pdfText.ts";

// index.ts deliberately inlines the pdfText.ts implementation so the edge
// function stays a single-file deploy. These helpers assert the guarded copies
// never drift apart.
function markedBlock(source, name) {
  const start = source.indexOf(`// >>> ${name}`);
  const end = source.indexOf(`// <<< ${name}`);
  assert.ok(start !== -1 && end > start, `${name} markers are missing`);
  // Compare ignoring whitespace so CRLF vs LF and formatting do not matter.
  return source.slice(start, end).replace(/\s+/g, " ").trim();
}

function assertInlineCopy(name) {
  const here = dirname(fileURLToPath(import.meta.url));
  const module = markedBlock(readFileSync(join(here, "pdfText.ts"), "utf8"), name);
  const edgeFunction = markedBlock(readFileSync(join(here, "index.ts"), "utf8"), name);
  assert.equal(
    edgeFunction,
    module,
    `index.ts and pdfText.ts copies of ${name} have drifted apart — update both`,
  );
}

test("rebuilds a PDF row with a space between every table column", () => {
  const items = [
    { str: "06/08/2026", transform: [1, 0, 0, 10, 40, 700], width: 55, height: 10 },
    { str: "POS PURCHASE", transform: [1, 0, 0, 10, 110, 700], width: 90, height: 10 },
    { str: "10,000.00", transform: [1, 0, 0, 10, 330, 700], width: 50, height: 10 },
    { str: "690,000.00", transform: [1, 0, 0, 10, 400, 700], width: 60, height: 10, hasEOL: true },
    { str: "07/08/2026", transform: [1, 0, 0, 10, 40, 690], width: 55, height: 10 },
    { str: "SALARY", transform: [1, 0, 0, 10, 110, 690], width: 40, height: 10 },
    { str: "250,000.00", transform: [1, 0, 0, 10, 330, 690], width: 50, height: 10, hasEOL: true },
  ];

  assert.equal(
    itemsToText(items),
    "06/08/2026 POS PURCHASE 10,000.00 690,000.00\n07/08/2026 SALARY 250,000.00",
  );
});

test("keeps runs that continue the same word glued together", () => {
  const items = [
    { str: "5,00", transform: [1, 0, 0, 10, 100, 700], width: 20, height: 10 },
    { str: "0.00", transform: [1, 0, 0, 10, 120.2, 700], width: 20, height: 10 },
  ];

  assert.equal(itemsToText(items), "5,000.00");
});

test("orders rows top-to-bottom and items left-to-right", () => {
  const items = [
    { str: "B", transform: [1, 0, 0, 10, 200, 600], width: 10, height: 10 },
    { str: "A", transform: [1, 0, 0, 10, 40, 600], width: 10, height: 10 },
    { str: "SECOND", transform: [1, 0, 0, 10, 40, 700], width: 40, height: 10 },
  ];

  assert.equal(itemsToText(items), "SECOND\nA B");
});

test("returns an empty string for no usable items", () => {
  assert.equal(itemsToText([]), "");
  assert.equal(itemsToText([{ str: "" }, {}]), "");
});

test("builds a table with header-anchored columns and right-aligned amounts", () => {
  const items = [
    { str: "Date", transform: [1, 0, 0, 10, 40, 700], width: 22, height: 10 },
    { str: "Description", transform: [1, 0, 0, 10, 110, 700], width: 55, height: 10 },
    { str: "Debit", transform: [1, 0, 0, 10, 330, 700], width: 25, height: 10 },
    { str: "Credit", transform: [1, 0, 0, 10, 400, 700], width: 28, height: 10 },
    { str: "Balance", transform: [1, 0, 0, 10, 470, 700], width: 38, height: 10, hasEOL: true },

    { str: "06/08/2026", transform: [1, 0, 0, 10, 40, 690], width: 52, height: 10 },
    { str: "POS PURCHASE", transform: [1, 0, 0, 10, 110, 690], width: 70, height: 10 },
    { str: "10,000.00", transform: [1, 0, 0, 10, 330, 690], width: 48, height: 10 },
    { str: "690,000.00", transform: [1, 0, 0, 10, 476, 690], width: 54, height: 10, hasEOL: true },

    { str: "07/08/2026", transform: [1, 0, 0, 10, 40, 680], width: 52, height: 10 },
    { str: "SALARY", transform: [1, 0, 0, 10, 110, 680], width: 35, height: 10 },
    { str: "250,000.00", transform: [1, 0, 0, 10, 396, 680], width: 54, height: 10 },
    { str: "940,000.00", transform: [1, 0, 0, 10, 470, 680], width: 56, height: 10, hasEOL: true },
  ];

  assert.deepEqual(itemsToTable(items), [
    ["Date", "Description", "Debit", "Credit", "Balance"],
    ["06/08/2026", "POS PURCHASE", "10,000.00", "", "690,000.00"],
    ["07/08/2026", "SALARY", "", "250,000.00", "940,000.00"],
  ]);
});

test("regroups column-grouped items by position, not arrival order", () => {
  // The same table as above but emitted column-by-column (the way a
  // column-grouped PDF export scrambles the items).
  const items = [
    { str: "Date", transform: [1, 0, 0, 10, 40, 700], width: 22, height: 10 },
    { str: "06/08/2026", transform: [1, 0, 0, 10, 40, 690], width: 52, height: 10 },
    { str: "07/08/2026", transform: [1, 0, 0, 10, 40, 680], width: 52, height: 10 },
    { str: "Description", transform: [1, 0, 0, 10, 110, 700], width: 55, height: 10 },
    { str: "POS PURCHASE", transform: [1, 0, 0, 10, 110, 690], width: 70, height: 10 },
    { str: "SALARY", transform: [1, 0, 0, 10, 110, 680], width: 35, height: 10 },
    { str: "Debit", transform: [1, 0, 0, 10, 330, 700], width: 25, height: 10 },
    { str: "10,000.00", transform: [1, 0, 0, 10, 330, 690], width: 48, height: 10 },
    { str: "Credit", transform: [1, 0, 0, 10, 400, 700], width: 28, height: 10 },
    { str: "250,000.00", transform: [1, 0, 0, 10, 396, 680], width: 54, height: 10 },
    { str: "Balance", transform: [1, 0, 0, 10, 470, 700], width: 38, height: 10 },
    { str: "690,000.00", transform: [1, 0, 0, 10, 476, 690], width: 54, height: 10 },
    { str: "940,000.00", transform: [1, 0, 0, 10, 470, 680], width: 56, height: 10 },
  ];

  assert.deepEqual(itemsToTable(items), [
    ["Date", "Description", "Debit", "Credit", "Balance"],
    ["06/08/2026", "POS PURCHASE", "10,000.00", "", "690,000.00"],
    ["07/08/2026", "SALARY", "", "250,000.00", "940,000.00"],
  ]);
});

test("keeps a wide title row from collapsing the header columns", () => {
  const items = [
    { str: "Moniepoint MFB Limited", transform: [1, 0, 0, 12, 40, 720], width: 210, height: 12 },
    { str: "Date", transform: [1, 0, 0, 10, 40, 700], width: 22, height: 10 },
    { str: "Description", transform: [1, 0, 0, 10, 110, 700], width: 55, height: 10 },
    { str: "Debit", transform: [1, 0, 0, 10, 330, 700], width: 25, height: 10 },
    { str: "Credit", transform: [1, 0, 0, 10, 400, 700], width: 28, height: 10 },
    { str: "Balance", transform: [1, 0, 0, 10, 470, 700], width: 38, height: 10 },
    { str: "06/08/2026", transform: [1, 0, 0, 10, 40, 690], width: 52, height: 10 },
    { str: "POS PURCHASE", transform: [1, 0, 0, 10, 110, 690], width: 70, height: 10 },
    { str: "10,000.00", transform: [1, 0, 0, 10, 330, 690], width: 48, height: 10 },
    { str: "690,000.00", transform: [1, 0, 0, 10, 476, 690], width: 54, height: 10 },
  ];

  const table = itemsToTable(items);
  assert.equal(table[1].length, 5);
  assert.deepEqual(table[1], ["Date", "Description", "Debit", "Credit", "Balance"]);
  assert.deepEqual(table[2], ["06/08/2026", "POS PURCHASE", "10,000.00", "", "690,000.00"]);
});

test("falls back to one cell per row when there is no header", () => {
  const items = [
    { str: "hello world", transform: [1, 0, 0, 10, 40, 700], width: 60, height: 10 },
    { str: "second line", transform: [1, 0, 0, 10, 40, 690], width: 60, height: 10 },
  ];
  assert.deepEqual(itemsToTable(items), [["hello world"], ["second line"]]);
});

test("index.ts inlines an identical copy of itemsToText", () => {
  assertInlineCopy("itemsToText");
});

test("index.ts inlines an identical copy of itemsToTable", () => {
  assertInlineCopy("itemsToTable");
});
