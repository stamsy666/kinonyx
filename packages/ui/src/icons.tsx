import {
  AudioLines,
  Captions,
  ChartColumn,
  ChevronLeft,
  ChevronRight,
  Clapperboard,
  Database,
  Dices,
  FastForward,
  Film,
  Flame,
  FolderOpen,
  GalleryHorizontal,
  Heart,
  History,
  Info,
  ListVideo,
  MonitorPlay,
  Palette,
  Plus,
  Trash2,
  Gamepad2,
  LayoutGrid,
  Maximize,
  ZoomIn,
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
  Trophy,
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
export const ZoomInIcon = wrap(ZoomIn);
export const ExitFullscreenIcon = wrap(Minimize);
export const OfflineIcon = wrap(SignalZero, { size: 40, strokeWidth: 1.5 });
export const MoviesIcon = wrap(Film);
export const SeriesIcon = wrap(Clapperboard);
export const CartoonsIcon = wrap(Sparkles);
/** Table of cells (Heroicons "table-cells"), thinner stroke than the rest — drawn to its own grid. */
export function CategoriesIcon({ size = 22, strokeWidth = 1.5, ...rest }: LucideProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      xmlns="http://www.w3.org/2000/svg"
      className="cat-icon"
      {...(rest as object)}
    >
      <path d="M3.375 19.5H20.625M3.375 19.5C2.75368 19.5 2.25 18.9963 2.25 18.375M3.375 19.5H10.875C11.4963 19.5 12 18.9963 12 18.375M2.25 18.375V5.625M2.25 18.375V16.875C2.25 16.2537 2.75368 15.75 3.375 15.75M21.75 18.375V5.625M21.75 18.375C21.75 18.9963 21.2463 19.5 20.625 19.5M21.75 18.375V16.875C21.75 16.2537 21.2463 15.75 20.625 15.75M20.625 19.5H13.125C12.5037 19.5 12 18.9963 12 18.375M21.75 5.625C21.75 5.00368 21.2463 4.5 20.625 4.5H3.375C2.75368 4.5 2.25 5.00368 2.25 5.625M21.75 5.625V7.125C21.75 7.74632 21.2463 8.25 20.625 8.25M2.25 5.625V7.125C2.25 7.74632 2.75368 8.25 3.375 8.25M3.375 8.25H20.625M3.375 8.25H10.875C11.4963 8.25 12 8.75368 12 9.375M3.375 8.25C2.75368 8.25 2.25 8.75368 2.25 9.375V10.875C2.25 11.4963 2.75368 12 3.375 12M20.625 8.25H13.125C12.5037 8.25 12 8.75368 12 9.375M20.625 8.25C21.2463 8.25 21.75 8.75368 21.75 9.375V10.875C21.75 11.4963 21.2463 12 20.625 12M3.375 12H10.875M3.375 12C2.75368 12 2.25 12.5037 2.25 13.125V14.625C2.25 15.2463 2.75368 15.75 3.375 15.75M12 10.875V9.375M12 10.875C12 11.4963 11.4963 12 10.875 12M12 10.875C12 11.4963 12.5037 12 13.125 12M10.875 12C11.4963 12 12 12.5037 12 13.125M13.125 12H20.625M13.125 12C12.5037 12 12 12.5037 12 13.125M20.625 12C21.2463 12 21.75 12.5037 21.75 13.125V14.625C21.75 15.2463 21.2463 15.75 20.625 15.75M3.375 15.75H10.875M12 14.625V13.125M12 14.625C12 15.2463 11.4963 15.75 10.875 15.75M12 14.625C12 15.2463 12.5037 15.75 13.125 15.75M10.875 15.75C11.4963 15.75 12 16.2537 12 16.875M12 18.375V16.875M12 16.875C12 16.2537 12.5037 15.75 13.125 15.75M13.125 15.75H20.625" />
    </svg>
  );
}
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
export const CarouselIcon = wrap(GalleryHorizontal);
export const FolderIcon = wrap(FolderOpen);
export const TrashIcon = wrap(Trash2);
export const ArchiveIcon = wrap(History);
export const MicIcon = wrap(Mic);
export const FavoriteIcon = wrap(Heart);
export const NextEpisodeIcon = wrap(SkipForward, { fill: "currentColor" });
export const DiceIcon = wrap(Dices);
export const EpisodesIcon = wrap(ListVideo);

export const SourcesIcon = wrap(Database);
export const PlayerSettingsIcon = wrap(MonitorPlay);
export const ThemeIcon = wrap(Palette);
export const AboutIcon = wrap(Info);

export const StatsIcon = wrap(ChartColumn);
export const FlameIcon = wrap(Flame);
export const TrophyIcon = wrap(Trophy);
