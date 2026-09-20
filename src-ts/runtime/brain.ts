import { EventEmitter } from "node:events";
import type { Brain as ScriptBrain, BrainData, User } from "./types";

function isRecord(value: unknown): value is Record<string, any> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function put<T>(record: Record<string, T>, key: string, value: T): void {
  Object.defineProperty(record, key, {
    value,
    enumerable: true,
    writable: true,
    configurable: true,
  });
}

export class Brain extends EventEmitter implements ScriptBrain {
  data: BrainData = { users: {}, _private: {} };

  restore(serialized: string | null): void {
    const saved: unknown = serialized === null ? {} : JSON.parse(serialized);
    if (
      !isRecord(saved) ||
      (Object.hasOwn(saved, "users") && !isRecord(saved.users)) ||
      (Object.hasOwn(saved, "_private") && !isRecord(saved._private))
    ) {
      throw new Error("Invalid brain data; refusing to replace stored memory");
    }
    for (const user of Object.values(saved.users ?? {})) {
      if (!isRecord(user))
        throw new Error(
          "Invalid brain user; refusing to replace stored memory",
        );
    }
    this.data = { users: {}, _private: {}, ...saved };
    this.emit("loaded", this.data);
  }

  get<T = any>(key: string): T {
    return (
      Object.hasOwn(this.data._private, key)
        ? (this.data._private[key] ?? null)
        : null
    ) as T;
  }

  set<T = any>(key: string, value: T): void {
    put(this.data._private, key, value);
    this.emit("loaded", this.data);
  }

  remove(key: string): void {
    delete this.data._private[key];
  }

  userForId(id: string, options: Partial<User> = {}): User {
    let user = Object.hasOwn(this.data.users, id)
      ? this.data.users[id]
      : undefined;
    if (!user) {
      user = { id, name: id };
      put(this.data.users, id, user);
    }
    // Slack metadata changes must not recreate users and lose roles or counters.
    for (const [key, value] of Object.entries(options)) {
      if (value !== undefined && key !== "id") put(user, key, value);
    }
    return user;
  }

  userForName(name: string): User | null {
    const matches = Object.values(this.data.users).filter(
      (user) => String(user.name ?? "").toLowerCase() === name.toLowerCase(),
    );
    return matches.at(-1) ?? null;
  }

  usersForRawFuzzyName(name: string): User[] {
    return Object.values(this.data.users).filter((user) =>
      String(user.name ?? "")
        .toLowerCase()
        .startsWith(name.toLowerCase()),
    );
  }

  usersForFuzzyName(name: string): User[] {
    const matches = this.usersForRawFuzzyName(name);
    const exact = matches.filter(
      (user) => String(user.name).toLowerCase() === name.toLowerCase(),
    );
    return exact.length ? exact : matches;
  }
}

export interface BrainStorage {
  read(): Promise<string | null>;
  write(serialized: string): Promise<void>;
  close(): Promise<void>;
}

export class BrainPersistence {
  private loaded = false;
  private loading = false;
  private closing?: Promise<void>;
  private interval?: NodeJS.Timeout;
  private writes: Promise<void> = Promise.resolve();

  constructor(
    private readonly brain: Brain,
    private readonly storage: BrainStorage,
    private readonly onError: (error: unknown) => void,
  ) {}

  async load(): Promise<void> {
    if (this.loaded || this.loading || this.closing)
      throw new Error("Brain load already started or storage closed");
    this.loading = true;
    try {
      this.brain.restore(await this.storage.read());
      this.loaded = true;
    } finally {
      this.loading = false;
    }
  }

  start(intervalMs = 5000): void {
    if (!this.loaded || this.closing)
      throw new Error("Load brain before starting autosave");
    if (!Number.isFinite(intervalMs) || intervalMs <= 0)
      throw new Error("Invalid brain save interval");
    if (this.interval) clearInterval(this.interval);
    this.interval = setInterval(() => {
      void this.save().catch(this.onError);
    }, intervalMs);
    this.interval.unref();
  }

  async save(): Promise<void> {
    if (!this.loaded || this.closing)
      throw new Error("Brain storage is not ready for saves");
    return this.enqueueSave();
  }

  private enqueueSave(): Promise<void> {
    const snapshot = JSON.stringify(this.brain.data);
    const write = this.writes.then(() => this.storage.write(snapshot));
    this.writes = write.catch(() => {});
    return write;
  }

  close(): Promise<void> {
    if (!this.closing) {
      if (this.loading)
        return Promise.reject(
          new Error("Wait for brain load before closing storage"),
        );
      if (this.interval) clearInterval(this.interval);
      this.closing = (async () => {
        try {
          if (this.loaded) await this.enqueueSave();
        } finally {
          await this.storage.close();
        }
      })();
    }
    return this.closing;
  }
}
