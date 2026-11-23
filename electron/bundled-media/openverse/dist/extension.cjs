const path = require('node:path');
const client = require('./client.cjs');

const CHIPS = {
  photo: [
    ['Backgrounds', { category: 'backgrounds' }], ['Nature', { category: 'nature' }], ['Travel', { category: 'travel' }],
    ['People', { category: 'people' }], ['Business', { category: 'business' }], ['Food', { category: 'food' }], ['Animals', { category: 'animals' }],
    ['Places', { category: 'places' }], ['Buildings', { category: 'buildings' }], ['Sports', { category: 'sports' }], ['Fashion', { category: 'fashion' }],
    ['Technology', { category: 'computer' }], ['Music', { category: 'music' }], ['Science', { category: 'science' }], ['Feelings', { category: 'feelings' }],
  ],
};
const MUSIC_TAGS = [
  ['Vlog', 'upbeat'], ['Happy', 'happy'], ['Chill', 'chill'], ['Epic', 'epic'], ['Cinematic', 'cinematic'], ['Inspiring', 'inspiring'],
  ['Hip hop', 'beat'], ['Rap', 'rap'], ['Dance', 'dance'], ['Electronic', 'electro'], ['Funny', 'funny'], ['Romantic', 'romantic'],
  ['Sad', 'sad'], ['Travel', 'travel'], ['Fitness', 'energy'], ['Corporate', 'motivational'], ['Acoustic', 'guitar'],
];
const SFX_TAGS = [
  ['Transition', 'transition', 'transition', ['Transition']], ['Whoosh', 'whoosh'], ['UI', 'interface', 'ui', ['UI']],
  ['Impact', 'impact', 'impact', ['Hit']], ['Cartoon', 'cartoon', 'cartoon', ['Funny']], ['Pop', 'pop'], ['Click', 'click'],
  ['Notification', 'notification'], ['Laugh', 'laugh'], ['Applause', 'applause'], ['Camera', 'camera'], ['Explosion', 'explosion'],
  ['Magic', 'magic'], ['Horror', 'horror', 'horror'], ['Ambience', 'ambience', 'ambience', ['Ambience']], ['Animals', 'animal', 'animal'],
  ['Human', 'human', 'human'], ['Footsteps', 'footsteps', 'footsteps'], ['Crowd', 'crowd', 'crowd'], ['Vehicles', 'vehicle', 'vehicle'],
  ['Doors', 'door', 'door'], ['Water', 'water', 'water'], ['Wind', 'wind'], ['Foley', 'foley', 'foley'],
];

exports.activate = async function activate(context) {
  const cache = path.join(context.extension.storagePath, 'media-cache');
  await context.services.register('catalog', {
    async describe() {
      return {kinds:['photo','music','sfx'], configured:true, attribution:true, orientation:true, sourceLinks:true, notice:'openverse', categories:{photo:CHIPS.photo.map(([id]) => id), music:MUSIC_TAGS.map(([id]) => id), sfx:SFX_TAGS.map(([id]) => id)}};
    },
    async search(input, {signal}) {
      const rows = input.kind === 'music' ? MUSIC_TAGS : input.kind === 'sfx' ? SFX_TAGS : CHIPS.photo;
      const preset = rows.find(([id]) => id === input.categoryId)?.[1];
      const term = typeof preset === 'string' ? preset : preset?.q || preset?.category;
      return client.search(request(signal), {...input, q:[input.q, term].filter(Boolean).join(' ')});
    },
    async preview({item}, {signal}) {
      if (item.kind === 'photo') return {path:await client.thumbnail(request(signal), cache, item.thumb)};
      const result = await client.download(request(signal), cache, item);
      return {path:result.path};
    },
    async download({item}, {signal}) {
      const result = await client.download(request(signal), cache, item);
      const artifact = await context.media.import({path:result.path, name:result.item.title + path.extname(result.path)});
      return {artifact, credit:result.credit};
    },
    async source({item}, {signal}) {
      return {url:(await client.resolve(request(signal), item)).landing};
    },
  });
  await context.ui.registerIntegration({id:'media', title:'Openverse', point:'media.sources', service:'catalog', order:10});
};

function request(signal) {
  return (url, options = {}) => fetch(url, {...options, signal: options.signal ? AbortSignal.any([signal, options.signal]) : signal});
}
