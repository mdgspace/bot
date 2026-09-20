export interface User {
  id: string;
  name: string;
  real_name?: string;
  room?: string;
  email_address?: string;
  roles?: string[];
  pm?: boolean;
  msgcount?: number;
  words?: Record<string, number>;
  [key: string]: any;
}

export interface ChannelInfo {
  is_private?: boolean;
  is_im?: boolean;
  name?: string;
}

export interface Message {
  text?: string;
  room: string;
  user: User;
  done?: boolean;
  finish(): void;
  thread_ts?: string;
  channel?: ChannelInfo;
  rawMessage?: { channel?: ChannelInfo };
  message?: { channel?: ChannelInfo };
}

export interface Envelope {
  room?: string;
  id?: string;
  user?: User;
  message?: Message;
}

export type OutgoingMessage = string | Record<string, unknown>;
export type Target = Envelope | User | string;
export type DeliveryMethod = "send" | "reply" | "emote";
export interface Transport {
  deliver(
    method: DeliveryMethod,
    envelope: Envelope,
    messages: OutgoingMessage[],
  ): Promise<void>;
}

export interface HttpResponse {
  statusCode: number;
  headers?: Record<string, string | string[] | undefined>;
}
export type HttpCallback = (
  error: Error | null,
  response: HttpResponse | null,
  body: string | null,
) => void;
export interface HttpClient {
  header(name: string, value: string): HttpClient;
  query(options: Record<string, string | number | boolean>): HttpClient;
  get(): (callback: HttpCallback) => void;
  post(body: string): (callback: HttpCallback) => void;
}

export interface Response {
  message: Message;
  match: RegExpMatchArray;
  robot: Robot;
  envelope: Envelope;
  send(...messages: OutgoingMessage[]): void;
  reply(...messages: OutgoingMessage[]): void;
  emote(...messages: string[]): void;
  random<T>(items: T[]): T;
  http(url: string): HttpClient;
}

export interface BrainData {
  users: Record<string, User>;
  _private: Record<string, any>;
  [key: string]: any;
}
export interface Brain {
  data: BrainData;
  get<T = any>(key: string): T;
  set<T = any>(key: string, value: T): void;
  remove(key: string): void;
  userForId(id: string, options?: Partial<User>): User;
  userForName(name: string): User | null;
  usersForRawFuzzyName(name: string): User[];
  usersForFuzzyName(name: string): User[];
  on(event: string, callback: (...args: any[]) => void): void;
  emit(event: string, ...args: any[]): void;
}
export interface Logger {
  error(...args: any[]): void;
  warning(...args: any[]): void;
  info(...args: any[]): void;
  debug(...args: any[]): void;
}

export interface ReceiveContext {
  response: Response;
}
export interface ListenerContext extends ReceiveContext {
  listener: { options?: Record<string, unknown> };
}
export type Middleware<C> = (
  context: C,
  next: (done: () => void) => void,
  done: () => void,
) => void;
export type Request = import("node:http").IncomingMessage & {
  body?: any;
  params?: Record<string, string>;
  route?: { path?: string };
};
export type RequestHandler = (
  request: Request,
  response: import("node:http").ServerResponse,
) => void;
export interface Router {
  get(path: string, callback: RequestHandler): void;
  post(path: string, callback: RequestHandler): void;
  put(path: string, callback: RequestHandler): void;
  delete(path: string, callback: RequestHandler): void;
}

export interface Robot {
  name: string;
  adapterName: string;
  version: string;
  alias?: string;
  brain: Brain;
  logger: Logger;
  router: Router;
  respond(regex: RegExp, callback: (response: Response) => void): void;
  hear(regex: RegExp, callback: (response: Response) => void): void;
  on(event: string, callback: (...args: any[]) => void): void;
  emit(event: string, ...args: any[]): void;
  send(target: Target, ...messages: OutgoingMessage[]): void;
  reply(target: Target, ...messages: OutgoingMessage[]): void;
  http(url: string): HttpClient;
  helpCommands(): string[];
  receiveMiddleware(callback: Middleware<ReceiveContext>): void;
  listenerMiddleware(callback: Middleware<ListenerContext>): void;
}
