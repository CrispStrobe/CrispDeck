import { describe, expect, it } from 'vitest';
import { sanitizeWallabagHtml, wallabagArticleUrl } from './wallabag-content';

const source = 'https://news.example/section/story';
function documentFor(content: string, sourceUrl = source) {
  return new DOMParser().parseFromString(sanitizeWallabagHtml(content, sourceUrl), 'text/html');
}

describe('Wallabag article URLs', () => {
  it('accepts web URLs and resolves relative links against the article, never CrispDeck', () => {
    expect(wallabagArticleUrl('https://news.example/story')).toBe('https://news.example/story');
    expect(wallabagArticleUrl('../next', source)).toBe('https://news.example/next');
    expect(wallabagArticleUrl('/picture.jpg', source)).toBe('https://news.example/picture.jpg');
    expect(wallabagArticleUrl('//cdn.example/picture.jpg', source)).toBe('https://cdn.example/picture.jpg');
    expect(wallabagArticleUrl('/relative-with-no-origin')).toBeNull();
  });

  it.each([
    'javascript:alert(1)', 'java\tscript:alert(1)', 'data:text/html,<script>alert(1)</script>',
    'file:///private/file', 'blob:https://news.example/id', 'https://user:password@news.example/story',
    '', null, undefined,
  ])('rejects a non-web or credential-bearing URL: %s', input => {
    expect(wallabagArticleUrl(input, source)).toBeNull();
  });
});

describe('Wallabag article content', () => {
  it('preserves article formatting, images and tables on the first call', () => {
    const doc = documentFor('<h2>Heading</h2><p>Text <strong>emphasis</strong></p><figure><img src="/photo.jpg" alt="A photo"><figcaption>Caption</figcaption></figure><table><tr><th>Heading</th><td>Value</td></tr></table>');
    expect(doc.querySelector('h2')?.textContent).toBe('Heading');
    expect(doc.querySelector('strong')?.textContent).toBe('emphasis');
    expect(doc.querySelector('td')?.textContent).toBe('Value');
    expect(doc.querySelector('img')?.getAttribute('src')).toBe('https://news.example/photo.jpg');
    expect(doc.querySelector('img')?.getAttribute('referrerpolicy')).toBe('no-referrer');
    expect(doc.querySelector('img')?.getAttribute('loading')).toBe('lazy');
    expect(doc.querySelector('figcaption')?.textContent).toBe('Caption');
  });

  it('removes active content, handlers, forms, style and app-controlling attributes', () => {
    const doc = documentFor('<script>alert(1)</script><style>body{display:none}</style><iframe src="https://evil.example"></iframe><form action="https://evil.example"><input name="secret"></form><p id="app" class="fixed" style="position:fixed" onclick="alert(1)" data-post-uri="x" aria-hidden="true">Safe text</p><svg onload="alert(1)"></svg>');
    expect(doc.querySelector('script, style, iframe, form, input, svg')).toBeNull();
    expect(doc.querySelector('p')?.textContent).toBe('Safe text');
    expect(doc.querySelector('p')?.getAttributeNames()).toEqual([]);
  });

  it('checks every link and image URL, retaining safe relative resources', () => {
    const doc = documentFor('<a href="../other" target="_self" rel="opener">Related</a><a href="javascript:alert(1)">Bad</a><a href="https://user:secret@evil.example/">Credentials</a><img src="data:image/svg+xml,%3Csvg%3E" alt="Unsafe image"><img src="https://cdn.example/good.jpg" srcset="https://evil.example/second.jpg 2x" onerror="alert(1)">');
    const links = doc.querySelectorAll('a');
    expect(links[0].getAttribute('href')).toBe('https://news.example/other');
    expect(links[0].getAttribute('target')).toBe('_blank');
    expect(links[0].getAttribute('rel')).toBe('noopener noreferrer');
    expect(links[1].hasAttribute('href')).toBe(false);
    expect(links[2].hasAttribute('href')).toBe(false);
    expect(doc.querySelectorAll('img')).toHaveLength(1);
    expect(doc.querySelector('img')?.hasAttribute('srcset')).toBe(false);
    expect(doc.querySelector('img')?.hasAttribute('onerror')).toBe(false);
    expect(doc.body.textContent).toContain('Unsafe image');
  });

  it('does not turn encoded markup into active HTML', () => {
    const doc = documentFor('<p>&lt;img src=x onerror=alert(1)&gt;</p>');
    expect(doc.querySelector('img')).toBeNull();
    expect(doc.querySelector('p')?.textContent).toBe('<img src=x onerror=alert(1)>');
  });

  it('drops relative resources when the source URL is missing or unsafe', () => {
    for (const origin of ['', 'javascript:alert(1)', 'https://user:secret@news.example/']) {
      const doc = documentFor('<a href="/signin">Link</a><img src="/image.png" alt="Photo">', origin);
      expect(doc.querySelector('a')?.hasAttribute('href')).toBe(false);
      expect(doc.querySelector('img')).toBeNull();
    }
  });
});
