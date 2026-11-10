import { expect, it } from 'vitest';
import { hreflangBlock, localizedHtml } from '../src/logic';

it('emits hreflang alternates including x-default', () => {
  const html = localizedHtml({ title: 'Hola', body: 'Borrador', canonical: 'https://mailforge.induswebagency.com/' });
  expect(html).toContain('hreflang="es"');
  expect(html).toContain('hreflang="ur"');
  expect(html).toContain('hreflang="x-default"');
  expect(hreflangBlock('https://example.com', [{ hreflang: 'fr' }])).toContain('lang=fr');
});
