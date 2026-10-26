import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { BenchResult } from "../src/lib/results";
import { summaryTable } from "../src/lib/summary";

function store(
  root: string,
  name: string,
  id: string,
  elapsed: number[],
  error?: string,
): void {
  const result = new BenchResult("tpch/sf1", name, id, root);
  result.iterations = elapsed.map((value) => ({
    elapsed: value,
    rowCount: 1,
    plan: "",
    tasks: 1,
    ...(error && { error }),
  }));
  result.store();
}

test("totals only the queries every engine completed", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "summary-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  store(root, "datafusion", "q1", [10, 30, 20]);
  store(root, "datafusion", "q2", [5]);
  store(root, "datafusion", "q10", [7]);
  store(root, "trino", "q1", [40]);
  store(root, "trino", "q2", [0], "boom");
  store(root, "trino", "q10", [14]);

  assert.equal(
    summaryTable("tpch/sf1", ["datafusion", "trino"], root),
    [
      "=== tpch/sf1: p50 latency per query in ms ===",
      "query     datafusion   trino",
      "q1                20      40",
      "q2                 5  failed",
      "q10                7      14",
      "TOTAL             27      54",
      "vs first       1.00x   2.00x",
      "TOTAL sums the 2 of 3 queries that every column completed.",
    ].join("\n"),
  );
  assert.match(
    summaryTable("tpch/sf1", ["datafusion", "missing"], root),
    /^q1 +20 +-$/m,
  );
  assert.throws(() => summaryTable("tpch/sf10", ["trino"], root), /No stored/);
});
