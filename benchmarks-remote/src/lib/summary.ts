import { compareQueryIds } from "./query-order";
import { BenchResult } from "./results";

/**
 * Tabulates stored p50 latencies of several result sets side by side.
 * TOTAL only sums queries that every result set completed, so engines that
 * fail a query are not rewarded for skipping it.
 */
export function summaryTable(
  dataset: string,
  resultNames: readonly string[],
  testdataRoot?: string,
): string {
  const times = resultNames.map(
    (name) =>
      new Map(
        BenchResult.loadMany(dataset, name, testdataRoot).map((result) => [
          result.id,
          result.representativeTime(),
        ]),
      ),
  );
  const queries = [
    ...new Set(times.flatMap((byQuery) => [...byQuery.keys()])),
  ].sort(compareQueryIds);
  if (queries.length === 0)
    throw new Error(`No stored results found for dataset '${dataset}'`);
  const common = queries.filter((query) =>
    times.every((byQuery) => byQuery.get(query) !== undefined),
  );
  const totals = times.map((byQuery) =>
    common.reduce((sum, query) => sum + byQuery.get(query)!, 0),
  );
  const first = totals[0]!;

  const rows: string[][] = [
    ["query", ...resultNames],
    ...queries.map((query) => [
      query,
      ...times.map((byQuery) => {
        if (!byQuery.has(query)) return "-";
        const time = byQuery.get(query);
        return time === undefined ? "failed" : `${time}`;
      }),
    ]),
    ["TOTAL", ...totals.map(String)],
    [
      "vs first",
      ...totals.map((total) =>
        first > 0 ? `${(total / first).toFixed(2)}x` : "-",
      ),
    ],
  ];
  const widths = rows[0]!.map((_, column) =>
    Math.max(...rows.map((row) => row[column]!.length)),
  );
  const lines = rows.map((row) =>
    row
      .map((cell, column) =>
        column === 0
          ? cell.padEnd(widths[column]!)
          : cell.padStart(widths[column]!),
      )
      .join("  "),
  );
  return [
    `=== ${dataset}: p50 latency per query in ms ===`,
    ...lines,
    `TOTAL sums the ${common.length} of ${queries.length} queries that every column completed.`,
  ].join("\n");
}
