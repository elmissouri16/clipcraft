import { videoLayout } from '../../state/store.js';
import { activityEvidence } from './activityEvidence.js';
import { normalizePlan } from './editorialTools.js';
import { toolTargets } from './toolTargets.js';
import { normalizeClipSuggestions } from './activityData.js';
import { t, tn } from '../../i18n/index.js';
// Bounded display data only. Local image/output references have their own typed
// schema; never copy raw arguments/results, credentials or image bytes here.
// Titles, descriptions and outcomes are panel text (docs/design/localization.md): shown to the user
// and saved in the chat history, never sent to the model. Argument values (ids, topics, engine
// names) stay as the model wrote them.
const clean=(value,max=180)=>typeof value==='string'?value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g,'').trim().slice(0,max):'';
const human=value=>clean(value).replace(/[_-]+/g,' ');
const join=values=>values.filter(v=>v!==undefined&&v!==null&&v!=='').join(' · ');
const basename=value=>clean(value,500).split(/[\\/]/).at(-1);
export const activityTime=value=>{if(!Number.isFinite(value))return '';const ticks=Math.round(Math.max(0,value)*10);return `${Math.floor(ticks/600).toString().padStart(2,'0')}:${((ticks%600)/10).toFixed(1).padStart(4,'0')}`;};
const seconds=value=>Number.isFinite(value)?`${Number(value.toFixed(2))}s`:'';
const count=(n,key)=>Number.isFinite(n)?tn(key,n):'';
// Motion measured after a keyframe edit (src/features/timeline/motionQuality.js), in a few words.
const motionNote=m=>{if(!m)return '';const turns=(m.reversals||[]).filter(r=>!r.after_hold).length,issues=[[m.stops?.length||0,'activity.stops'],[m.jerks?.length||0,'activity.jolts'],[turns,'activity.reversals']].filter(([n])=>n>0).map(([n,key])=>tn(key,n));return issues.length?issues.join(', '):t('activity.smooth_motion');};
const TITLES={
  list_plugin_commands:t('plugins.agent_discover'),run_plugin_command:t('plugins.agent_run'),
  delegate_video_analysis:t('subagents.delegating'),
  get_video_analysis:t('discovery.analysis'),read_video_transcript:t('discovery.transcript'),
  index_video:t('discovery.indexing'),find_video_moments:t('discovery.finding'),review_video_moment:t('discovery.reviewing'),propose_video_clips:t('discovery.proposing'),add_video_clip:t('discovery.adding'),
  get_project:t('activity.reading_the_timeline'),list_options:t('activity.finding_available_styles'),load_tools:t('activity.preparing_editing_tools'),recall_context:t('activity.recalling_earlier_work'),
  analyze_reference:t('activity.studying_the_reference_edit'),analyze_scenes:t('activity.finding_scene_boundaries'),get_storyboard:t('activity.reviewing_scene_samples'),annotate_scene:t('activity.saving_a_scene_note'),
  remove_silences:t('activity.removing_silent_sections'),cut_range:t('activity.cutting_a_section'),keep_ranges:t('activity.keeping_selected_sections'),delete_clip:t('activity.removing_a_clip'),
  split_at:t('activity.splitting_a_clip'),set_speed:t('activity.changing_playback_speed'),move_clip:t('activity.moving_a_clip'),trim_clip:t('activity.trimming_a_clip'),clip_tools:t('activity.editing_a_clip'),
  layer_tools:t('activity.organizing_layers'),transcribe:t('activity.transcribing_speech'),add_captions:t('activity.creating_captions'),add_text:t('activity.adding_text'),edit_text:t('activity.updating_text'),
  edit_caption_words:t('activity.correcting_caption_timing'),caption_tools:t('activity.editing_captions'),export_subtitles:t('activity.saving_subtitles'),
  set_volume:t('activity.adjusting_audio_level'),set_audio_effects:t('activity.processing_audio'),set_volume_envelope:t('activity.shaping_volume_over_time'),duck_audio:t('activity.lowering_music_beneath_speech'),
  search_sounds:t('activity.finding_audio'),add_sound:t('activity.adding_audio'),list_voices:t('activity.finding_a_voice'),add_voiceover:t('activity.generating_narration'),add_narration:t('activity.generating_narration'),
  set_filter:t('activity.applying_a_filter'),set_effects:t('activity.applying_clip_effects'),add_effect:t('activity.adding_an_effect_layer'),set_color:t('activity.adjusting_color'),set_compositing:t('activity.compositing_the_picture'),
  add_transition:t('activity.joining_two_shots'),set_aspect_ratio:t('activity.changing_video_format'),set_transform:t('activity.positioning_the_picture'),zoom:t('activity.adding_a_zoom'),add_keyframes:t('activity.building_motion'),move_along_path:t('activity.moving_along_a_path'),graphics_guide:t('activity.reading_the_graphics_guide'),add_graphic:t('activity.drawing_a_motion_graphic'),edit_graphic:t('activity.redrawing_a_motion_graphic'),
  set_animation:t('activity.animating_the_picture'),motion_guide:t('activity.planning_motion'),track_subject:t('activity.following_a_subject'),pin_to_subject:t('activity.attaching_to_a_subject'),
  add_media:t('activity.placing_media'),list_local_media:t('activity.finding_files'),import_media:t('activity.importing_media'),search_stock:t('activity.finding_stock_media'),add_stock:t('activity.adding_stock_media'),
  add_scene:t('activity.creating_a_background'),generate_image:t('activity.generating_a_scene_image'),generate_images:t('activity.generating_scene_images'),inspect_frames:t('activity.inspecting_the_picture'),
  edit_guide:t('activity.reading_the_editing_playbook'),log_footage:t('activity.logging_the_footage'),remove_fillers:t('activity.removing_filler_words'),remove_retakes:t('activity.removing_retakes'),
  find_highlights:t('activity.finding_the_strongest_moments'),propose_edit_plan:t('plan.edit_plan'),critique_edit:t('activity.reviewing_the_edit'),get_beats:t('activity.finding_the_beat'),
  review_section:t('activity.reviewing_a_rendered_section'),complete_edit:t('activity.checking_the_completed_edit'),export_video:t('activity.exporting_the_video'),undo:t('activity.undoing_this_request'),
};
const LANES=[['videoClips','activity.main_track'],['overlayClips','activity.overlay'],['audioClips','edit-plan-card.audio'],['textClips','tts.text'],['effectClips','library.effects']];
function target(project,id) {
  if(id==='captions')return t('activity.all_captions');
  if(!id)return '';
  for(const [key,lane] of LANES){
    const clip=project?.[key]?.find(c=>c.id===id);
    if(clip){const media=project.media?.find(m=>m.id===clip.mediaId),at=key==='videoClips'?videoLayout(project.videoClips).find(row=>row.clip.id===id)?.start:clip.start;return join([clean(clip.text||clip.name||media?.name,70)||t(lane),activityTime(at)]);}
  }
  return '';
}
function activity(name,args={},project={},result) {
  const a=args||{},r=result||{},range=join([activityTime(a.start_sec),activityTime(a.end_sec)]).replace(' · ',' → ');
  const sourceAudio=source=>source?t('activity.source_audio',{source:human(source)}):t('activity.timeline_audio');
  const clip=target(project,a.clip_id),placement=join([a.as==='main'?t('activity.main_track'):a.as==='overlay'?t('activity.overlay'):a.as==='audio'?t('edit-plan-card.audio'):'',range,seconds(a.duration_sec)]);
  let description='',excerpt='',excerptLabel='',outcome='',unchanged=false;
  switch(name){
    case 'get_project':description=join([a.scope&&a.scope!=='all'?human(a.scope):t('activity.current_clips_layers_and_timing'),a.clip_ids?.length?count(a.clip_ids.length,'activity.selected_clips'):'']);break;
    case 'list_options':description=human(a.what);break;
    case 'load_tools':description=(a.groups||[]).map(human).join(' · ');break;
    case 'recall_context':description=join([t('activity.earlier_conversation_and_tool_results'),a.query?t('activity.search_query',{query:clean(a.query)}):'']);break;
    case 'generate_image':description=join(['Codex',placement,a.reference_media_ids?.length?count(a.reference_media_ids.length,'activity.reference_images'):'']);excerpt=a.prompt;excerptLabel=t('activity.image_prompt');break;
    case 'generate_images':description=join([count(a.scenes?.length,'activity.scene_images'),t('activity.inserted_in_scene_order')]);excerpt=(a.scenes||[]).slice(0,12).map((s,i)=>`${i+1}. ${join([activityTime(s.start_sec),seconds(s.duration_sec)])}\n${clean(s.prompt,350)}`).join('\n\n');excerptLabel=t('activity.scene_prompts');break;
    case 'add_voiceover':description=join([a.engine?human(a.engine):t('activity.automatic_voice_selection'),a.voice_id?human(a.voice_id):'',placement]);excerpt=a.text;excerptLabel=t('activity.narration');break;
    case 'add_narration':description=join(['gemini',a.voice_id?human(a.voice_id):'',Array.isArray(a.lines)?tn('activity.lines',a.lines.length):'']);excerpt=Array.isArray(a.lines)?a.lines.map(l=>typeof l==='string'?l:l?.text).filter(Boolean).join(' / '):'';excerptLabel=t('activity.narration');break;
    case 'add_text':case 'edit_text':description=join([clip||t('activity.text_layer'),placement,...Object.entries(a).filter(([key])=>!['clip_id','text','start_sec','duration_sec','retry_of'].includes(key)).map(([key,value])=>`${human(key)}: ${typeof value==='string'?human(value):typeof value==='boolean'?(value?t('activity.on'):t('activity.off')):Number.isFinite(value)?value:''}`)]);excerpt=a.text;excerptLabel=t('tts.text');break;
    case 'transcribe':case 'add_captions':description=join([sourceAudio(a.source),a.language?human(a.language):'',a.style_id?human(a.style_id):'',a.words_per_caption?tn('activity.words_per_caption',a.words_per_caption):'']);break;
    case 'search_sounds':case 'search_stock':case 'web_search':description=join([a.kind?human(a.kind):'',a.query?`“${clean(a.query)}”`:'']);break;
    case 'add_keyframes':description=join([clip,human(a.property),count(a.keys?.length,'activity.motion_points'),a.easing?human(a.easing):'']);break;
    case 'add_graphic':case 'edit_graphic':description=join([a.name||clip,Number.isFinite(a.duration_sec)?`${a.duration_sec}s`:'',Array.isArray(a.fonts)&&a.fonts.length?a.fonts.join(', '):'',a.inputs?count(Object.keys(a.inputs).length,'activity.inputs'):'']);break;
    case 'move_along_path':description=join([clip,count(a.points?.length,'activity.waypoints'),a.orient?t('activity.facing_the_way_it_moves'):'']);break;
    case 'set_animation':description=join([clip,a.in?t('activity.in_easing',{value:human(a.in)}):'',a.out?t('activity.out_easing',{value:human(a.out)}):'',a.combo?human(a.combo):'']);break;
    case 'set_transform':description=join([clip,a.scale!==undefined?t('activity.scale_factor',{scale:a.scale}):'',a.x!==undefined?`X ${a.x}`:'',a.y!==undefined?`Y ${a.y}`:'',a.rotation!==undefined?`${a.rotation}°`:'',a.fit?human(a.fit):'']);break;
    case 'zoom':description=join([range,a.scale?`${a.scale}×`:'',a.smooth===false?t('activity.quick_punch_in'):t('activity.smooth_ramp')]);break;
    case 'set_color':description=join([clip,...['brightness','contrast','saturation','hue','blur'].filter(k=>a[k]!==undefined).map(k=>`${human(k)} ${a[k]}`)]);break;
    case 'set_filter':description=join([clip,human(a.filter_id),a.intensity!==undefined?t('activity.intensity',{intensity:a.intensity}):'']);break;
    case 'set_effects':description=join([clip,(a.effect_ids||[]).map(human).join(', ')]);break;
    case 'add_effect':description=join([human(a.effect_id),placement]);break;
    case 'add_transition':description=join([clip,human(a.type),seconds(a.duration_sec)]);break;
    case 'set_volume':description=join([clip,Number.isFinite(a.volume)?t('activity.percent_level',{percent:Math.round(a.volume*100)}):'',a.muted?t('activity.muted'):'']);break;
    case 'set_audio_effects':description=join([clip,a.preset?human(a.preset):'',...['eq','highpass','lowpass','comp','limit','denoise','loudnorm','pitch','echo'].filter(k=>a[k]!==undefined).map(human)]);break;
    case 'set_volume_envelope':description=join([clip,count(a.points?.length,'activity.volume_points')]);break;
    case 'duck_audio':description=join([count(a.target_clip_ids?.length,'activity.music_clips'),count(a.speech_clip_ids?.length,'activity.speech_clips'),Number.isFinite(a.duck_volume)?t('activity.percent_during_speech',{percent:Math.round(a.duck_volume*100)}):'']);break;
    case 'edit_caption_words':description=join([clip,count(a.words?.length,'activity.words'),t('activity.aligning_highlights_with_speech')]);break;
    case 'caption_tools':description=join([clip,human(a.action),a.path?basename(a.path):'']);break;
    case 'list_plugin_commands':description=clean(a.query);break;
    case 'run_plugin_command':description=clean(r.command_name||a.command_id);break;
    case 'export_subtitles':description=join([t('activity.srt_subtitle_file'),a.path?basename(a.path):'']);break;
    case 'inspect_frames':case 'get_storyboard':description=join([a.source==='clip'?t('activity.source_before_edits'):a.source==='media'?t('activity.library_source'):t('activity.composed_timeline'),count((a.times_sec||a.source_times_sec)?.length,'activity.frames'),(a.times_sec||a.source_times_sec||[]).map(activityTime).join(', ')]);break;
    case 'review_section':description=join([range,t('activity.local_picture_and_audio_measurements')]);break;
    case 'complete_edit':description=t('activity.timeline_integrity_and_sampled_visual_checks');break;
    case 'export_video':description=join([project.name,range,a.quality?t('activity.quality',{quality:human(a.quality)}):'',a.format?human(a.format):'']);break;
    case 'set_project':description=join([a.name?clean(a.name):'',a.fps?`${a.fps} fps`:'',a.width&&a.height?`${a.width} × ${a.height}`:'',a.background?t('activity.background',{color:clean(a.background)}):'']);break;
    case 'set_aspect_ratio':description=join([clean(a.ratio),a.width&&a.height?`${a.width} × ${a.height}`:'']);break;
    case 'set_speed':description=join([clip,Number.isFinite(a.speed)?t('activity.playback_speed',{speed:a.speed}):'']);break;
    case 'split_at':description=join([clip,activityTime(a.time_sec)]);break;
    case 'cut_range':description=join([range,t('activity.related_tracks_move_together')]);break;
    case 'keep_ranges':description=(a.ranges||[]).slice(0,6).map(x=>`${activityTime(x.start_sec)} → ${activityTime(x.end_sec)}`).join(' · ');break;
    case 'trim_clip':case 'move_clip':case 'add_stock':case 'add_sound':description=join([clip,placement,a.main_index!==undefined?t('activity.main_track_position',{position:a.main_index+1}):'']);break;
    case 'add_media':description=join([clean(a.media_name)||project.media?.find(m=>m.id===a.media_id)?.name,placement]);break;
    case 'delete_clip':description=clip;break;
    case 'clip_tools':case 'layer_tools':description=join([clip,human(a.action),a.track?human(a.track):'',Number.isFinite(a.layer)?t('activity.layer_number',{layer:a.layer+1}):'']);break;
    case 'list_local_media':case 'import_media':description=join([a.path?basename(a.path):'',count(a.paths?.length,'activity.files'),a.query?clean(a.query):'']);break;
    case 'annotate_scene':description=t('activity.adding_an_observation_to_the_scene');excerpt=a.description||a.note;excerptLabel=t('activity.scene_note');break;
    case 'analyze_scenes':description=join([a.scope==='media'?t('activity.source_footage'):t('activity.timeline_footage'),range]);break;
    case 'motion_guide':case 'edit_guide':description=human(a.topic);break;
    case 'log_footage':description=join([a.source?sourceAudio(a.source):t('activity.speech_sentences_and_shots'),a.include_scenes===false?t('activity.speech_only'):'']);break;
    case 'remove_fillers':description=join([a.discourse?t('activity.hesitations_and_discourse_markers'):t('activity.hesitations_um_uh'),a.dry_run?t('activity.preview_only'):'']);break;
    case 'remove_retakes':description=join([a.retake_ids?.length?count(a.retake_ids.length,'activity.selected_retakes'):t('activity.false_starts_and_repeated_takes'),a.dry_run?t('activity.preview_only'):'']);break;
    case 'find_highlights':description=join([t('activity.hook_and_short_candidates'),Number.isFinite(a.clip_length_sec)?t('activity.windows',{seconds:seconds(a.clip_length_sec)}):'']);break;
    case 'propose_edit_plan':description=clean(a.goal,200);break;
    case 'critique_edit':description=join([t('activity.pacing_hook_speech_captions_and_audio_mix'),a.platform?human(a.platform):'',Number.isFinite(a.target_duration_sec)?t('activity.target',{seconds:seconds(a.target_duration_sec)}):'']);break;
    case 'get_beats':description=count(a.clip_ids?.length,'activity.audio_clips')||t('activity.timeline_music');break;
    case 'track_subject':case 'pin_to_subject':description=join([clip,range,a.reframe===false?t('activity.track_position_only'):'']);break;
    case 'add_scene':description=join([a.color2?t('activity.gradient_background'):t('activity.solid_background'),placement]);break;
    case 'list_voices':description=t('activity.available_narration_voices_and_engines');break;
    case 'set_compositing':description=join([clip,a.blend_mode?human(a.blend_mode):'',a.chroma_key===false?t('activity.remove_chroma_key'):'']);break;
    case 'remove_silences':description=join([sourceAudio(a.source),Number.isFinite(a.min_silence_sec)?t('activity.pauses_longer_than',{seconds:seconds(a.min_silence_sec)}):'',Number.isFinite(a.threshold_db)?t('activity.db_threshold',{db:a.threshold_db}):'']);break;
    default:description=name?.startsWith('mcp_')?human(name.slice(4)):'';
  }
  if(result&&!r.error){
    if(r.status==='unchanged'){outcome=t('activity.already_matches_the_requested_settings');unchanged=true;}
    else if(name==='run_plugin_command')outcome=r.artifact?.format==='gif'?`GIF saved · ${r.artifact.width}×${r.artifact.height} · ${r.artifact.duration_sec} s`:Number.isInteger(r.clips_changed)?tn('plugins.clips_completed',r.clips_changed):r.captions_added?t('plugins.translation_completed',{count:r.captions_added,track:r.caption_track}):tn('plugins.agent_result',r.markers_added||0);
    else if(name==='list_plugin_commands')outcome=tn('plugins.agent_commands_found',r.commands?.length||0);
    else if(name==='generate_images')outcome=count(r.results?.filter(x=>!x.error).length,'activity.scene_images_added_count');
    else if(name==='complete_edit')outcome=r.ready?t('activity.edit_checks_passed'):Number.isFinite(r.checked_regions)?t('activity.regions_reviewed',{checked:r.checked_regions,total:r.total_regions}):'';
    else if(['inspect_frames','get_storyboard','review_section'].includes(name))outcome=join([count(r.frames?.length,'activity.frames_captured'),r.artifact?.duration_sec?t('activity.rendered_locally',{seconds:seconds(r.artifact.duration_sec)}):'']);
    else if(name==='add_captions')outcome=count(r.captions,'activity.captions_created_count');
    else if(name==='log_footage')outcome=join([count(r.sentences_total,'activity.sentences'),r.fillers?count(r.fillers.count,'activity.fillers'):'',Array.isArray(r.retakes)?count(r.retakes.length,'activity.retakes'):'']);
    else if(name==='critique_edit')outcome=join([Number.isFinite(r.score)?t('activity.score',{score:r.score}):'',count(r.issues?.length,'activity.issues')]);
    else if(name==='get_beats')outcome=join([Number.isFinite(r.bpm)?`${r.bpm} BPM`:'',count(r.beats?.values?.length,'activity.beats')]);
    else if(name==='find_highlights'||name==='find_video_moments')outcome=count(r.candidates?.length,'activity.candidates');
    else if(name==='delegate_video_analysis')outcome=r.partial?t('subagents.partial'):tn('subagents.tasks_completed',r.tasks?.length||0);
    else if(name==='index_video')outcome=t('discovery.chunks_done',{completed:r.completed_chunks,total:r.total_chunks});
    else if(name==='propose_video_clips')outcome=count(r.picks?.length,'activity.candidates');
    else if(name==='review_video_moment')outcome=count(r.frames?.length,'activity.frames_captured');
    else if(['remove_fillers','remove_retakes'].includes(name)&&r.dry_run)outcome=count(name==='remove_fillers'?r.cuts:r.candidates?.length,'activity.candidates');
    else if(name==='propose_edit_plan')outcome=t('activity.waiting_for_your_approval');
    else if(name==='transcribe')outcome=join([count(r.matched_segments??r.total_segments,'activity.speech_segments'),r.cached?t('activity.reused_existing_transcript'):'']);
    else if(name==='search_sounds')outcome=count(r.sounds?.length,'activity.audio_results');
    else if(name==='search_stock')outcome=count(r.items?.length,'activity.stock_results');
    else if(name==='add_keyframes')outcome=join([count(r.keyframes,'activity.motion_points_applied'),motionNote(r.motion)]);
    else if(name==='add_graphic'||name==='edit_graphic')outcome=join([r.cached?t('activity.reused_the_earlier_render'):Number.isFinite(r.render_ms)?t('activity.rendered_in_seconds',{seconds:(r.render_ms/1000).toFixed(1)}):'',r.font_warning?t('activity.fallback_font_used'):'']);
    else if(name==='move_along_path')outcome=join([count(r.waypoints,'activity.waypoints'),motionNote(r.motion)]);
    else if(name==='export_video')outcome=join([basename(r.file||r.artifact?.path),r.metadata?.duration_sec?seconds(r.metadata.duration_sec):'',r.size?`${(r.size/1048576).toFixed(1)} MB`:'']);
    else if(name==='edit_caption_words')outcome=count(r.words,'activity.word_timings_updated');
    else if(name==='set_audio_effects'&&r.live_preview===false)outcome=t('activity.saved_applies_to_rendered_audio');
    else if(name==='add_voiceover')outcome=join([t('activity.narration_added'),seconds(r.length_sec)]);
    else if(name==='add_narration')outcome=join([tn('activity.narration_lines_added',r.clips?.length||0),r.requests===1?t('activity.one_request'):'']);
    else if(name==='generate_image'&&r.changed)outcome=t('activity.scene_image_added_to_the_timeline');
    else if(Number.isFinite(r.imported_cues))outcome=count(r.imported_cues,'activity.captions_imported');
    else if(Number.isFinite(r.removed_sec))outcome=t('activity.seconds_removed',{seconds:seconds(r.removed_sec)});
    else if(r.changed)outcome=t('activity.applied_to_the_timeline');
  }
  return {title:TITLES[name]||(name?.startsWith('mcp_')?t('activity.using_a_connected_tool'):''),description:clean(description,260),excerpt:clean(excerpt,1800),excerptLabel,outcome:clean(outcome,220),...(unchanged?{unchanged:true}:{})};
}
// actions: the reducer actions the call dispatched (runner.lastActions()), for exact done targets.
export function describeToolActivity(name,args,project,result,afterProject=project,actions=[]) {
  // Invalid model arguments still belong to the runner's normal validation.
  // Formatting must never stop an edit or bypass that validation.
  try{const targets=toolTargets(name,args,project,result,afterProject,actions);return {...activity(name,args,project,result),...activityEvidence(name,args,project,result,afterProject),...(targets?{targets}:{}),...(name==='propose_edit_plan'&&result?.plan&&!result.error?{plan:normalizePlan(result.plan)}:{}),
    ...(['index_video','propose_video_clips'].includes(name)&&result?.ok&&!result.error?{discovery:normalizeClipSuggestions(result)}:{})};}catch{return {title:TITLES[name]||'',description:'',excerpt:'',excerptLabel:'',outcome:''};}
}
export function imageActivityProgress(progress) {
  const {completed,total,inserted,active,failed,elapsed_sec}=progress;
  if(!Number.isFinite(total)||total<1)return undefined;
  return {total,completed:Number.isFinite(completed)?Math.min(total,Math.max(0,completed)):0,
    inserted:Number.isFinite(inserted)?inserted:0,active:Number.isFinite(active)?active:0,failed:Number.isFinite(failed)?failed:0,elapsed_sec:Number.isFinite(elapsed_sec)?elapsed_sec:0};
}
