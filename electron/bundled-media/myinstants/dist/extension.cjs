const path = require('node:path');
const client = require('./client.cjs');

const TROLL_TAGS = [
  ['Trending', '', 'trending'], ['Best of all time', '', 'best'], ['Bruh', 'bruh'], ['Vine boom', 'vine boom'], ['Laugh', 'laugh'],
  ['Fail', 'fail'], ['Wow', 'wow'], ['Airhorn', 'airhorn'], ['Sus', 'among us'], ['Sad', 'sad violin'], ['Scream', 'scream'],
  ['Fart', 'fart'], ['Anime', 'anime'], ['Gaming', 'game over'],
];

exports.activate = async function activate(context) {
  const cache = path.join(context.extension.storagePath, 'media-cache');
  await context.services.register('catalog', {
    async describe() {
      return {kinds:['trolls'], configured:true, licenseSummary:'audio.licence_unknown', notice:'audio.meme_sounds_from_myinstants_their_rights_a', categories:{trolls:TROLL_TAGS.map(([id]) => id)}};
    },
    async search(input, {signal}) {
      const preset = TROLL_TAGS.find(([id]) => id === input.categoryId);
      return client.search(request(signal), {...input, q:[input.q, preset?.[1]].filter(Boolean).join(' '), category:preset?.[2] || input.category});
    },
    async preview({item}, {signal}) {
      return {path:await client.download(request(signal), cache, item)};
    },
    async download({item}, {signal}) {
      const file = await client.download(request(signal), cache, item);
      const artifact = await context.media.import({path:file, name:item.title + path.extname(file)});
      return {artifact, credit:{title:item.title, creator:item.creator, license:'unknown', licenseName:item.licenseName, landing:item.landing, providerName:'MyInstants', line:client.creditLine(item)}};
    },
  });
  await context.ui.registerIntegration({id:'media', title:'MyInstants', point:'media.sources', service:'catalog', order:40});
};

function request(signal) {
  return (url, options = {}) => fetch(url, {...options, signal: options.signal ? AbortSignal.any([signal, options.signal]) : signal});
}
