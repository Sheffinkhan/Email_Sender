import { describe, expect, it } from 'vitest';
import { parseRecipients } from '../src/recipients.js';

describe('parseRecipients', () => {
  it('splits on commas, semicolons and new lines', () => {
    const { recipients, invalid } = parseRecipients('a@x.com, b@y.org;c@z.net\nd@w.io');
    expect(recipients.map((r) => r.email)).toEqual(['a@x.com', 'b@y.org', 'c@z.net', 'd@w.io']);
    expect(invalid).toEqual([]);
  });

  it('reads names from "Name <email>" entries', () => {
    const { recipients } = parseRecipients('Ben Roy <ben@client.com>, "Anna Lee" <anna@client.com>');
    expect(recipients).toEqual([
      { email: 'ben@client.com', name: 'Ben Roy' },
      { email: 'anna@client.com', name: 'Anna Lee' },
    ]);
  });

  it('leaves the name empty for bare addresses', () => {
    expect(parseRecipients('a@x.com').recipients).toEqual([{ email: 'a@x.com', name: '' }]);
  });

  it('reports entries that are not email addresses', () => {
    const { recipients, invalid } = parseRecipients('a@x.com, not-an-email, Bob <bob@>');
    expect(recipients).toHaveLength(1);
    expect(invalid).toEqual(['not-an-email', 'Bob <bob@>']);
  });

  it('drops duplicates regardless of case', () => {
    expect(parseRecipients('a@x.com, A@X.COM').recipients).toHaveLength(1);
  });

  it('ignores blank entries', () => {
    expect(parseRecipients(' , \n ;').recipients).toEqual([]);
  });
});
