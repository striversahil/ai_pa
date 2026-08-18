declare interface D1Result<T = any> {
  results: T[];
  success: boolean;
  meta: { changes?: number; last_row_id?: number; duration?: number; size_after?: number; rows_read?: number; rows_written?: number };
}

declare interface D1Database {
  prepare(query: string): D1PreparedStatement;
  batch<T = any>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]>;
  exec(query: string): Promise<D1Result>;
  dump(): Promise<ArrayBuffer>;
  raw(query: string, ...params: unknown[]): Promise<unknown[]>;
}

declare interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = any>(colName?: string): Promise<T | null>;
  run<T = any>(...values: unknown[]): Promise<D1Result<T>>;
  all<T = any>(colName?: string): Promise<D1Result<T>>;
  raw<T = any>(...values: unknown[]): Promise<T[]>;
}

declare const D1Database: any;