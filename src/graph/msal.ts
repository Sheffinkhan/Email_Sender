import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { PublicClientApplication, type ICachePlugin } from '@azure/msal-node';
import type { Settings } from '../settings.js';
import type { MsalClient } from './auth.js';

/** Keeps the sign-in between restarts by storing MSAL's token cache in a local file. */
export function fileCachePlugin(file: string): ICachePlugin {
  return {
    async beforeCacheAccess(context) {
      try {
        context.tokenCache.deserialize(await readFile(file, 'utf8'));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    },
    async afterCacheAccess(context) {
      if (!context.cacheHasChanged) return;
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, context.tokenCache.serialize(), { mode: 0o600 });
    },
  };
}

export function createMsalClient(settings: Settings, cacheFile: string): MsalClient {
  return new PublicClientApplication({
    auth: {
      clientId: settings.clientId,
      authority: `https://login.microsoftonline.com/${settings.tenant}`,
    },
    cache: { cachePlugin: fileCachePlugin(cacheFile) },
  });
}
