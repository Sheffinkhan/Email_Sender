import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { normaliseOrder, type Template } from './render.js';

export class TemplateError extends Error {}

type TemplateField = Exclude<keyof Template, 'id' | 'order'>;

// Uploaded images are stored as data URLs, hence the large image limits.
const IMAGE_LIMIT = 1_500_000;
// GIFs run larger than still images.
const MEDIA_LIMIT = 2_800_000;
const LIMITS: Record<TemplateField, number> = {
  name: 80,
  brandName: 80,
  logoUrl: IMAGE_LIMIT,
  bannerUrl: IMAGE_LIMIT,
  accentColor: 7,
  heading: 200,
  intro: 5000,
  mediaUrl: MEDIA_LIMIT,
  videoUrl: 2000,
  videoLabel: 80,
  buttonLabel: 60,
  buttonUrl: 2000,
  details: 10000,
  panelTitle: 200,
  panelText: 2000,
  footer: 2000,
};

const ID = /^[a-z0-9][a-z0-9-]{0,62}$/;

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 63);
}

/** Validates untrusted input into a Template. `id` stays empty when not supplied. */
export function normaliseTemplate(input: unknown): Template {
  if (typeof input !== 'object' || input === null) {
    throw new TemplateError('Template must be an object');
  }
  const source = input as Record<string, unknown>;
  const template = { id: '', order: normaliseOrder(source.order) } as Template;

  for (const field of Object.keys(LIMITS) as TemplateField[]) {
    const value = source[field] ?? '';
    if (typeof value !== 'string') throw new TemplateError(`${field} must be text`);
    if (value.length > LIMITS[field]) throw new TemplateError(`${field} is too long`);
    template[field] = value;
  }
  if (!template.name.trim()) throw new TemplateError('Template name is required');

  const id = source.id ?? '';
  if (typeof id !== 'string' || (id && !ID.test(id))) {
    throw new TemplateError('Template id is invalid');
  }
  template.id = id;
  return template;
}

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === 'ENOENT';
}

export function createTemplateStore(dir: string) {
  const fileFor = (id: string) => {
    if (!ID.test(id)) throw new TemplateError('Template id is invalid');
    return path.join(dir, `${id}.json`);
  };

  async function get(id: string): Promise<Template | undefined> {
    try {
      const raw = JSON.parse(await readFile(fileFor(id), 'utf8'));
      return normaliseTemplate({ ...raw, id });
    } catch (error) {
      if (isMissing(error)) return undefined;
      throw error;
    }
  }

  async function ids(): Promise<string[]> {
    try {
      const files = await readdir(dir);
      return files.filter((file) => file.endsWith('.json')).map((file) => file.slice(0, -5));
    } catch (error) {
      if (isMissing(error)) return [];
      throw error;
    }
  }

  async function newId(name: string): Promise<string> {
    const base = slugify(name) || 'template';
    const taken = new Set(await ids());
    let id = base;
    for (let n = 2; taken.has(id); n++) id = `${base.slice(0, 58)}-${n}`;
    return id;
  }

  return {
    get,

    async list(): Promise<{ id: string; name: string }[]> {
      const found: { id: string; name: string }[] = [];
      for (const id of await ids()) {
        // A hand-edited file that no longer parses is skipped, not fatal.
        const template = await get(id).catch(() => undefined);
        if (template) found.push({ id, name: template.name });
      }
      return found.sort((a, b) => a.name.localeCompare(b.name));
    },

    /** Saves a template. Without an id a new one is created from the name. */
    async save(input: unknown): Promise<Template> {
      const template = normaliseTemplate(input);
      if (!template.id) template.id = await newId(template.name);
      await mkdir(dir, { recursive: true });
      await writeFile(fileFor(template.id), `${JSON.stringify(template, null, 2)}\n`);
      return template;
    },

    async remove(id: string): Promise<boolean> {
      try {
        await rm(fileFor(id));
        return true;
      } catch (error) {
        if (isMissing(error)) return false;
        throw error;
      }
    },
  };
}

export type TemplateStore = ReturnType<typeof createTemplateStore>;
