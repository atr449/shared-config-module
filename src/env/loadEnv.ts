import { config } from 'dotenv';
import { resolve } from 'path';

/**
 * Resolve the per-environment `.env` file path based on NODE_ENV.
 * Files are expected to sit next to the caller's compiled config directory,
 * so `baseDir` should normally be the consuming module's `__dirname`.
 */
export function getEnvPath(baseDir: string = __dirname): string {
  switch (process.env.NODE_ENV) {
    case 'prod':
      console.log('::YOU ARE ON PRODUCTION MODE::');
      return resolve(baseDir, './prod.env');
    case 'stage':
      console.log('::YOU ARE ON STAGING MODE::');
      return resolve(baseDir, './stage.env');
    case 'dev':
      console.log('::YOU ARE ON DEV MODE::');
      return resolve(baseDir, './dev.env');
    case 'qa':
      console.log('::YOU ARE ON QA MODE::');
      return resolve(baseDir, './qa.env');
    case 'uat':
      console.log('::YOU ARE ON UAT MODE::');
      return resolve(baseDir, './uat.env');
    default:
      console.log('::YOU ARE ON LOCAL MODE::');
      return resolve(baseDir, './local.env');
  }
}

/**
 * Load environment variables synchronously.
 * Call this at the very top of `server.ts` before any other imports.
 *
 * @param baseDir Directory holding the `<env>.env` files (defaults to the
 *                directory of the caller's `config` module via `__dirname`).
 */
export function loadEnvSync(baseDir: string = __dirname): void {
  config({ path: getEnvPath(baseDir) });
}
