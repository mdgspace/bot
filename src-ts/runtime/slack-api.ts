import type { App } from "@slack/bolt";

// Only explicit permanent lookup/configuration failures are dropped. Unknown,
// network and rate-limit failures remain retryable through the Redis inbox.
export function isPermanentLookupFailure(error: unknown): boolean {
  const code = (error as { data?: { error?: string } })?.data?.error;
  return !!code && [
    "channel_not_found", "user_not_found", "bot_not_found", "not_in_channel", "user_not_visible",
    "missing_scope", "is_archived", "account_inactive", "invalid_auth", "not_authed", "token_revoked",
    "team_access_not_granted",
  ].includes(code);
}

export function slackErrorCode(error: unknown): string | undefined {
  return (error as { data?: { error?: string } })?.data?.error;
}

export interface SlackIdentity { teamId: string; botUserId: string; botId: string }
export interface SlackUser {
  id: string;
  name?: string;
  real_name?: string;
  profile?: { email?: string; display_name?: string };
  [key: string]: unknown;
}
export interface SlackBot {
  id: string;
  name?: string;
  user_id?: string;
  [key: string]: unknown;
}
export interface SlackChannel {
  id: string;
  name?: string;
  is_private?: boolean;
  is_im?: boolean;
  is_mpim?: boolean;
}

/** Narrow boundary shared by the adapter and offline test doubles. */
export interface SlackApi {
  identity(): Promise<SlackIdentity>;
  userInfo(id: string): Promise<SlackUser>;
  users(cursor?: string): Promise<{ users: SlackUser[]; cursor?: string }>;
  botInfo(id: string): Promise<SlackBot>;
  channelInfo(id: string): Promise<SlackChannel>;
  channels(cursor?: string): Promise<{ channels: SlackChannel[]; cursor?: string }>;
  openDM(user: string): Promise<string>;
  postMessage(message: Record<string, unknown> & { channel: string }): Promise<void>;
}

export function slackApi(client: App["client"], token: string): SlackApi {
  return {
    async identity() {
      const result = await client.auth.test({ token });
      if (!result.ok || !result.team_id || !result.user_id || !result.bot_id) throw new Error("Slack bot identity is incomplete");
      return { teamId: result.team_id, botUserId: result.user_id, botId: result.bot_id };
    },
    async userInfo(user) {
      const result = await client.users.info({ token, user });
      if (!result.ok || !result.user?.id) throw new Error(`Slack user not found: ${user}`);
      return result.user as SlackUser;
    },
    async botInfo(bot) {
      const result = await client.bots.info({ token, bot });
      if (!result.ok || !result.bot?.id) throw new Error(`Slack bot not found: ${bot}`);
      return result.bot as SlackBot;
    },
    async users(cursor) {
      const result = await client.users.list({ token, cursor, limit: 200 });
      if (!result.ok) throw new Error("Cannot load Slack users");
      return { users: (result.members ?? []) as SlackUser[], cursor: result.response_metadata?.next_cursor };
    },
    async channelInfo(channel) {
      const result = await client.conversations.info({ token, channel });
      if (!result.ok || !result.channel?.id) throw new Error(`Slack channel not found: ${channel}`);
      return result.channel as SlackChannel;
    },
    async channels(cursor) {
      const result = await client.conversations.list({ token, cursor, limit: 200, exclude_archived: true, types: "public_channel,private_channel" });
      if (!result.ok) throw new Error("Cannot resolve Slack channel names");
      return { channels: (result.channels ?? []) as SlackChannel[], cursor: result.response_metadata?.next_cursor };
    },
    async openDM(users) {
      const result = await client.conversations.open({ token, users });
      if (!result.ok || !result.channel?.id) throw new Error("Cannot open Slack conversation");
      return result.channel.id;
    },
    async postMessage(message) {
      // The credential is always supplied by the runtime, never an attachment.
      await client.chat.postMessage({ ...message, token } as Parameters<App["client"]["chat"]["postMessage"]>[0]);
    },
  };
}
