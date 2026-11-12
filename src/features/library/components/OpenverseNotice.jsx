import React from 'react';
import { rich } from '../../../i18n/index.js';

export default function OpenverseNotice() {
  return <p className="lib-note">{rich('openverse.made_using_openverse_notice', {}, {
    a: (s) => <a href="#" onClick={e => { e.preventDefault(); window.api.openHelp('https://openverse.org'); }}>{s}</a>,
  })}</p>;
}
