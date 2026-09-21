import packageJson from "../package.json";
import { readFileSync } from "node:fs";
import {
  registerEnvironmentCommands,
  restorePersistedEnvironment,
} from "./environment";
import { boltConfiguration, createBoltBot } from "./runtime/bolt-app";
import { loadScripts } from "./runtime/script-loader";

export async function run(env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const config = boltConfiguration(env, packageJson.version);
  const service = createBoltBot({
    config,
    env,
    beforeScripts(brain, logger) {
      restorePersistedEnvironment(brain, logger);
    },
    register(bot) {
      bot.addHelp(readFileSync(require.resolve("./environment"), "utf8"));
      registerEnvironmentCommands(bot);
      loadScripts(bot);
    },
  });

  let stopping = false;
  const shutdown = (signal: NodeJS.Signals): void => {
    if (stopping) return;
    stopping = true;
    service.bot.logger.info(`Received ${signal}; shutting down`);
    void service.stop().then(
      () => process.exit(0),
      (error) => {
        service.bot.logger.error("Shutdown failed", error);
        process.exit(1);
      },
    );
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
  service.bot.once("shutdown", () => { setImmediate(() => shutdown("SIGTERM")); });

  try {
    await service.start(config.port);
    service.bot.logger.info(`Bolt bot listening on port ${config.port}`);
  } catch (error) {
    process.removeListener("SIGINT", shutdown);
    process.removeListener("SIGTERM", shutdown);
    throw error;
  }
}

if (require.main === module) {
  void run().catch((error) => {
    console.error("Bot startup failed", error);
    process.exit(1);
  });
}
