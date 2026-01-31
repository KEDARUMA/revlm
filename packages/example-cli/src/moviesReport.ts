import type * as RevlmCompat from "@kedaruma/revlm-client/revlm-compat";
import type { MoviesCombined } from "./types/moviesCombinedTypes.js";

// CLI movie report for the `movies_combined` dataset.
// `movies_combined` データセット向けのCLIレポート。

type MoviesDoc = MoviesCombined & { _id: unknown };
type YearRangeRow = { minYear?: number | null; maxYear?: number | null };
type CountRow = { n?: number };
type TopValueRow = { _id?: string | null; n?: number };
type TextSearchRow = MoviesDoc & { score?: number };

// Simple ANSI helpers.
// 簡易ANSIヘルパー。
const ANSI = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  yellow: "\x1b[33m",
  green: "\x1b[32m",
  blue: "\x1b[34m",
  red: "\x1b[31m",
} as const;

function heading(color: string, emoji: string, title: string) {
  // eslint-disable-next-line no-console
  console.log(`${ANSI.bold}${color}${emoji} ${title}${ANSI.reset}`);
}

function truncate40(s: unknown): string {
  if (typeof s !== "string") return "";
  const t = s.replace(/\s+/g, " ").trim();
  if (t.length <= 40) return t;
  return t.slice(0, 40) + "...";
}

function coerceYear(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number(v.trim());
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function yearExpr() {
  return {
    $convert: {
      input: "$year",
      to: "int",
      onError: null,
      onNull: null,
    },
  };
}

async function loadYearRange(
  coll: RevlmCompat.Services.MongoDB.MongoDBCollection<MoviesDoc>
): Promise<{ minYear: number | null; maxYear: number | null }> {
  const rows = (await coll.aggregate([
    { $addFields: { yearNum: yearExpr() } },
    { $match: { yearNum: { $ne: null } } },
    { $group: { _id: null, minYear: { $min: "$yearNum" }, maxYear: { $max: "$yearNum" } } },
  ])) as YearRangeRow[];
  const first = rows && rows[0] ? rows[0] : null;
  return {
    minYear: coerceYear(first?.minYear),
    maxYear: coerceYear(first?.maxYear),
  };
}

async function countInYearWindow(
  coll: RevlmCompat.Services.MongoDB.MongoDBCollection<MoviesDoc>,
  fromYear: number,
  toYear: number
): Promise<number> {
  const rows = (await coll.aggregate([
    { $addFields: { yearNum: yearExpr() } },
    { $match: { yearNum: { $gte: fromYear, $lte: toYear } } },
    { $count: "n" },
  ])) as CountRow[];
  return Number(rows?.[0]?.n || 0);
}

async function countForYear(
  coll: RevlmCompat.Services.MongoDB.MongoDBCollection<MoviesDoc>,
  year: number
): Promise<number> {
  const rows = (await coll.aggregate([
    { $addFields: { yearNum: yearExpr() } },
    { $match: { yearNum: year } },
    { $count: "n" },
  ])) as CountRow[];
  return Number(rows?.[0]?.n || 0);
}

async function listMoviesForYear(
  coll: RevlmCompat.Services.MongoDB.MongoDBCollection<MoviesDoc>,
  year: number,
  limit: number
): Promise<MoviesDoc[]> {
  const rows = (await coll.aggregate([
    { $addFields: { yearNum: yearExpr() } },
    { $match: { yearNum: year } },
    { $sort: { title: 1 } },
    { $limit: limit },
    { $project: { year: 1, title: 1, description: 1 } },
  ])) as MoviesDoc[];
  return rows || [];
}

async function topValues(
  coll: RevlmCompat.Services.MongoDB.MongoDBCollection<MoviesDoc>,
  field: "genre" | "category",
  limit: number
): Promise<Array<{ key: string; count: number }>> {
  const rows = (await coll.aggregate([
    { $match: { [field]: { $nin: [null, ""] } } },
    { $group: { _id: `$${field}`, n: { $sum: 1 } } },
    { $sort: { n: -1 } },
    { $limit: limit },
  ])) as TopValueRow[];
  return (rows || [])
    .map((r) => ({ key: String(r?._id ?? ""), count: Number(r?.n || 0) }))
    .filter((r) => r.key);
}

async function topMoviesForValue(
  coll: RevlmCompat.Services.MongoDB.MongoDBCollection<MoviesDoc>,
  field: "genre" | "category",
  value: string,
  limit: number
): Promise<MoviesDoc[]> {
  const rows = (await coll.aggregate([
    { $match: { [field]: value } },
    { $addFields: { yearNum: yearExpr() } },
    { $sort: { yearNum: -1, title: 1 } },
    { $limit: limit },
    { $project: { year: 1, title: 1, description: 1 } },
  ])) as MoviesDoc[];
  return rows || [];
}

async function textSearch(
  coll: RevlmCompat.Services.MongoDB.MongoDBCollection<MoviesDoc>,
  query: string,
  limit: number
): Promise<MoviesDoc[]> {
  const rows = (await coll.aggregate([
    { $match: { $text: { $search: query } } },
    { $addFields: { score: { $meta: "textScore" }, yearNum: yearExpr() } },
    { $sort: { score: -1, yearNum: -1 } },
    { $limit: limit },
    { $project: { year: 1, title: 1, description: 1, score: 1 } },
  ])) as TextSearchRow[];
  return rows || [];
}

function printMovieList(rows: MoviesDoc[]) {
  for (const r of rows) {
    const year = r.year ?? "";
    const title = r.title ?? "";
    const desc = truncate40(r.description);
    // eslint-disable-next-line no-console
    console.log(`- ${year}  ${title}  ${desc}`);
  }
}

export async function printMoviesReport(
  revlm: RevlmCompat.Revlm,
  usersDbName: string
): Promise<void> {
  // We store the dataset in the same DB name (`revlm`) as the example users DB by design.
  // データセットは設計上 usersDbName と同じDBに格納している。
  const coll: RevlmCompat.Services.MongoDB.MongoDBCollection<MoviesDoc> =
    revlm.db(usersDbName).collection<MoviesDoc>("movies_combined");

  // 0) Summary
  // 0) 全体サマリ
  heading(ANSI.cyan, "📽️", "movies_combined summary");
  const total = await coll.count({});
  const { minYear, maxYear } = await loadYearRange(coll);
  // eslint-disable-next-line no-console
  console.log(`total: ${total}`);
  // eslint-disable-next-line no-console
  console.log(`year range: ${minYear ?? "?"} - ${maxYear ?? "?"}`);
  // eslint-disable-next-line no-console
  console.log("");

  if (maxYear == null) {
    heading(ANSI.red, "⚠️", "cannot compute recent-10y window (year is missing)");
    // eslint-disable-next-line no-console
    console.log("");
    return;
  }

  // 1) Recent 10 years (maxYear based)
  // 1) 直近10年（maxYear基準）
  const fromYear = maxYear - 9;
  const toYear = maxYear;
  heading(ANSI.magenta, "🗓️", `recent 10 years (${fromYear}-${toYear})`);
  const recentCount = await countInYearWindow(coll, fromYear, toYear);
  // eslint-disable-next-line no-console
  console.log(`count: ${recentCount}`);
  for (let y = toYear; y >= fromYear; y--) {
    const yearCount = await countForYear(coll, y);
    if (yearCount === 0) continue;
    // eslint-disable-next-line no-console
    console.log(`${ANSI.bold}${y}${ANSI.reset} (${yearCount})`);
    const top5 = await listMoviesForYear(coll, y, 5);
    printMovieList(top5);
  }
  // eslint-disable-next-line no-console
  console.log("");

  // 2) Genre ranking (Top 10, each show 3 movies)
  // 2) ジャンルランキング（Top10、各3件表示）
  heading(ANSI.yellow, "🏷️", "genre ranking (top 10, show 3)");
  const topGenres = await topValues(coll, "genre", 10);
  for (const [i, g] of topGenres.entries()) {
    // eslint-disable-next-line no-console
    console.log(`${ANSI.bold}${i + 1}. ${g.key}${ANSI.reset} (${g.count})`);
    const movies = await topMoviesForValue(coll, "genre", g.key, 3);
    printMovieList(movies);
  }
  // eslint-disable-next-line no-console
  console.log("");

  // 3) Category ranking (Top 10, each show 3 movies)
  // 3) カテゴリランキング（Top10、各3件表示）
  heading(ANSI.green, "📚", "category ranking (top 10, show 3)");
  const topCategories = await topValues(coll, "category", 10);
  for (const [i, c] of topCategories.entries()) {
    // eslint-disable-next-line no-console
    console.log(`${ANSI.bold}${i + 1}. ${c.key}${ANSI.reset} (${c.count})`);
    const movies = await topMoviesForValue(coll, "category", c.key, 3);
    printMovieList(movies);
  }
  // eslint-disable-next-line no-console
  console.log("");

  // 4) Text searches
  // 4) 文字列検索（全文検索）
  heading(ANSI.blue, "🔎", "text searches (top 10 each)");
  const queries: Array<{ label: string; q: string }> = [
    { label: "Star Wars", q: "\"Star Wars\" star wars" },
    { label: "Indiana Jones", q: "\"Indiana Jones\" indiana jones" },
    { label: "James Bond", q: "\"James Bond\" 007 bond" },
  ];
  for (const it of queries) {
    // eslint-disable-next-line no-console
    console.log(`${ANSI.bold}${it.label}${ANSI.reset}`);
    try {
      const rows = await textSearch(coll, it.q, 10);
      printMovieList(rows);
    } catch (e: unknown) {
      // If the text index is missing, MongoDB will throw.
      // text index が無い場合などはMongoDBがエラーを返す。
      const msg = e instanceof Error ? e.message : String(e);
      // eslint-disable-next-line no-console
      console.error(
        `[text search failed] ${it.label}: ${msg}. If this is about missing text index, run: pnpm --filter @kedaruma/example-server reset-data`
      );
    }
  }
}
