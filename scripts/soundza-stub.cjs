// A local stub of the Soundza API (shapes from https://soundza.com/openapi.json), used by
// test-soundza.cjs and by the UI end-to-end drive: the sandbox cannot reach the real API from
// inside Electron, so the documented request/response shapes are served from here instead.
// Not a test itself. `start(port)` resolves { server, port, hits, sounds }.
const http = require('http');
const { execFileSync } = require('child_process');
const { ffmpegPath } = require('../electron/ffmpeg.cjs');

const KEY = 'sz_stub_key';

function tone(freq, seconds, format, args = []) {
  return execFileSync(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi',
    '-i', `sine=frequency=${freq}:duration=${seconds}`, ...args, '-f', format, 'pipe:1']);
}

function start(port = 0) {
  const hits = { search: 0, lastQuery: null, downloads: {}, previews: {}, ratelimitSeen: 0 };
  const files = {
    stubwhoosh1: { buf: tone(660, 1.2, 'wav'), type: 'audio/wav' },
    stubclick2: { buf: tone(440, 0.8, 'wav'), type: 'audio/wav' },
    stubmagic3: { buf: tone(990, 1.0, 'mp3', ['-codec:a', 'libmp3lame', '-b:a', '96k']), type: 'audio/mpeg' },
  };
  const previewBuf = tone(880, 0.6, 'mp3', ['-codec:a', 'libmp3lame', '-b:a', '64k']);

  const sounds = (base) => [
    {
      id: 'stubwhoosh1', url: 'https://soundza.com/sound/stub-whoosh-1', title: 'Stub Whoosh One',
      description: 'A fast airy whoosh (stub data).', type: 'sound_effect', duration: 1.2,
      tags: ['whoosh', 'transition'], category: { id: 'TRAN', label: 'Transitions' },
      pack: { id: 'p1', name: 'Stub Pack', slug: 'stub-pack', sound_count: 3, url: 'https://soundza.com/packs/stub-pack' },
      creator: { name: 'Stub Creator', url: 'https://soundza.com/@stub' },
      preview_files: [{ type: 'mp3', bitrate: 128, link: `${base}/preview/stubwhoosh1.mp3` }],
      download_url: `${base}/v1/sounds/stubwhoosh1/download?search_id=stubsearch`,
      license: { name: 'Soundza Standard License', url: 'https://soundza.com/license' },
      attribution: '"Stub Whoosh One" by Stub Creator on Soundza (https://soundza.com/sound/stub-whoosh-1)',
      file_extension: 'wav', size_bytes: files.stubwhoosh1.buf.length, file_type: 'audio',
    },
    {
      id: 'stubclick2', url: 'https://soundza.com/sound/stub-click-2', title: 'Stub UI Click',
      description: 'A short click (stub data).', type: 'sound_effect', duration: 0.8,
      tags: ['click', 'ui'], category: { id: 'UI', label: 'User Interface' }, pack: null,
      creator: { name: 'Soundza', url: 'https://soundza.com/@soundza' },
      preview_files: [{ type: 'mp3', bitrate: 128, link: `${base}/preview/stubclick2.mp3` }],
      download_url: `${base}/v1/sounds/stubclick2/download?search_id=stubsearch`,
      license: { name: 'Soundza Standard License', url: 'https://soundza.com/license' },
      attribution: '"Stub UI Click" on Soundza (https://soundza.com/sound/stub-click-2)',
      file_extension: 'wav', size_bytes: files.stubclick2.buf.length, file_type: 'audio',
    },
    {
      id: 'stubmagic3', url: 'https://soundza.com/sound/stub-magic-3', title: 'Stub Magic Sparkle',
      description: 'A sparkly reveal (stub data).', type: 'sound_effect', duration: 1.0,
      tags: ['magic', 'sparkle'], category: null, pack: null, creator: null,
      preview_files: [{ type: 'mp3', bitrate: 128, link: `${base}/preview/stubmagic3.mp3` }],
      download_url: `${base}/v1/sounds/stubmagic3/download?search_id=stubsearch`,
      license: { name: 'Soundza Standard License', url: 'https://soundza.com/license' },
      attribution: '"Stub Magic Sparkle" on Soundza (https://soundza.com/sound/stub-magic-3)',
      file_extension: 'mp3', size_bytes: files.stubmagic3.buf.length, file_type: 'audio',
    },
  ];

  const json = (res, status, obj, headers = {}) => {
    res.writeHead(status, { 'content-type': 'application/json', ...headers });
    res.end(JSON.stringify(obj));
  };

  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://127.0.0.1');
    const base = `http://127.0.0.1:${server.address().port}`;
    if (u.pathname === '/__hits') return json(res, 200, hits);
    if (u.pathname.startsWith('/preview/')) {
      const id = u.pathname.split('/')[2].replace(/\.mp3$/, '');
      hits.previews[id] = (hits.previews[id] || 0) + 1;
      res.writeHead(200, { 'content-type': 'audio/mpeg', 'content-length': previewBuf.length });
      return res.end(previewBuf);
    }
    if (u.pathname.startsWith('/files/')) {
      const id = u.pathname.split('/')[2];
      const f = files[id];
      if (!f) return json(res, 404, { error: { code: 'not_found', message: 'Not found.' } });
      hits.downloads[id] = (hits.downloads[id] || 0) + 1;
      res.writeHead(200, { 'content-type': f.type, 'content-length': f.buf.length });
      return res.end(f.buf);
    }
    if (u.pathname.startsWith('/v1/')) {
      if (req.headers.authorization !== `Bearer ${KEY}`) {
        return json(res, 401, { error: { code: 'invalid_key', message: 'That API key is not valid.' } });
      }
      if (u.pathname === '/v1/sounds/search') {
        hits.search += 1;
        hits.lastQuery = Object.fromEntries(u.searchParams);
        if (u.searchParams.get('q') === 'ratelimit' && hits.ratelimitSeen === 0) {
          hits.ratelimitSeen += 1;
          return json(res, 429, { error: { code: 'rate_limited', message: 'Too many requests.', retry_after: 0 } }, { 'retry-after': '0' });
        }
        const all = sounds(base);
        return json(res, 200, {
          page: 1, per_page: 20, total_results: all.length, next_page: null, search_id: 'stubsearch',
          sounds: all, relaxed_filters: [], interpreted_as: null, text_match: null, notes: [],
        });
      }
      const dl = u.pathname.match(/^\/v1\/sounds\/([\w-]+)\/download$/);
      if (dl) {
        res.writeHead(302, { location: `/files/${dl[1]}` });
        return res.end();
      }
      return json(res, 404, { error: { code: 'not_found', message: 'Not found.' } });
    }
    return json(res, 404, { error: { code: 'not_found', message: 'Not found.' } });
  });

  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve({ server, port: server.address().port, hits, key: KEY })));
}

if (require.main === module) {
  start(Number(process.argv[2]) || 0).then(({ port }) => console.log(`soundza stub on ${port}`));
}

module.exports = { start, KEY };
