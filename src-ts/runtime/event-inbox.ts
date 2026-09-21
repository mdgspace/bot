import { createHash } from "node:crypto";
import type { Logger } from "./types";

export interface InboxEvent {
  id: string;
  team: string;
  channel: string;
  event: Record<string, any>;
}

export interface EventInbox {
  enqueue(event: InboxEvent): Promise<void>;
  pendingEvents(): Promise<InboxEvent[]>;
  completeEvent(id: string): Promise<void>;
}

export function inboxEvent(team: string, eventId: string, event: Record<string, any>): InboxEvent {
  // message and app_mention callbacks for the same message have different event IDs.
  const key = ["message", "app_mention"].includes(event.type)
    ? [team, event.channel, event.ts] : [team, eventId];
  return { id: createHash("sha256").update(JSON.stringify(key)).digest("hex"),
    team, channel: event.channel || "users", event };
}

/** One process owns the legacy brain. Redis retains uncompleted events across restarts. */
export class InboxWorker {
  private timer?: NodeJS.Timeout;
  private active = new Map<string, Promise<void>>();
  private polling?: Promise<void>;
  private stopped = false;
  private completed = new Set<string>();
  private retries = new Map<string, { attempts: number; after: number }>();

  constructor(private readonly storage: EventInbox,
    private readonly process: (event: InboxEvent) => Promise<void>,
    private readonly save: () => Promise<void>, private readonly logger: Logger) {}

  start(): void {
    this.timer = setInterval(() => { void this.tick(); }, 250);
    this.timer.unref();
    void this.tick();
  }

  async tick(): Promise<void> {
    if (this.stopped) return;
    if (this.polling) return this.polling;
    this.polling = (async () => {
      const events = await this.storage.pendingEvents();
      const seen = new Set<string>();
      for (const item of events) {
        const channel = `${item.team}:${item.channel}`;
        // Keep acceptance order within each channel, including failed events.
        if (seen.has(channel)) continue;
        seen.add(channel);
        if (this.active.has(channel) || this.active.size >= 8) continue;
        if ((this.retries.get(item.id)?.after ?? 0) > Date.now()) continue;
        const task = this.run(item).finally(() => {
          this.active.delete(channel);
          // Drain a busy channel immediately instead of limiting it to the poll rate.
          if (!this.retries.has(item.id)) setImmediate(() => { void this.tick(); });
        });
        this.active.set(channel, task);
      }
    })().catch(error => this.logger.error("Cannot read event inbox", error))
      .finally(() => { this.polling = undefined; });
    return this.polling;
  }

  private async run(item: InboxEvent): Promise<void> {
    try {
      if (!this.completed.has(item.id)) {
        await this.process(item);
        this.completed.add(item.id);
      }
      // Do not forget the event until its synchronous brain mutations are saved.
      await this.save();
      await this.storage.completeEvent(item.id);
      this.completed.delete(item.id);
      this.retries.delete(item.id);
    } catch (error) {
      const attempts = (this.retries.get(item.id)?.attempts ?? 0) + 1;
      this.retries.set(item.id, { attempts, after: Date.now() + Math.min(1000 * 2 ** Math.min(attempts - 1, 6), 60000) });
      this.logger.error(`Event ${item.id} retained for retry (attempt ${attempts})`, error);
    }
  }

  /** Used by offline tests and graceful shutdown; failed items stay in Redis. */
  async settle(): Promise<void> {
    await this.polling;
    await Promise.all(this.active.values());
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    await this.settle();
  }
}
