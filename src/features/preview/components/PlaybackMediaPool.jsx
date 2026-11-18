import { useMemo, useRef } from 'react';
import { freeLen } from '../../../state/store.js';
import { createTimeIndex } from '../../timeline/timeIndex.js';
import { retireElement, wireElement } from '../../audio/audioTap.js';
import { useClockTime } from '../useClockTime.js';
import LiveGraphicFrame from '../../graphics/LiveGraphicFrame.jsx';

// Only nearby free-track media owns DOM/decoder resources. The active sets are
// indexed, and a look-ahead keeps upcoming nodes mounted before their boundary.
export default function PlaybackMediaPool({ project, mediaById, layout, overlayIndex, audioIndex,
  time, playing, clockRef, overlayEls, audioEls, enhEls, enhancedPath, redraw }) {
  const at = useClockTime(clockRef, time, playing, 4), callbacks = useRef(new Map());
  const enhanced = useMemo(() => createTimeIndex([
    ...layout.filter(item => enhancedPath(item.clip)).map(item => ({ clip: item.clip, start: item.start, end: item.end })),
    ...(project.overlayClips || []).filter(enhancedPath).map(clip => ({clip,start:clip.start,end:clip.start+freeLen('overlay',clip)})),
  ], item => item.start, item => item.end), [layout, project.overlayClips, enhancedPath]);
  const overlays = overlayIndex.range(at - 1, at + 2), audio = audioIndex.range(at - 1, at + 2);
  const enhancedAudio = enhanced.range(at - 1, at + 2);
  const refFor = (kind, id, part) => {
    const key = `${kind}:${id}:${part || ''}`;
    if (!callbacks.current.has(key)) callbacks.current.set(key, node => {
      const map = kind === 'overlay' ? overlayEls.current : kind === 'audio' ? audioEls.current : enhEls.current;
      const old = part ? map[id]?.[part] : map[id];
      if (old && !node) retireElement(old);
      if (part) {
        if (node) (map[id] ||= {})[part] = node;
        else if (map[id]) { delete map[id][part];if (!Object.keys(map[id]).length) delete map[id]; }
      } else if (node) map[id] = node;else delete map[id];
      if (node && (kind !== 'overlay' || part === 'v')) wireElement(node);
    });
    return callbacks.current.get(key);
  };
  return <>
    {overlays.map(clip => {
      const media = mediaById[clip.mediaId];
      return <div key={clip.id} className="slot ov" data-preview-clip={clip.id} ref={refFor('overlay',clip.id,'slot')} style={{visibility:'hidden'}}>
        <div className="layer" ref={refFor('overlay',clip.id,'layer')}>
          <video ref={refFor('overlay',clip.id,'v')} preload="auto" playsInline onSeeked={redraw} onLoadedData={redraw} style={{display:media?.type==='video'?'block':'none'}} />
          <img ref={refFor('overlay',clip.id,'img')} alt="" onLoad={redraw} style={{display:media?.type==='image'?'block':'none'}} />
          {clip.graphicDraft && media?.graphic && <LiveGraphicFrame project={project} clip={clip} media={media} time={time} clockRef={clockRef}
            imageRef={refFor('overlay',clip.id,'live')} redraw={redraw} />}
          <canvas ref={refFor('overlay',clip.id,'cv')} className="keyed" />
        </div>
        <div className="layer deco" ref={refFor('overlay',clip.id,'deco')} />
      </div>;
    })}
    {audio.map(clip => <audio key={clip.id} data-preview-audio={clip.id} ref={refFor('audio',clip.id)} preload="auto" />)}
    {enhancedAudio.map(({clip}) => <audio key={`enh-${clip.id}`} ref={refFor('enhanced',clip.id)} preload="auto" />)}
  </>;
}
