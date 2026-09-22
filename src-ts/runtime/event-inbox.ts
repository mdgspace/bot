import { createHash, randomUUID } from "node:crypto";
import type { Logger } from "./types";

export const INBOX_READ_LIMIT = 64;
export const INBOX_CHANNEL_BATCH = 16;
export const MAX_EVENT_ATTEMPTS = 12;
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
}

export interface EventInbox {
  enqueue(event: InboxEvent): Promise<void>;
  pendingEvents(limit?: number): Promise<InboxEvent[]>;
  completeEvent(id: string): Promise<void>;
  failEvent(id: string, reason: string, maxAttempts: number): Promise<FailureResult>;
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

/** A leased worker retains uncompleted events in Redis across process restarts. */
export class InboxWorker {
  private timer?: NodeJS.Timeout;
  private leaseTimer?: NodeJS.Timeout;
  private active = new Map<string, Promise<void>>();
  private polling?: Promise<void>;
  private stopped = false;
  private completed = new Set<string>();
  private retries = new Map<string, { attempts: number; after: number }>();
  private readonly leaseOwner = randomUUID();
  private ownsLease = false;
  private leaseExpiresAt = 0;

  constructor(private readonly storage: EventInbox,
    private readonly process: (event: InboxEvent) => Promise<void>,
    private readonly save: () => Promise<void>, private readonly logger: Logger,
    private readonly onLeaseLost: () => void = () => {}) {}

  async acquire(): Promise<boolean> {
    if (this.stopped) return false;
    this.ownsLease = await this.storage.acquireLease(this.leaseOwner, LEASE_SECONDS);
    if (this.ownsLease) this.leaseExpiresAt = Date.now() + LEASE_SECONDS * 1000;
    if (this.ownsLease && !this.leaseTimer) {
      // Directory loading can exceed one lease TTL in a large workspace.
      this.leaseTimer = setInterval(() => { void this.renewLease(); }, 5000);
      this.leaseTimer.unref();
    }
    return this.ownsLease;
  }

  async confirmLease(): Promise<boolean> {
    if (!this.ownsLease) return false;
    this.ownsLease = await this.storage.renewLease(this.leaseOwner, LEASE_SECONDS);
    this.leaseExpiresAt = this.ownsLease ? Date.now() + LEASE_SECONDS * 1000 : 0;
    return this.ownsLease;
  }

  start(): void {
    if (!this.ownsLease) throw new Error("Cannot start event worker without the Redis lease");
    this.timer = setInterval(() => { void this.tick(); }, 250);
    this.timer.unref();
    void this.tick();
  }

  private async renewLease(): Promise<void> {
    if (this.stopped || !this.ownsLease) return;
    try {
      if (await this.confirmLease()) return;
      this.logger.error("Event worker lost its Redis lease; stopping event processing");
    } catch (error) {
      this.logger.error("Cannot renew event worker Redis lease; stopping event processing", error);
    }
    this.ownsLease = false;
    this.leaseExpiresAt = 0;
    if (this.timer) clearInterval(this.timer);
    this.onLeaseLost();
  }

  async tick(): Promise<void> {
    if (this.stopped || !this.ownsLease) return;
    if (this.polling) return this.polling;
    this.polling = (async () => {
      // Revalidate before taking a batch if an event-loop pause consumed most
      // of the lease. A successor may have acquired an expired lease meanwhile.
      if (this.leaseExpiresAt - Date.now() < 5000) await this.renewLease();
      if (!this.ownsLease) return;
      const events = await this.storage.pendingEvents(INBOX_READ_LIMIT);
      const groups = new Map<string, InboxEvent[]>();
      const blocked = new Set<string>();
      for (const item of events) {
        const channel = `${item.team}:${item.channel}`;
        if (blocked.has(channel) || this.active.has(channel)) continue;
        const group = groups.get(channel);
        if (group) {
          if (group.length < INBOX_CHANNEL_BATCH) group.push(item);
          continue;
        }
        // A failed head item blocks later items for the same channel.
        if ((this.retries.get(item.id)?.after ?? 0) > Date.now()) {
          blocked.add(channel);
          continue;
        }
        if (groups.size < 8) groups.set(channel, [item]);
      }
      for (const [channel, items] of groups) {
        const task = this.runBatch(items).finally(() => {
          this.active.delete(channel);
          // Drain ready work immediately instead of limiting it to the poll rate.
          setImmediate(() => { void this.tick(); });
        });
        this.active.set(channel, task);
      }
    })().catch(error => this.logger.error("Cannot read event inbox", error))
      .finally(() => { this.polling = undefined; });
    return this.polling;
  }

  private async runBatch(items: InboxEvent[]): Promise<void> {
    const succeeded: InboxEvent[] = [];
    let failed: { item: InboxEvent; error: unknown } | undefined;
    for (const item of items) {
      if (this.completed.has(item.id)) {
        succeeded.push(item);
        continue;
      }
      try {
        await this.process(item);
        this.completed.add(item.id);
        succeeded.push(item);
      } catch (error) {
        failed = { item, error };
        break;
      }
    }

    if (succeeded.length) {
      try {
        // One durable snapshot covers the successful ordered batch.
        await this.save();
      } catch (error) {
        for (const item of succeeded) await this.recordFailure(item, error);
        return;
      }
      for (const item of succeeded) {
        try {
          await this.storage.completeEvent(item.id);
          this.completed.delete(item.id);
          this.retries.delete(item.id);
        } catch (error) {
          await this.recordFailure(item, error);
          // Keep later completed items pending so their Redis ordering remains intact.
          break;
        }
      }
    }
    if (failed) await this.recordFailure(failed.item, failed.error);
  }

  private async recordFailure(item: InboxEvent, error: unknown): Promise<void> {
    const reason = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    let attempts = (this.retries.get(item.id)?.attempts ?? 0) + 1;
    try {
      const result = await this.storage.failEvent(item.id, reason.slice(0, 1000), MAX_EVENT_ATTEMPTS);
      attempts = result.attempts || attempts;
      if (result.deadLettered) {
        this.completed.delete(item.id);
        this.retries.delete(item.id);
        this.logger.error(`Event ${item.id} moved to the dead-letter inbox after ${attempts} attempts`, error);
        return;
      }
    } catch (storageError) {
      this.logger.error(`Cannot persist retry state for event ${item.id}`, storageError);
    }
    this.retries.set(item.id, {
      attempts,
      after: Date.now() + Math.min(5000 * 2 ** Math.min(attempts - 1, 6), 300000),
    });
    this.logger.error(`Event ${item.id} retained for retry (attempt ${attempts}/${MAX_EVENT_ATTEMPTS})`, error);
  }

  /** Used by offline tests and graceful shutdown; failed items stay in Redis. */
  async settle(): Promise<void> {
    await this.polling;
    await Promise.all(this.active.values());
  }

  async release(): Promise<void> {
    if (!this.ownsLease) return;
    try { await this.storage.releaseLease(this.leaseOwner); }
    finally { this.ownsLease = false; this.leaseExpiresAt = 0; }
  }

  async stop(releaseLease = true): Promise<void> {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    if (this.leaseTimer) clearInterval(this.leaseTimer);
    await this.settle();
    if (releaseLease) {
      try { await this.release(); }
      catch (error) { this.logger.error("Cannot release event worker Redis lease", error); }
    }
  }
}
