import { verifyConnection } from './caldav.js';
import { config } from './config.js';
import { createHandler } from './handler.js';
import { logger } from './logger.js';
import { startScheduler } from './scheduler.js';
import { getSocket, startWhatsApp } from './whatsapp.js';

async function main(): Promise<void> {
  logger.info(
    {
      timezone: config.TIMEZONE,
      model: config.GEMINI_MODEL,
      selfChat: config.ALLOW_SELF_CHAT,
      whitelist: config.WHITELIST.length,
      requireKeyword: config.REQUIRE_KEYWORD,
    },
    'wa-reminder starting',
  );

  await verifyConnection();
  await startWhatsApp(createHandler(getSocket));
  // Setelah socket siap: sapuan pengingat tugas tiap menit.
  startScheduler();
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    logger.info(`${signal} diterima, keluar`);
    process.exit(0);
  });
}

main().catch((error) => {
  logger.fatal({ err: error }, 'Gagal start');
  process.exit(1);
});
