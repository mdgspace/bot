import { EventEmitter } from "node:events";
import { Brain } from "./brain";
import { ScriptHttpClient } from "./http-client";
import type {
  DeliveryMethod,
  Envelope,
  HttpClient,
  ListenerContext,
  Logger,
  Message,
  Middleware,
  OutgoingMessage,
  ReceiveContext,
  Response,
  Robot,
  Router,
  Target,
  Transport,
  User,
} from "./types";

type Handler = (response: Response) => void | Promise<void>;
interface Listener {
  regex: RegExp;
  callback: Handler;
  options: Record<string, unknown>;
}

export class TextMessage implements Message {
  done = false;
  channel?: Message["channel"];
  constructor(
    public user: User,
    public text: string,
    public room: string,
    public thread_ts?: string,
  ) {}
  finish(): void {
    this.done = true;
  }
}

export interface BotOptions {
  name: string;
  alias?: string;
  version: string;
  brain: Brain;
  router: Router;
  logger: Logger;
  transport: Transport;
  slack?: Robot["slack"];
  http?: (url: string) => HttpClient;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function runMiddleware<C>(
  middleware: Middleware<C>[],
  context: C,
): Promise<boolean> {
  for (const callback of middleware) {
    const proceed = await new Promise<boolean>((resolve, reject) => {
      try {
        callback(
          context,
          () => resolve(true),
          () => resolve(false),
        );
      } catch (error) {
        reject(error);
      }
    });
    if (!proceed) return false;
  }
  return true;
}

class ScriptResponse implements Response {
  readonly envelope: Envelope;
  constructor(
    public robot: Bot,
    public message: Message,
    public match: RegExpMatchArray,
  ) {
    this.envelope = { room: message.room, user: message.user, message };
  }
  send(...messages: OutgoingMessage[]): void {
    this.robot.send(this.envelope, ...messages);
  }
  reply(...messages: OutgoingMessage[]): void {
    this.robot.reply(this.envelope, ...messages);
  }
  emote(...messages: string[]): void {
    this.robot.deliver("emote", this.envelope, messages);
  }
  random<T>(items: T[]): T {
    return items[Math.floor(Math.random() * items.length)];
  }
  http(url: string): HttpClient {
    return this.robot.http(url);
  }
}

export class Bot extends EventEmitter implements Robot {
  readonly adapterName = "slack";
  readonly name: string;
  readonly alias?: string;
  readonly version: string;
  readonly brain: Brain;
  readonly router: Router;
  readonly logger: Logger;
  readonly slack?: Robot["slack"];
  private readonly commandListeners: Listener[] = [];
  private readonly receivers: Middleware<ReceiveContext>[] = [];
  private readonly listenerMiddlewareCallbacks: Middleware<ListenerContext>[] =
    [];
  private readonly commands: string[] = [];
  private outgoing = new Map<string, Promise<void>>();

  constructor(private readonly options: BotOptions) {
    super();
    this.name = options.name;
    this.alias = options.alias;
    this.version = options.version;
    this.brain = options.brain;
    this.router = options.router;
    this.logger = options.logger;
    this.slack = options.slack;
    this.on("error", (error) => this.logger.error(error));
  }

  hear(regex: RegExp, callback: Handler): void {
    this.commandListeners.push({ regex, callback, options: {} });
  }

  respond(regex: RegExp, callback: Handler): void {
    const names = [
      ...new Set(
        [this.name, this.alias].filter((name): name is string => !!name),
      ),
    ]
      .sort((a, b) => b.length - a.length)
      .map(escapeRegex);
    this.hear(
      new RegExp(
        `^\\s*@?(?:${names.join("|")})[:,]?\\s*(?:${regex.source.replace(/^\^/, "")})`,
        regex.flags,
      ),
      callback,
    );
  }

  receiveMiddleware(callback: Middleware<ReceiveContext>): void {
    this.receivers.push(callback);
  }
  listenerMiddleware(callback: Middleware<ListenerContext>): void {
    this.listenerMiddlewareCallbacks.push(callback);
  }

  async receive(message: Message): Promise<void> {
    const received = new ScriptResponse(
      this,
      message,
      [] as unknown as RegExpMatchArray,
    );
    try {
      if (
        !(await runMiddleware(this.receivers, { response: received })) ||
        message.done
      )
        return;
    } catch (error) {
      this.emit("error", error, received);
      return;
    }
    for (const listener of this.commandListeners) {
      if (message.done) break;
      // String.match preserves the global-match arrays used by leaderboard.
      listener.regex.lastIndex = 0;
      const match = (message.text ?? "").match(listener.regex);
      if (!match) continue;
      const response = new ScriptResponse(this, message, match);
      try {
        if (
          (await runMiddleware(this.listenerMiddlewareCallbacks, {
            response,
            listener,
          })) &&
          !message.done
        ) {
          await listener.callback(response);
        }
      } catch (error) {
        this.emit("error", error, response);
      }
    }
  }

  send(target: Target, ...messages: OutgoingMessage[]): void {
    this.deliver("send", target, messages);
  }
  reply(target: Target, ...messages: OutgoingMessage[]): void {
    this.deliver("reply", target, messages);
  }

  deliver(
    method: DeliveryMethod,
    target: Target,
    messages: OutgoingMessage[],
  ): void {
    const envelope: Envelope =
      typeof target === "string"
        ? { room: target }
        : "name" in target
          ? { room: target.room, id: target.id, user: target as User }
          : { ...target };
    // Most scripts don't await sends. Keep ordering and handle rejected sends here.
    const key = envelope.room || envelope.id || "";
    const task = (this.outgoing.get(key) ?? Promise.resolve())
      .then(() => this.options.transport.deliver(method, envelope, messages))
      .catch((error) => {
        this.emit("error", error);
      }).finally(() => { if (this.outgoing.get(key) === task) this.outgoing.delete(key); });
    this.outgoing.set(key, task);
  }

  async flush(): Promise<void> {
    while (this.outgoing.size) await Promise.all(this.outgoing.values());
  }

  http(url: string): HttpClient {
    return this.options.http?.(url) ?? new ScriptHttpClient(url);
  }

  addHelp(source: string): void {
    let inCommands = false;
    for (const line of source.split(/\r?\n/)) {
      const comment = /^\s*\/\/\s?(.*)$/.exec(line);
      if (!comment) {
        inCommands = false;
        continue;
      }
      if (comment[1].trim() === "Commands:") {
        inCommands = true;
        continue;
      }
      if (/^\S.*:\s*$/.test(comment[1])) {
        inCommands = false;
        continue;
      }
      const command = comment[1].trim();
      if (inCommands && command && !/^none$/i.test(command))
        this.commands.push(command);
    }
  }

  helpCommands(): string[] {
    return [...this.commands].sort();
  }
}
