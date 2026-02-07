// Type definitions for the `movies_combined` dataset imported by example-server.
// example-server が取り込む `movies_combined` データセットの型定義。
//
// Notes:
// - The upstream CSV has an empty first column name.
// - We keep it as an optional `_raw0` field for traceability.
//
// 注意:
// - 元CSVの先頭カラム名が空文字です。
// - 追跡しやすいよう、`_raw0` として任意フィールドで保持します。

// One document in `revlm.movies_combined`.
// `revlm.movies_combined` の1ドキュメント。
export type MoviesCombined = {
  // Document id from MongoDB.
  // MongoDBのドキュメントID。
  _id: string;

  // Original unnamed first column from the CSV (optional).
  // 元CSVの「名前なし先頭カラム」（任意）。
  _raw0?: string;

  genre?: string;
  category?: string;
  title?: string;

  // The dataset stores `year` as text in CSV; keep it flexible.
  // CSVでは `year` が文字列のため、柔軟に持つ。
  year?: string | number;

  distribution?: string;
  description?: string;
  url?: string;
  cover_photo?: string;
};
