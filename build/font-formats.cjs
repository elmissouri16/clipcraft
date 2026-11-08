// Electron's renderer supports WOFF2. Avoid emitting an older WOFF copy when
// a face already supplies WOFF2, including data URLs. WOFF-only faces stay valid.
const { list } = require('postcss');
module.exports = {
  postcssPlugin: 'clipcraft-font-formats',
  Once(root) {
    root.walkAtRules('font-face', rule => rule.walkDecls('src', declaration => {
      const sources = list.comma(declaration.value);
      const format = name => new RegExp(`format\\(\\s*["']?${name}["']?\\s*\\)`, 'i');
      if (!sources.some(source => format('woff2').test(source))) return;
      declaration.value = sources.filter(source => !format('woff').test(source)).join(',');
    }));
  },
};
