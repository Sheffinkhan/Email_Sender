import { describe, expect, it } from 'vitest';
import { extractInlineImages } from '../src/inlineImages.js';
import {
  escapeHtml,
  personalise,
  renderEmail,
  renderSubject,
  safeColor,
  safeImage,
  safeLink,
  type Template,
} from '../src/render.js';

const PNG = 'data:image/png;base64,iVBORw0KGgo=';
const anna = { email: 'anna@client.com', name: 'Anna' };

function template(overrides: Partial<Template> = {}): Template {
  return {
    id: 'welcome',
    name: 'Welcome',
    brandName: 'Acme',
    logoUrl: '',
    bannerUrl: '',
    accentColor: '#112233',
    heading: 'Hi {{name}}',
    intro: 'First paragraph.\n\nSecond paragraph.',
    buttonLabel: 'Log in',
    buttonUrl: 'https://acme.test/login',
    details: '## Next steps\n\n**Log in:** on [desktop](https://acme.test).',
    panelTitle: 'Talk to us',
    panelText: 'Book a [meeting](https://acme.test/meet).',
    footer: 'Acme Inc.',
    ...overrides,
  };
}

describe('helpers', () => {
  it('escapes HTML', () => {
    expect(escapeHtml(`<a href="x">&'`)).toBe('&lt;a href=&quot;x&quot;&gt;&amp;&#39;');
  });

  it('only allows web and mail links', () => {
    expect(safeLink(' https://a.test ')).toBe('https://a.test');
    expect(safeLink('mailto:a@b.co')).toBe('mailto:a@b.co');
    expect(safeLink('javascript:alert(1)')).toBe('');
  });

  it('only allows web images and uploaded image data', () => {
    expect(safeImage('https://a.test/logo.png')).toBe('https://a.test/logo.png');
    expect(safeImage(PNG)).toBe(PNG);
    expect(safeImage('data:text/html;base64,PGI+')).toBe('');
    expect(safeImage('file:///c:/logo.png')).toBe('');
  });

  it('falls back to the default colour', () => {
    expect(safeColor('#ABCDEF')).toBe('#ABCDEF');
    expect(safeColor('red;background:url(x)')).toBe('#2563eb');
  });

  it('fills name and email placeholders', () => {
    expect(personalise('Hi {{ name }} ({{EMAIL}})', anna)).toBe('Hi Anna (anna@client.com)');
    expect(personalise('Hi {{name}}', { email: 'x@y.co', name: '' })).toBe('Hi there');
  });

  it('keeps the subject on one line', () => {
    expect(renderSubject(' Welcome\n{{name}} ', anna)).toBe('Welcome Anna');
  });
});

describe('renderEmail', () => {
  it('renders every section for the recipient', () => {
    const html = renderEmail(template(), anna);
    expect(html).toContain('Hi Anna');
    expect(html).toContain('>Acme</td>');
    expect(html).toContain('First paragraph.</p>');
    expect(html).toContain('Second paragraph.</p>');
    expect(html).toContain('<a href="https://acme.test/login"');
    expect(html).toContain('Next steps</h2>');
    expect(html).toContain('<strong>Log in:</strong>');
    expect(html).toContain('<a href="https://acme.test" style="color:#112233;');
    expect(html).toContain('bgcolor="#112233"');
    expect(html).toContain('Talk to us');
    expect(html).toContain('Acme Inc.');
  });

  it('escapes text typed into fields', () => {
    const html = renderEmail(template({ intro: '<script>alert(1)</script>' }), anna);
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('drops unsafe link targets but keeps the link text', () => {
    const html = renderEmail(template({ intro: '[click](javascript:alert(1))' }), anna);
    expect(html).not.toContain('javascript:');
    expect(html).toContain('click');
  });

  it('turns single line breaks into <br>', () => {
    expect(renderEmail(template({ footer: 'Line one\nLine two' }), anna)).toContain('Line one<br>Line two');
  });

  it('shows the logo instead of the company name', () => {
    const html = renderEmail(template({ logoUrl: 'https://acme.test/logo.png' }), anna);
    expect(html).toContain('<img src="https://acme.test/logo.png" alt="Acme"');
    expect(html).not.toContain('>Acme</td>');
  });

  it('shows the banner', () => {
    expect(renderEmail(template({ bannerUrl: PNG }), anna)).toContain(`<img src="${PNG}" alt="" width="600"`);
  });

  it('leaves out empty sections', () => {
    const html = renderEmail(
      template({
        brandName: '',
        heading: '',
        intro: '',
        buttonUrl: '',
        details: '',
        panelTitle: '',
        panelText: '',
        footer: '',
      }),
      anna,
    );
    // Only the outer wrapper row remains.
    expect(html.match(/<tr>/g)).toHaveLength(1);
    expect(html).not.toContain('<a ');
  });

  it('renders the coloured box without a title', () => {
    const html = renderEmail(template({ panelTitle: '' }), anna);
    expect(html).not.toContain('Talk to us');
    expect(html).toContain('<a href="https://acme.test/meet" style="color:#ffffff;');
  });
});

describe('extractInlineImages', () => {
  it('moves uploaded images into cid attachments', () => {
    const html = renderEmail(template({ logoUrl: PNG, bannerUrl: 'data:image/jpeg;base64,/9j/4AAQ' }), anna);
    const result = extractInlineImages(html);
    expect(result.html).not.toContain('data:image');
    expect(result.html).toContain('src="cid:image1"');
    expect(result.html).toContain('src="cid:image2"');
    expect(result.images).toEqual([
      { contentId: 'image1', contentType: 'image/png', contentBytes: 'iVBORw0KGgo=' },
      { contentId: 'image2', contentType: 'image/jpeg', contentBytes: '/9j/4AAQ' },
    ]);
  });

  it('attaches a repeated image once', () => {
    const result = extractInlineImages(renderEmail(template({ logoUrl: PNG, bannerUrl: PNG }), anna));
    expect(result.images).toHaveLength(1);
    expect(result.html.match(/cid:image1/g)).toHaveLength(2);
  });

  it('leaves hosted images alone', () => {
    const html = '<img src="https://a.test/x.png">';
    expect(extractInlineImages(html)).toEqual({ html, images: [] });
  });
});
