import { createHash, randomUUID } from "node:crypto";
import type { Logger } from "./types";

export const INBOX_READ_LIMIT = 64;
export const INBOX_CHANNEL_BATCH = 16;
export const MAX_EVENT_ATTEMPTS = 12;
export const MAX_ACTIVE_CHANNELS = 8;
const LEASE_SECONDS = 15;

export interface InboxEvent {
  id: string;
  team: string;
  channel: string;
  event: Record<string, any>;
}

export interface FailureResult {
  attempts: number;
  deadLettered: boolean;
  retryAt?: number;
}

export class LeaseLostError extends Error {
  constructor() { super("Redis event-worker lease is no longer owned by this process"); }
}

export interface EventInbox {
  /** Rebuilds disposable scheduler indexes from the durable ordered inbox. */
  prepareInbox(): Promise<void>;
  enqueue(event: InboxEvent): Promise<void>;
  /** Ordered diagnostic view; workers use readyEvents/channelEvents. */
  pendingEvents(limit?: number): Promise<InboxEvent[]>;
  readyEvents(limit?: number): Promise<InboxEvent[]>;
  channelEvents(head: InboxEvent, limit?: number): Promise<InboxEvent[]>;
  completeEvent(event: InboxEvent, owner: string): Promise<void>;
  failEvent(event: InboxEvent, reason: string, maxAttempts: number, owner: string): Promise<FailureResult>;
  acquireLease(owner: string, ttlSeconds: number): Promise<boolean>;
  renewLease(owner: string, ttlSeconds: number): Promise<boolean>;
  releaseLease(owner: string): Promise<void>;
}

export function inboxEvent(team: string, eventId: string, event: Record<string, any>): InboxEvent {
  // message and app_mention callbacks for the same message have different event IDs.
  const key = ["message", "app_mention"].includes(event.type)
    ? [team, event.channel, event.ts] : [team, eventId];
  return { id: createHash("sha256").update(JSON.stringify(key)).digest("hex"),
    team, channel: event.channel || "users", event };
}

/** Stable, Redis-safe identity for one ordered channel queue. */
export function inboxChannelKey(event: Pick<InboxEvent, "team" | "channel">): string {
  return createHash("sha256").update(JSON.stringify([event.team, event.channel])).digest("hex");
}

/** A leased worker retains uncompleted events in Redis across process restarts. */
export class InboxWorker {
  private timer?: NodeJS.Timeout;
  private leaseTimer?: NodeJS.Timeout;
  private active = new Map<string, Promise<void>>();
  private polling?: Promise<void>;
  private quiescing = false;
  private completed = new Set<string>();
  private retries = new Map<string, { attempts: number; after: number }>();
  private readonly leaseOwner = randomUUID();
  private ownsLease = false;
  private leaseLost = false;
  private leaseExpiresAt = 0;

  constructor(private readonly storage: EventInbox,
    private readonly process: (event: InboxEvent) => Promise<void>,
    private readonly save: () => Promise<void>, private readonly logger: Logger,
    private readonly onLeaseLost: () => void = () => {}) {}

  get leaseToken(): string { return this.leaseOwner; }
  get hasLease(): boolean { return this.ownsLease && !this.leaseLost; }

  async acquire(): Promise<boolean> {
    if (this.quiescing) return false;
    this.ownsLease = await this.storage.acquireLease(this.leaseOwner, LEASE_SECONDS);
    if (this.ownsLease) this.leaseExpiresAt = Date.now() + LEASE_SECONDS * 1000;
    if (this.ownsLease && !this.leaseTimer) {
      // Startup and graceful shutdown can both exceed one lease TTL.
      this.leaseTimer = setInterval(() => { void this.renewLease(); }, 5000);
      this.leaseTimer.unref();
    }
    return this.ownsLease;
  }

  async confirmLease(): Promise<boolean> {
    if (!this.hasLease) return false;
    const renewed = await this.storage.renewLease(this.leaseOwner, LEASE_SECONDS);
    // A concurrent lease check may have already established that ownership
    // was lost while this request was in flight.
    if (!this.hasLease) return false;
    this.ownsLease = renewed;
    this.leaseExpiresAt = this.ownsLease ? Date.now() + LEASE_SECONDS * 1000 : 0;
    return this.ownsLease;
  }

  start(): void {
    if (this.quiescing) throw new Error("Cannot restart a stopped event worker");
    if (!this.ownsLease) throw new Error("Cannot start event worker without the Redis lease");
    this.timer = setInterval(() => { void this.tick(); }, 250);
    this.timer.unref();
    void this.tick();
  }

  private async renewLease(): Promise<void> {
    // Quiescing stops new work, not lease protection. The lease is renewed
    // until release(), after active work and the final brain save complete.
    if (!this.ownsLease) return;
    try {
      if (await this.confirmLease()) return;
      this.logger.error("Event worker lost its Redis lease; stopping event processing");
    } catch (error) {
      this.logger.error("Cannot renew event worker Redis lease; stopping event processing", error);
    }
    this.markLeaseLost();
  }

  private markLeaseLost(): void {
    if (this.leaseLost) return;
    this.leaseLost = true;
    this.ownsLease = false;
    this.leaseExpiresAt = 0;
    this.quiescing = true;
    if (this.timer) clearInterval(this.timer);
    if (this.leaseTimer) clearInterval(this.leaseTimer);
    this.onLeaseLost();
  }

  async tick(): Promise<void> {
    if (this.quiescing || !this.ownsLease) return;
    if (this.polling) return this.polling;
    this.polling = (async () => {
      // Revalidate before taking a batch if an event-loop pause consumed most
      // of the lease. A successor may have acquired an expired lease meanwhile.
      if (this.leaseExpiresAt - Date.now() < 5000) await this.renewLease();
      if (!this.ownsLease || this.quiescing) return;
      let available = MAX_ACTIVE_CHANNELS - this.active.size;
      if (available <= 0) return;
      const heads = await this.storage.readyEvents(INBOX_READ_LIMIT);
      for (const head of heads) {
        if (!this.hasLease || this.quiescing) break;
        const channel = inboxChannelKey(head);
        if (available <= 0) break;
        if (this.active.has(channel)) continue;
        // Redis normally removes failed heads from the ready set. This local
        // guard also prevents a hot loop if persisting that retry failed.
        if ((this.retries.get(head.id)?.after ?? 0) > Date.now()) continue;
        const items = await this.storage.channelEvents(head, INBOX_CHANNEL_BATCH);
        if (!this.hasLease || this.quiescing) break;
        if (!items.length) continue;
        const task = this.runBatch(items).finally(() => {
          this.active.delete(channel);
          // Drain ready work immediately instead of limiting it to the poll rate.
          setImmediate(() => { void this.tick(); });
        });
        this.active.set(channel, task);
        available--;
      }
    })().catch(error => this.logger.error("Cannot read event inbox", error))
      .finally(() => { this.polling = undefined; });
    return this.polling;
  }

  private async runBatch(items: InboxEvent[]): Promise<void> {
    const succeeded: InboxEvent[] = [];
    let failed: { item: InboxEvent; error: unknown } | undefined;
    for (const item of items) {
      if (!this.hasLease) return;
      if (this.completed.has(item.id)) {
        succeeded.push(item);
        continue;
      }
      try {
        await this.process(item);
        if (!this.hasLease) return;
        this.completed.add(item.id);
        succeeded.push(item);
      } catch (error) {
        failed = { item, error };
        break;
      }
    }

    if (succeeded.length) {
      if (!this.hasLease) return;
      try {
        // One durable snapshot covers the successful ordered batch.
        await this.save();
      } catch (error) {
        if (error instanceof LeaseLostError) { this.markLeaseLost(); return; }
        // The first item remains the queue head; retrying only that head avoids
        // corrupting channel order while all completed callbacks stay cached.
        await this.recordFailure(succeeded[0], error);
        return;
      }
      for (const item of succeeded) {
        if (!this.hasLease) return;
        try {
          await this.storage.completeEvent(item, this.leaseOwner);
          this.completed.delete(item.id);
          this.retries.delete(item.id);
        } catch (error) {
          if (error instanceof LeaseLostError) { this.markLeaseLost(); return; }
          await this.recordFailure(item, error);
          // Keep later completed items pending so their Redis ordering remains intact.
          break;
        }
      }
    }
    if (failed && this.hasLease) await this.recordFailure(failed.item, failed.error);
  }

  private async recordFailure(item: InboxEvent, error: unknown): Promise<void> {
    if (!this.hasLease) return;
    const reason = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    let attempts = (this.retries.get(item.id)?.attempts ?? 0) + 1;
    let after = Date.now() + Math.min(5000 * 2 ** Math.min(attempts - 1, 6), 300000);
    try {
      const result = await this.storage.failEvent(item, reason.slice(0, 1000), MAX_EVENT_ATTEMPTS, this.leaseOwner);
      attempts = result.attempts || attempts;
      after = result.retryAt ?? after;
      if (result.deadLettered) {
        this.completed.delete(item.id);
        this.retries.delete(item.id);
        this.logger.error(`Event ${item.id} moved to the dead-letter inbox after ${attempts} attempts`, error);
        return;
      }
    } catch (storageError) {
      if (storageError instanceof LeaseLostError) { this.markLeaseLost(); return; }
      this.logger.error(`Cannot persist retry state for event ${item.id}`, storageError);
    }
    this.retries.set(item.id, { attempts, after });
    this.logger.error(`Event ${item.id} retained for retry (attempt ${attempts}/${MAX_EVENT_ATTEMPTS})`, error);
  }

  /** Used by offline tests and graceful shutdown; failed items stay in Redis. */
  async settle(): Promise<void> {
    await this.polling;
    await Promise.all(this.active.values());
  }

  /** Stop accepting new batches while retaining and renewing the lease. */
  async quiesce(): Promise<void> {
    this.quiescing = true;
    if (this.timer) clearInterval(this.timer);
    await this.settle();
  }

  async release(): Promise<void> {
    if (this.leaseTimer) {
      clearInterval(this.leaseTimer);
      this.leaseTimer = undefined;
    }
    if (!this.ownsLease) return;
    try { await this.storage.releaseLease(this.leaseOwner); }
    finally { this.ownsLease = false; this.leaseExpiresAt = 0; }
  }

  async stop(releaseLease = true): Promise<void> {
    await this.quiesce();
    if (releaseLease) {
      try { await this.release(); }
      catch (error) { this.logger.error("Cannot release event worker Redis lease", error); }
    }
  }
}
