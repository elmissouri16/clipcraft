import { videoLayout } from '../../state/store.js';
import { activityEvidence } from './activityEvidence.js';
import { normalizePlan } from './editorialTools.js';
// Bounded display data only. Local image/output references have their own typed
// schema; never copy raw arguments/results, credentials or image bytes here.
const clean=(value,max=180)=>typeof value==='string'?value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g,'').trim().slice(0,max):'';
const human=value=>clean(value).replace(/[_-]+/g,' ');
const join=values=>values.filter(v=>v!==undefined&&v!==null&&v!=='').join(' · ');
const basename=value=>clean(value,500).split(/[\\/]/).at(-1);
export const activityTime=value=>{if(!Number.isFinite(value))return '';const ticks=Math.round(Math.max(0,value)*10);return `${Math.floor(ticks/600).toString().padStart(2,'0')}:${((ticks%600)/10).toFixed(1).padStart(4,'0')}`;};
const seconds=value=>Number.isFinite(value)?`${Number(value.toFixed(2))}s`:'';
const count=(n,singular,plural=singular+'s')=>Number.isFinite(n)?`${n} ${n===1?singular:plural}`:'';
// Motion measured after a keyframe edit (src/features/timeline/motionQuality.js), in a few words.
const motionNote=m=>{if(!m)return '';const turns=(m.reversals||[]).filter(r=>!r.after_hold).length,issues=[count(m.stops?.length||0,'stop'),count(m.jerks?.length||0,'jolt'),turns?count(turns,'reversal'):''].filter(x=>!/^0 /.test(x)&&x);return issues.length?issues.join(', '):'Smooth motion';};
const TITLES={
  get_project:'Reading the timeline',list_options:'Finding available styles',load_tools:'Preparing editing tools',recall_context:'Recalling earlier work',
  analyze_reference:'Studying the reference edit',analyze_scenes:'Finding scene boundaries',get_storyboard:'Reviewing scene samples',annotate_scene:'Saving a scene note',
  remove_silences:'Removing silent sections',cut_range:'Cutting a section',keep_ranges:'Keeping selected sections',delete_clip:'Removing a clip',
  split_at:'Splitting a clip',set_speed:'Changing playback speed',move_clip:'Moving a clip',trim_clip:'Trimming a clip',clip_tools:'Editing a clip',
  layer_tools:'Organizing layers',transcribe:'Transcribing speech',add_captions:'Creating captions',add_text:'Adding text',edit_text:'Updating text',
  edit_caption_words:'Correcting caption timing',caption_tools:'Editing captions',export_subtitles:'Saving subtitles',
  set_volume:'Adjusting audio level',set_audio_effects:'Processing audio',set_volume_envelope:'Shaping volume over time',duck_audio:'Lowering music beneath speech',
  search_sounds:'Finding audio',add_sound:'Adding audio',list_voices:'Finding a voice',add_voiceover:'Generating narration',
  set_filter:'Applying a filter',set_effects:'Applying clip effects',add_effect:'Adding an effect layer',set_color:'Adjusting color',set_compositing:'Compositing the picture',
  add_transition:'Joining two shots',set_aspect_ratio:'Changing video format',set_transform:'Positioning the picture',zoom:'Adding a zoom',add_keyframes:'Building motion',move_along_path:'Moving along a path',
  set_animation:'Animating the picture',motion_guide:'Planning motion',track_subject:'Following a subject',pin_to_subject:'Attaching to a subject',
  add_media:'Placing media',list_local_media:'Finding files',import_media:'Importing media',search_stock:'Finding stock media',add_stock:'Adding stock media',
  add_scene:'Creating a background',generate_image:'Generating a scene image',generate_images:'Generating scene images',inspect_frames:'Inspecting the picture',
  edit_guide:'Reading the editing playbook',log_footage:'Logging the footage',remove_fillers:'Removing filler words',remove_retakes:'Removing retakes',
  find_highlights:'Finding the strongest moments',propose_edit_plan:'Edit plan',critique_edit:'Reviewing the edit',get_beats:'Finding the beat',
  review_section:'Reviewing a rendered section',complete_edit:'Checking the completed edit',export_video:'Exporting the video',undo:'Undoing this request',
};
function target(project,id) {
  if(id==='captions')return 'All captions';
  if(!id)return '';
  for(const [key,lane] of [['videoClips','Main track'],['overlayClips','Overlay'],['audioClips','Audio'],['textClips','Text'],['effectClips','Effects']]){
    const clip=project?.[key]?.find(c=>c.id===id);
    if(clip){const media=project.media?.find(m=>m.id===clip.mediaId),at=key==='videoClips'?videoLayout(project.videoClips).find(row=>row.clip.id===id)?.start:clip.start;return join([clean(clip.text||clip.name||media?.name,70)||lane,activityTime(at)]);}
  }
  return '';
}
function activity(name,args={},project={},result) {
  const a=args||{},r=result||{},range=join([activityTime(a.start_sec),activityTime(a.end_sec)]).replace(' · ',' → ');
  const clip=target(project,a.clip_id),placement=join([a.as==='main'?'Main track':a.as==='overlay'?'Overlay':a.as==='audio'?'Audio':'',range,seconds(a.duration_sec)]);
  let description='',excerpt='',excerptLabel='',outcome='';
  switch(name){
    case 'get_project':description=join([a.scope&&a.scope!=='all'?human(a.scope):'Current clips, layers and timing',a.clip_ids?.length?count(a.clip_ids.length,'selected clip'):'']);break;
    case 'list_options':description=human(a.what);break;
    case 'load_tools':description=(a.groups||[]).map(human).join(' · ');break;
    case 'recall_context':description=join(['Earlier conversation and tool results',a.query?`Search: ${clean(a.query)}`:'']);break;
    case 'generate_image':description=join(['Codex',placement,a.reference_media_ids?.length?count(a.reference_media_ids.length,'reference image'):'']);excerpt=a.prompt;excerptLabel='Image prompt';break;
    case 'generate_images':description=join([count(a.scenes?.length,'scene image'),'Inserted in scene order']);excerpt=(a.scenes||[]).slice(0,12).map((s,i)=>`${i+1}. ${join([activityTime(s.start_sec),seconds(s.duration_sec)])}\n${clean(s.prompt,350)}`).join('\n\n');excerptLabel='Scene prompts';break;
    case 'add_voiceover':description=join([a.engine?human(a.engine):'Automatic voice selection',a.voice_id?human(a.voice_id):'',placement]);excerpt=a.text;excerptLabel='Narration';break;
    case 'add_text':case 'edit_text':description=join([clip||'Text layer',placement,...Object.entries(a).filter(([key])=>!['clip_id','text','start_sec','duration_sec','retry_of'].includes(key)).map(([key,value])=>`${human(key)}: ${typeof value==='string'?human(value):typeof value==='boolean'?(value?'on':'off'):Number.isFinite(value)?value:''}`)]);excerpt=a.text;excerptLabel='Text';break;
    case 'transcribe':case 'add_captions':description=join([a.source?human(a.source)+' audio':'Timeline audio',a.language?human(a.language):'',a.style_id?human(a.style_id):'',a.words_per_caption?`${a.words_per_caption} words per caption`:'']);break;
    case 'search_sounds':case 'search_stock':case 'web_search':description=join([a.kind?human(a.kind):'',a.query?`“${clean(a.query)}”`:'']);break;
    case 'add_keyframes':description=join([clip,human(a.property),count(a.keys?.length,'motion point'),a.easing?human(a.easing):'']);break;
    case 'move_along_path':description=join([clip,count(a.points?.length,'waypoint'),a.orient?'Facing the way it moves':'']);break;
    case 'set_animation':description=join([clip,a.in?`In: ${human(a.in)}`:'',a.out?`Out: ${human(a.out)}`:'',a.combo?human(a.combo):'']);break;
    case 'set_transform':description=join([clip,a.scale!==undefined?`${a.scale}× scale`:'',a.x!==undefined?`X ${a.x}`:'',a.y!==undefined?`Y ${a.y}`:'',a.rotation!==undefined?`${a.rotation}°`:'',a.fit?human(a.fit):'']);break;
    case 'zoom':description=join([range,a.scale?`${a.scale}×`:'',a.smooth===false?'Quick punch-in':'Smooth ramp']);break;
    case 'set_color':description=join([clip,...['brightness','contrast','saturation','hue','blur'].filter(k=>a[k]!==undefined).map(k=>`${human(k)} ${a[k]}`)]);break;
    case 'set_filter':description=join([clip,human(a.filter_id),a.intensity!==undefined?`${a.intensity} intensity`:'']);break;
    case 'set_effects':description=join([clip,(a.effect_ids||[]).map(human).join(', ')]);break;
    case 'add_effect':description=join([human(a.effect_id),placement]);break;
    case 'add_transition':description=join([clip,human(a.type),seconds(a.duration_sec)]);break;
    case 'set_volume':description=join([clip,Number.isFinite(a.volume)?`${Math.round(a.volume*100)}% level`:'',a.muted?'Muted':'']);break;
    case 'set_audio_effects':description=join([clip,a.preset?human(a.preset):'',...['eq','highpass','lowpass','comp','limit','denoise','loudnorm','pitch','echo'].filter(k=>a[k]!==undefined).map(human)]);break;
    case 'set_volume_envelope':description=join([clip,count(a.points?.length,'volume point')]);break;
    case 'duck_audio':description=join([count(a.target_clip_ids?.length,'music clip'),count(a.speech_clip_ids?.length,'speech clip'),Number.isFinite(a.duck_volume)?`${Math.round(a.duck_volume*100)}% during speech`:'']);break;
    case 'edit_caption_words':description=join([clip,count(a.words?.length,'word'),'Aligning highlights with speech']);break;
    case 'caption_tools':description=join([clip,human(a.action),a.path?basename(a.path):'']);break;
    case 'export_subtitles':description=join(['SRT subtitle file',a.path?basename(a.path):'']);break;
    case 'inspect_frames':case 'get_storyboard':description=join([a.source==='clip'?'Source before edits':a.source==='media'?'Library source':'Composed timeline',count((a.times_sec||a.source_times_sec)?.length,'frame'),(a.times_sec||a.source_times_sec||[]).map(activityTime).join(', ')]);break;
    case 'review_section':description=join([range,'Local picture and audio measurements']);break;
    case 'complete_edit':description='Timeline integrity and sampled visual checks';break;
    case 'export_video':description=join([project.name,range,a.quality?human(a.quality)+' quality':'',a.format?human(a.format):'']);break;
    case 'set_project':description=join([a.name?clean(a.name):'',a.fps?`${a.fps} fps`:'',a.width&&a.height?`${a.width} × ${a.height}`:'',a.background?`Background ${clean(a.background)}`:'']);break;
    case 'set_aspect_ratio':description=join([clean(a.ratio),a.width&&a.height?`${a.width} × ${a.height}`:'']);break;
    case 'set_speed':description=join([clip,Number.isFinite(a.speed)?`${a.speed}× playback`:'']);break;
    case 'split_at':description=join([clip,activityTime(a.time_sec)]);break;
    case 'cut_range':description=join([range,'Related tracks move together']);break;
    case 'keep_ranges':description=(a.ranges||[]).slice(0,6).map(x=>`${activityTime(x.start_sec)} → ${activityTime(x.end_sec)}`).join(' · ');break;
    case 'trim_clip':case 'move_clip':case 'add_stock':case 'add_sound':description=join([clip,placement,a.main_index!==undefined?`Main track position ${a.main_index+1}`:'']);break;
    case 'add_media':description=join([clean(a.media_name)||project.media?.find(m=>m.id===a.media_id)?.name,placement]);break;
    case 'delete_clip':description=clip;break;
    case 'clip_tools':case 'layer_tools':description=join([clip,human(a.action),a.track?human(a.track):'',Number.isFinite(a.layer)?`Layer ${a.layer+1}`:'']);break;
    case 'list_local_media':case 'import_media':description=join([a.path?basename(a.path):'',count(a.paths?.length,'file'),a.query?clean(a.query):'']);break;
    case 'annotate_scene':description='Adding an observation to the scene context';excerpt=a.description||a.note;excerptLabel='Scene note';break;
    case 'analyze_scenes':description=join([a.scope==='media'?'Source footage':'Timeline footage',range]);break;
    case 'motion_guide':case 'edit_guide':description=human(a.topic);break;
    case 'log_footage':description=join([a.source?human(a.source)+' audio':'Speech, sentences and shots',a.include_scenes===false?'Speech only':'']);break;
    case 'remove_fillers':description=join([a.discourse?'Hesitations and discourse markers':'Hesitations (um, uh…)',a.dry_run?'Preview only':'']);break;
    case 'remove_retakes':description=join([a.retake_ids?.length?count(a.retake_ids.length,'selected retake'):'False starts and repeated takes',a.dry_run?'Preview only':'']);break;
    case 'find_highlights':description=join(['Hook and short candidates',Number.isFinite(a.clip_length_sec)?`${seconds(a.clip_length_sec)} windows`:'']);break;
    case 'propose_edit_plan':description=clean(a.goal,200);break;
    case 'critique_edit':description=join(['Pacing, hook, speech, captions and audio mix',a.platform?human(a.platform):'',Number.isFinite(a.target_duration_sec)?`Target ${seconds(a.target_duration_sec)}`:'']);break;
    case 'get_beats':description=count(a.clip_ids?.length,'audio clip')||'Timeline music';break;
    case 'track_subject':case 'pin_to_subject':description=join([clip,range,a.reframe===false?'Track position only':'']);break;
    case 'add_scene':description=join([a.color2?'Gradient background':'Solid background',placement]);break;
    case 'list_voices':description='Available narration voices and speech engines';break;
    case 'set_compositing':description=join([clip,a.blend_mode?human(a.blend_mode):'',a.chroma_key===false?'Remove chroma key':'']);break;
    case 'remove_silences':description=join([a.source?human(a.source)+' audio':'Timeline audio',Number.isFinite(a.min_silence_sec)?`Pauses longer than ${seconds(a.min_silence_sec)}`:'',Number.isFinite(a.threshold_db)?`${a.threshold_db} dB threshold`:'']);break;
    default:description=name?.startsWith('mcp_')?human(name.slice(4)):'';
  }
  if(result&&!r.error){
    if(r.status==='unchanged')outcome='Already matches the requested settings';
    else if(name==='generate_images')outcome=count(r.results?.filter(x=>!x.error).length,'scene image added','scene images added');
    else if(name==='complete_edit')outcome=r.ready?'Edit checks passed':Number.isFinite(r.checked_regions)?`${r.checked_regions} of ${r.total_regions} regions reviewed`:'';
    else if(['inspect_frames','get_storyboard','review_section'].includes(name))outcome=join([count(r.frames?.length,'frame captured','frames captured'),r.artifact?.duration_sec?`${seconds(r.artifact.duration_sec)} rendered locally`:'']);
    else if(name==='add_captions')outcome=count(r.captions,'caption created','captions created');
    else if(name==='log_footage')outcome=join([count(r.sentences_total,'sentence'),r.fillers?count(r.fillers.count,'filler'):'',Array.isArray(r.retakes)?count(r.retakes.length,'retake'):'']);
    else if(name==='critique_edit')outcome=join([Number.isFinite(r.score)?`Score ${r.score}/100`:'',count(r.issues?.length,'issue')]);
    else if(name==='get_beats')outcome=join([Number.isFinite(r.bpm)?`${r.bpm} BPM`:'',count(r.beats?.values?.length,'beat')]);
    else if(name==='find_highlights')outcome=count(r.candidates?.length,'candidate');
    else if(['remove_fillers','remove_retakes'].includes(name)&&r.dry_run)outcome=count(name==='remove_fillers'?r.cuts:r.candidates?.length,'candidate');
    else if(name==='propose_edit_plan')outcome='Waiting for your approval';
    else if(name==='transcribe')outcome=join([count(r.matched_segments??r.total_segments,'speech segment'),r.cached?'Reused existing transcript':'']);
    else if(name==='search_sounds')outcome=count(r.sounds?.length,'audio result');
    else if(name==='search_stock')outcome=count(r.items?.length,'stock result');
    else if(name==='add_keyframes')outcome=join([count(r.keyframes,'motion point applied','motion points applied'),motionNote(r.motion)]);
    else if(name==='move_along_path')outcome=join([count(r.waypoints,'waypoint'),motionNote(r.motion)]);
    else if(name==='export_video')outcome=join([basename(r.file||r.artifact?.path),r.metadata?.duration_sec?seconds(r.metadata.duration_sec):'',r.size?`${(r.size/1048576).toFixed(1)} MB`:'']);
    else if(name==='edit_caption_words')outcome=count(r.words,'word timing updated','word timings updated');
    else if(name==='set_audio_effects'&&r.live_preview===false)outcome='Saved · applies to rendered audio';
    else if(name==='add_voiceover')outcome=join(['Narration added',seconds(r.length_sec)]);
    else if(name==='generate_image'&&r.changed)outcome='Scene image added to the timeline';
    else if(Number.isFinite(r.imported_cues))outcome=count(r.imported_cues,'caption imported','captions imported');
    else if(Number.isFinite(r.removed_sec))outcome=`${seconds(r.removed_sec)} removed`;
    else if(r.changed)outcome='Applied to the timeline';
  }
  return {title:TITLES[name]||(name?.startsWith('mcp_')?'Using a connected tool':''),description:clean(description,260),excerpt:clean(excerpt,1800),excerptLabel,outcome:clean(outcome,220)};
}
export function describeToolActivity(name,args,project,result,afterProject=project) {
  // Invalid model arguments still belong to the runner's normal validation.
  // Formatting must never stop an edit or bypass that validation.
  try{return {...activity(name,args,project,result),...activityEvidence(name,args,project,result,afterProject),...(name==='propose_edit_plan'&&result?.plan&&!result.error?{plan:normalizePlan(result.plan)}:{})};}catch{return {title:TITLES[name]||'',description:'',excerpt:'',excerptLabel:'',outcome:''};}
}
export function imageActivityProgress(progress) {
  const {completed,total,inserted,active,failed,elapsed_sec}=progress;
  if(!Number.isFinite(total)||total<1)return undefined;
  return {total,completed:Number.isFinite(completed)?Math.min(total,Math.max(0,completed)):0,
    inserted:Number.isFinite(inserted)?inserted:0,active:Number.isFinite(active)?active:0,failed:Number.isFinite(failed)?failed:0,elapsed_sec:Number.isFinite(elapsed_sec)?elapsed_sec:0};
}
