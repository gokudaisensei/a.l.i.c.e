import type { Db } from "./client";

/** A database or an open transaction; both expose the same query API. */
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
export type DbLike = Db | Tx;
