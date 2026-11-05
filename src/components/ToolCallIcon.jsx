import React from 'react';
import { ClipboardList, ListFilter, AudioLines, Scissors, ListChecks, Speech, Captions, Type,
  TextCursorInput, Trash2, Split, Gauge, Volume2, SlidersHorizontal, Layers, Blend,
  RectangleHorizontal, ZoomIn, Move, Diamond, Clapperboard, FolderPlus, Search, Music,
  Users, Mic, Telescope, Film, Sparkles, ArrowLeftRight, Crop, Wrench, Palette, Pipette,
  Settings2, BookOpen, WandSparkles, ImagePlus, Undo2, Download, Library, History, PlugZap, Shuffle } from 'lucide-react';

export const TOOL_ICONS = {
  get_project: ClipboardList, list_options: ListFilter, remove_silences: AudioLines,
  cut_range: Scissors, keep_ranges: ListChecks, transcribe: Speech, add_captions: Captions,
  add_text: Type, edit_text: TextCursorInput, delete_clip: Trash2, split_at: Split,
  set_speed: Gauge, set_volume: Volume2, set_filter: SlidersHorizontal, set_effects: Layers,
  add_transition: Blend, set_aspect_ratio: RectangleHorizontal, zoom: ZoomIn, set_transform: Move,
  add_keyframes: Diamond, set_animation: Clapperboard, add_media: FolderPlus, search_sounds: Search,
  add_sound: Music, list_voices: Users, add_voiceover: Mic, search_stock: Telescope, add_stock: Film,
  add_effect: Sparkles, move_clip: ArrowLeftRight, trim_clip: Crop, clip_tools: Wrench,
  set_color: Palette, set_compositing: Pipette, set_project: Settings2, motion_guide: BookOpen,
  edit_style: WandSparkles, add_scene: ImagePlus, undo: Undo2, export_video: Download,
  load_tools: Library, recall_context: History, switch: Shuffle, mcp: PlugZap,
};
export default function ToolCallIcon({ name }) {
  const toolName = typeof name === 'string' ? name : 'unknown';
  const Icon = Object.hasOwn(TOOL_ICONS, toolName) ? TOOL_ICONS[toolName] : toolName.startsWith('mcp_') ? PlugZap : Wrench;
  return <span className="pilot-step-kind" data-tool-icon={toolName} aria-hidden="true"><Icon size={13} /></span>;
}
