import { defineConfig } from 'vitepress';

export default defineConfig({
  title: 't140llm',
  description:
    'Convert LLM streaming responses into T.140 real-time text for SIP, WebRTC, and (S)RTP.',
  base: '/t140llm/',
  cleanUrls: true,
  lastUpdated: true,
  themeConfig: {
    nav: [
      { text: 'Guide', link: '/guide' },
      { text: 'Providers', link: '/providers' },
      { text: 'API', link: '/api' },
      { text: 'Examples', link: '/examples' },
    ],
    sidebar: [
      {
        text: 'Guide',
        items: [
          { text: 'Overview', link: '/guide' },
          { text: 'Provider guide', link: '/providers' },
        ],
      },
      {
        text: 'Reference',
        items: [
          { text: 'API reference', link: '/api' },
          { text: 'Examples', link: '/examples' },
        ],
      },
    ],
    search: { provider: 'local' },
    socialLinks: [
      { icon: 'github', link: 'https://github.com/agrathwohl/t140llm' },
    ],
    footer: {
      message: 'Released under the MIT License.',
      copyright: '© agrathwohl',
    },
  },
});
