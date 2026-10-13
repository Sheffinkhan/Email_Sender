import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

export class SettingsError extends Error {}

/** Connection details of the Microsoft Entra app registration used to sign in. */
export interface Settings {
  clientId: string;
  tenant: string;
}

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TENANT_ALIAS = /^(common|consumers|organizations)$/i;
const TENANT_DOMAIN = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i;

export function parseSettings(input: unknown): Settings {
  const source = (typeof input === 'object' && input !== null ? input : {}) as Record<string, unknown>;
  const clientId = typeof source.clientId === 'string' ? source.clientId.trim() : '';
  const tenant = typeof source.tenant === 'string' && source.tenant.trim() ? source.tenant.trim() : 'common';

  if (!GUID.test(clientId)) {
    throw new SettingsError('Application (client) ID must look like 00000000-0000-0000-0000-000000000000');
  }
  if (!TENANT_ALIAS.test(tenant) && !GUID.test(tenant) && !TENANT_DOMAIN.test(tenant)) {
    throw new SettingsError('Tenant must be common, consumers, organizations, a tenant ID or a domain');
  }
  return { clientId: clientId.toLowerCase(), tenant: tenant.toLowerCase() };
}

export function createSettingsStore(file: string) {
  return {
    async load(): Promise<Settings | null> {
      try {
        return parseSettings(JSON.parse(await readFile(file, 'utf8')));
      } catch {
        return null;
      }
    },

    async save(input: unknown): Promise<Settings> {
      const settings = parseSettings(input);
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, `${JSON.stringify(settings, null, 2)}\n`);
      return settings;
    },
  };
}

export type SettingsStore = ReturnType<typeof createSettingsStore>;
