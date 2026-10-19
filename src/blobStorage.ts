import { del, list, put } from '@vercel/blob';
import { StorageError, type TemplateBackend } from './templateStore.js';

/** The part of the Vercel Blob SDK this module uses, so tests can supply a fake. */
export interface BlobClient {
  put: typeof put;
  list: typeof list;
  del: typeof del;
}

interface StoredBlob {
  url: string;
  pathname: string;
  uploadedAt: Date;
}

/**
 * How to reach the Blob store. Older connections give a read-write token;
 * newer ones give only a store id and rely on Vercel's built-in OIDC sign-in,
 * which the Blob SDK picks up by itself.
 */
export type BlobCredentials = { token: string } | { storeId: string };

const TEMPLATES = 'templates/';
const realClient: BlobClient = { put, list, del };

/** Finds the store connection in the environment, also under a custom variable prefix. */
export function findBlobCredentials(env: Record<string, string | undefined>): BlobCredentials | null {
  const entries = Object.entries(env);
  const token =
    env.BLOB_READ_WRITE_TOKEN || entries.find(([, value]) => value?.startsWith('vercel_blob_rw_'))?.[1];
  if (token) return { token };
  const storeId =
    env.BLOB_STORE_ID || entries.find(([name, value]) => name.endsWith('STORE_ID') && value?.startsWith('store_'))?.[1];
  return storeId ? { storeId } : null;
}

/** Blob failures are almost always setup problems, so say where to look. */
async function guarded<T>(request: Promise<T>): Promise<T> {
  try {
    return await request;
  } catch (error) {
    const detail = error instanceof Error ? error.message.replace(/^Vercel Blob:\s*/, '') : String(error);
    throw new StorageError(
      `Online storage refused the request (${detail}). In Vercel, check that the Blob store has Public access and is connected to this project, then redeploy.`,
    );
  }
}

/**
 * Keeps each template at `templates/<id>/<random>.json`. The store is public
 * because uploaded images must load in recipients' mail apps, so the random
 * part keeps template addresses unguessable. Only the newest copy is kept.
 */
export function blobTemplateBackend(
  credentials: BlobCredentials,
  client: BlobClient = realClient,
  fetchFn: typeof fetch = fetch,
): TemplateBackend {
  async function all(prefix: string): Promise<StoredBlob[]> {
    const found: StoredBlob[] = [];
    let cursor: string | undefined;
    do {
      const page = await guarded(client.list({ prefix, cursor, ...credentials }));
      found.push(...page.blobs);
      cursor = page.hasMore ? page.cursor : undefined;
    } while (cursor);
    return found;
  }

  const versions = async (id: string) =>
    (await all(`${TEMPLATES}${id}/`)).sort((a, b) => b.uploadedAt.getTime() - a.uploadedAt.getTime());

  return {
    async ids() {
      return [...new Set((await all(TEMPLATES)).map((blob) => blob.pathname.split('/')[1]))];
    },

    async read(id) {
      const [latest] = await versions(id);
      if (!latest) return undefined;
      const response = await guarded(fetchFn(latest.url, { cache: 'no-store' }));
      if (!response.ok) throw new StorageError(`Could not read template ${id} from online storage (${response.status})`);
      return response.text();
    },

    async write(id, json) {
      const older = await versions(id);
      await guarded(
        client.put(`${TEMPLATES}${id}/template.json`, json, {
          access: 'public',
          addRandomSuffix: true,
          contentType: 'application/json',
          ...credentials,
        }),
      );
      // Old copies go only once the new one is safely stored.
      if (older.length) await guarded(client.del(older.map((blob) => blob.url), { ...credentials }));
    },

    async remove(id) {
      const found = await versions(id);
      if (!found.length) return false;
      await guarded(client.del(found.map((blob) => blob.url), { ...credentials }));
      return true;
    },
  };
}

/** Stores an uploaded image and returns the public address emails link to. */
export function blobImageUploader(credentials: BlobCredentials, client: BlobClient = realClient) {
  return async (data: Buffer, contentType: string): Promise<string> => {
    const extension = contentType.split('/')[1];
    const { url } = await guarded(
      client.put(`uploads/image.${extension}`, data, {
        access: 'public',
        addRandomSuffix: true,
        contentType,
        ...credentials,
      }),
    );
    return url;
  };
}
