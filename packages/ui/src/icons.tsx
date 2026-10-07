import {
  AudioLines,
  Captions,
  ChevronLeft,
  ChevronRight,
  Clapperboard,
  Dices,
  FastForward,
  Film,
  FolderOpen,
  Heart,
  History,
  ListVideo,
  Plus,
  Trash2,
  Gamepad2,
  Grid3x3,
  LayoutGrid,
  Maximize,
  Mic,
  Minimize,
  Pause,
  Play,
  Rewind,
  Search,
  Settings,
  SignalZero,
  SkipForward,
  Sparkles,
  Tv,
  Volume2,
  VolumeX,
  X,
  type LucideIcon,
  type LucideProps,
} from "lucide-react";

const DEFAULTS: Partial<LucideProps> = { size: 22, strokeWidth: 1.8 };

/** Wraps a lucide icon with our default sizing/weight, keeping the same
 *  named-component API the rest of the app uses (`<BackIcon />` etc.) —
 *  swapping icon sets doesn't touch any consuming file. */
function wrap(Icon: LucideIcon, extra?: Partial<LucideProps>) {
  return (props: LucideProps) => <Icon {...DEFAULTS} {...extra} {...props} />;
}

export const GearIcon = wrap(Settings);
export const SearchIcon = wrap(Search);
export const BackIcon = wrap(ChevronLeft);
export const NextIcon = wrap(ChevronRight);
export const CloseIcon = wrap(X);
export const PlayIcon = wrap(Play, { fill: "currentColor" });
export const PauseIcon = wrap(Pause, { fill: "currentColor" });
export const FullscreenIcon = wrap(Maximize);
export const ExitFullscreenIcon = wrap(Minimize);
export const OfflineIcon = wrap(SignalZero, { size: 40, strokeWidth: 1.5 });
export const MoviesIcon = wrap(Film);
export const SeriesIcon = wrap(Clapperboard);
export const CartoonsIcon = wrap(Sparkles);
export const CategoriesIcon = wrap(Grid3x3);
export const ChannelsIcon = wrap(Tv);
export const HomeIcon = wrap(LayoutGrid);
export const ControllerIcon = wrap(Gamepad2);
export const TracksIcon = wrap(AudioLines);
export const SubtitlesIcon = wrap(Captions);
export const RewindIcon = wrap(Rewind);
export const ForwardIcon = wrap(FastForward);
export const VolumeIcon = wrap(Volume2);
export const MuteIcon = wrap(VolumeX);
export const PlusIcon = wrap(Plus);
export const FolderIcon = wrap(FolderOpen);
export const TrashIcon = wrap(Trash2);
export const ArchiveIcon = wrap(History);
export const MicIcon = wrap(Mic);
export const FavoriteIcon = wrap(Heart);
export const NextEpisodeIcon = wrap(SkipForward, { fill: "currentColor" });
export const DiceIcon = wrap(Dices);
export const EpisodesIcon = wrap(ListVideo);
