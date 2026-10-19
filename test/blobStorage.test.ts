import { describe, expect, it, vi } from 'vitest';
import { blobImageUploader, blobTemplateBackend, type BlobClient } from '../src/blobStorage.js';
import { StorageError } from '../src/templateStore.js';

const TOKEN = 'vercel_blob_rw_test';

/** A fake Blob store that pages its listings two at a time, like a real one would for big stores. */
function fakeStore() {
  const blobs = new Map<string, { url: string; pathname: string; uploadedAt: Date; body: string }>();
  let clock = 0;
  let counter = 0;

  const client = {
    put: vi.fn(async (pathname: string, body: unknown, options: Record<string, unknown>) => {
      const suffixed = pathname.replace(/(\.\w+)$/, `-r${++counter}$1`);
      const url = `https://store.test/${suffixed}`;
      blobs.set(url, { url, pathname: suffixed, uploadedAt: new Date(++clock), body: String(body) });
      return { url, pathname: suffixed, options };
    }),
    list: vi.fn(async ({ prefix = '', cursor }: { prefix?: string; cursor?: string }) => {
      const matching = [...blobs.values()].filter((blob) => blob.pathname.startsWith(prefix));
      const start = Number(cursor ?? 0);
      const page = matching.slice(start, start + 2);
      const hasMore = start + 2 < matching.length;
      return { blobs: page, hasMore, cursor: hasMore ? String(start + 2) : undefined };
    }),
    del: vi.fn(async (urls: string[] | string) => {
      for (const url of [urls].flat()) blobs.delete(url);
    }),
  };
  const fetchFn = vi.fn(async (url: string) => {
    const blob = blobs.get(url);
    return blob ? new Response(blob.body) : new Response('gone', { status: 404 });
  });

  return {
    blobs,
    client,
    fetchFn,
    backend: blobTemplateBackend(TOKEN, client as unknown as BlobClient, fetchFn as unknown as typeof fetch),
  };
}

describe('blob template backend', () => {
  it('writes, lists, reads and removes templates', async () => {
    const { backend, client } = fakeStore();
    expect(await backend.ids()).toEqual([]);
    expect(await backend.read('welcome')).toBeUndefined();

    await backend.write('welcome', '{"name":"Welcome"}');
    await backend.write('offer', '{"name":"Offer"}');
    await backend.write('spring', '{"name":"Spring"}');

    expect((await backend.ids()).sort()).toEqual(['offer', 'spring', 'welcome']);
    expect(await backend.read('welcome')).toBe('{"name":"Welcome"}');
    expect(client.put).toHaveBeenCalledWith('templates/welcome/template.json', '{"name":"Welcome"}', {
      access: 'public',
      addRandomSuffix: true,
      contentType: 'application/json',
      token: TOKEN,
    });

    expect(await backend.remove('welcome')).toBe(true);
    expect(await backend.remove('welcome')).toBe(false);
    expect((await backend.ids()).sort()).toEqual(['offer', 'spring']);
  });

  it('keeps only the newest copy of a template', async () => {
    const { backend, blobs } = fakeStore();
    await backend.write('welcome', 'v1');
    await backend.write('welcome', 'v2');
    await backend.write('welcome', 'v3');
    expect(await backend.read('welcome')).toBe('v3');
    expect([...blobs.values()].filter((blob) => blob.pathname.startsWith('templates/welcome/'))).toHaveLength(1);
  });

  it('does not confuse templates whose ids share a beginning', async () => {
    const { backend } = fakeStore();
    await backend.write('welcome', 'short');
    await backend.write('welcome-2', 'long');
    expect(await backend.read('welcome')).toBe('short');
  });

  it('explains a refused storage request in terms of the Vercel setup', async () => {
    const { backend, client } = fakeStore();
    client.put.mockRejectedValueOnce(new Error('Vercel Blob: Cannot use public access on a private store.'));
    await expect(backend.write('welcome', 'v1')).rejects.toThrow(StorageError);
    client.list.mockRejectedValueOnce('offline');
    await expect(backend.ids()).rejects.toThrow(
      'Online storage refused the request (offline). In Vercel, check that the Blob store has Public access and is connected to this project, then redeploy.',
    );
  });

  it('passes on the reason from the store', async () => {
    const { backend, client } = fakeStore();
    client.put.mockRejectedValueOnce(new Error('Vercel Blob: Cannot use public access on a private store.'));
    await expect(backend.write('welcome', 'v1')).rejects.toThrow(
      'Online storage refused the request (Cannot use public access on a private store.)',
    );
  });

  it('reports a template that cannot be read', async () => {
    const { backend, fetchFn } = fakeStore();
    await backend.write('welcome', 'v1');
    fetchFn.mockResolvedValueOnce(new Response('gone', { status: 404 }));
    await expect(backend.read('welcome')).rejects.toThrow('Could not read template welcome from online storage (404)');
  });
});

describe('blob image uploader', () => {
  it('stores the image publicly under a random name and returns its address', async () => {
    const { client } = fakeStore();
    const upload = blobImageUploader(TOKEN, client as unknown as BlobClient);
    const url = await upload(Buffer.from('GIF89a'), 'image/gif');
    expect(url).toBe('https://store.test/uploads/image-r1.gif');
    expect(client.put).toHaveBeenCalledWith('uploads/image.gif', Buffer.from('GIF89a'), {
      access: 'public',
      addRandomSuffix: true,
      contentType: 'image/gif',
      token: TOKEN,
    });
  });
});
