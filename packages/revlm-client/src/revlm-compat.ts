// RevlmCompat provides a "Realm-like" surface for users migrating code.
// It intentionally avoids `declare global` to keep the consuming app's global
// namespace clean and predictable.
//
// RevlmCompat は「Realm っぽい書き味」で移行しやすくするための import 面を提供します。
// `declare global` を避け、利用側の global 名前空間を汚染しない設計です。

import type MdbCollection from "./MdbCollection";
import type {
  AggregatePipelineStage,
  ChangeEvent,
  CountOptions,
  DeleteResult,
  Document,
  Filter,
  FindOneAndModifyOptions,
  FindOneOptions,
  FindOptions,
  InsertManyResult,
  InsertOneResult,
  NewDocument,
  Update,
  UpdateDescription,
  UpdateOptions,
  UpdateResult,
  WatchOptionsFilter,
  WatchOptionsIds,
} from "./Revlm.types";

// Re-export the main runtime APIs so users can choose either:
// - `import { Revlm } from '@kedaruma/revlm-client'` (recommended), or
// - `import { Revlm } from '@kedaruma/revlm-client/revlm-compat'` (compat surface)
//
// メインの実行時APIも再エクスポートします。利用側は以下を選べます：
// - `import { Revlm } from '@kedaruma/revlm-client'`（推奨）
// - `import { Revlm } from '@kedaruma/revlm-client/revlm-compat'`（互換面）
export { Revlm, App, Credentials, MongoDBService, RevlmUser } from "./index";
export type { RevlmOptions, RevlmResponse, RevlmStateStore } from "./Revlm";

// BSON helpers are often used by existing Realm apps; we keep them available here.
// BSON 周りは Realm アプリ既存コードで使われがちなので、互換面でも提供します。
export { BSON, ObjectID, ObjectId } from "./index";

// Also re-export all public types (filter/options/results/etc.) as-is.
// フィルタ/オプション/結果型などの公開型をそのまま再エクスポートします。
export * from "./Revlm.types";

// Official type namespace for "MongoDB Service" APIs, to make usage discoverable.
// This mirrors what some Realm-based apps expect, without forcing a global type.
//
// MongoDB Service API 向けの「公式」型名前空間です。
// Realm 由来の書き味を保ちつつ、global 型を強制しない形にしています。
export namespace Services {
  export namespace MongoDB {
    export type MongoDBCollection<T extends Document = Document> = MdbCollection<T>;

    export type Document<IdType = unknown> = import("./Revlm.types").Document<IdType>;
    export type NewDocument<T extends Document> = import("./Revlm.types").NewDocument<T>;

    // NOTE: Keep aliases "one-way" (imported type -> exported type) to avoid DTS circular refs.
    // 注意: DTS で循環参照にならないよう、import側の別名からエクスポートします。
    export type Filter = import("./Revlm.types").Filter;
    export type Update = import("./Revlm.types").Update;
    export type AggregatePipelineStage = import("./Revlm.types").AggregatePipelineStage;

    export type FindOneOptions = import("./Revlm.types").FindOneOptions;
    export type FindOptions = import("./Revlm.types").FindOptions;
    export type FindOneAndModifyOptions = import("./Revlm.types").FindOneAndModifyOptions;
    export type CountOptions = import("./Revlm.types").CountOptions;
    export type UpdateOptions = import("./Revlm.types").UpdateOptions;

    export type InsertOneResult<IdType> = import("./Revlm.types").InsertOneResult<IdType>;
    export type InsertManyResult<IdType> = import("./Revlm.types").InsertManyResult<IdType>;
    export type DeleteResult = import("./Revlm.types").DeleteResult;
    export type UpdateResult<IdType> = import("./Revlm.types").UpdateResult<IdType>;

    export type ChangeEvent<T extends Document> = import("./Revlm.types").ChangeEvent<T>;
    export type UpdateDescription = import("./Revlm.types").UpdateDescription;
    export type WatchOptionsIds<T extends Document> = import("./Revlm.types").WatchOptionsIds<T>;
    export type WatchOptionsFilter = import("./Revlm.types").WatchOptionsFilter;
  }
}
