import React from 'react';
import {t} from '../../../i18n/index.js';
import {extensionUiError} from '../useExtensionUi.js';
export const viewDestinations=['workbench','left-rail','library','bottom','player-overlay','timeline-overlay','floating','modal'];
export default function ExtensionViewPlacement({entry,onError=()=>{}}){
 return <select className="extension-view-placement" data-extension-placement={entry.id} aria-label={t('plugins.view_move')} value={entry.placement??'workbench'} onChange={event=>window.api.pluginsExtensionViewMove(entry.id,{placement:event.target.value}).catch(error=>onError(extensionUiError(error)))}>{viewDestinations.map(value=><option value={value} key={value}>{t('plugins.view_placement_'+value)}</option>)}</select>;
}
