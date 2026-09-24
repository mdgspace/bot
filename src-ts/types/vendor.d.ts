// Ambient declarations for untyped third-party dependencies.
// Only the API surface actually used by src-ts is declared.

declare module "follow-redirects" {
  export const https: typeof import("https");
  export const http: typeof import("http");
}

declare module "moment" {
  interface Moment {
    format(format?: string): string;
  }
  function moment(input?: string | Date, format?: string): Moment;
  export = moment;
}

declare module "node-cron" {
  /** Schedules `fn` per the cron expression; returns the scheduled task. */
  export function schedule(expression: string, fn: () => void): unknown;
}

declare module "natural/lib/natural/tokenizers/regexp_tokenizer" {
  export class WordTokenizer {
    tokenize(text: string): string[];
  }
}

declare module "node-time-ago" {
  function timeago(date: Date): string;
  export = timeago;
}
