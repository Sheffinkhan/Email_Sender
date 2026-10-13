export interface Recipient {
  email: string;
  name: string;
}

export interface ParsedRecipients {
  recipients: Recipient[];
  invalid: string[];
}

const EMAIL = /^[^\s@<>,;"]+@[^\s@<>,;"]+\.[^\s@<>,;"]+$/;

/**
 * Parses a To list. Entries are separated by commas, semicolons or new lines
 * and are either `email` or `Name <email>`. Duplicates are dropped.
 */
export function parseRecipients(input: string): ParsedRecipients {
  const recipients: Recipient[] = [];
  const invalid: string[] = [];
  const seen = new Set<string>();

  for (const raw of input.split(/[\n,;]+/)) {
    const entry = raw.trim();
    if (!entry) continue;

    const named = /^(.*)<([^<>]+)>$/.exec(entry);
    const email = (named ? named[2] : entry).trim();
    const name = named ? named[1].trim().replace(/^"|"$/g, '').trim() : '';

    if (!EMAIL.test(email)) {
      invalid.push(entry);
      continue;
    }
    const key = email.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    recipients.push({ email, name });
  }

  return { recipients, invalid };
}
