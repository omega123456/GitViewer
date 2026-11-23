import { useRef, useState, type ReactNode, type RefObject } from 'react';
import {
  Columns2,
  Layers,
  Maximize,
  MoveHorizontal,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { useActions } from '../../lib/actions';
import type { Action } from '../../lib/keyboard';
import type { Diff, Selection } from '../../lib/types';
import {
  useImageViews,
  useTabImageView,
  type ImageMode,
} from '../../stores/image-view';
import { ViewSwitch } from '../shared/ViewSwitch';
import { dynamic } from '../shared/styles';
import { ErrorRow } from '../states/Errors';
import { ImageMeta } from './ImageMeta';
import { OnionSkin, BlendSlider } from './OnionSkin';
import { SideBySide } from './SideBySide';
import { SwipeCompare } from './SwipeCompare';
import { ZoomControls } from './ZoomControls';
import { imageUrl } from './url';
import { scopeKey } from '../../lib/git';
import { stepIndex } from '../../lib/list';
const FALLBACK_IMAGE_WIDTH = 600;
const MINIMUM_ZOOM_WIDTH = 100;
const ZOOM_STEP = 100;
const order: ImageMode[] = ['side by side', 'swipe', 'onion skin'];
interface ModeStage {
  diff: Diff;
  view: string;
  image: (side: 'old' | 'new') => ReactNode;
}
const modeStages: Record<ImageMode, (stage: ModeStage) => ReactNode> = {
  'side by side': ({ diff, image }) => <SideBySide diff={diff} image={image} />,
  swipe: ({ view, image }) => <SwipeCompare view={view} image={image} />,
  'onion skin': ({ view, image }) => <OnionSkin view={view} image={image} />,
};
interface ImageActions {
  cycleMode: () => void;
  zoomIn: () => void;
  zoomOut: () => void;
  fit: () => void;
}
function imageShortcuts({
  cycleMode,
  zoomIn,
  zoomOut,
  fit,
}: ImageActions): Action[] {
  return [
    {
      id: 'image-mode',
      icon: <Layers className="size-3.5" />,
      label: 'Cycle image comparison mode',
      key: 'Mod+Alt+i',
      run: cycleMode,
    },
    {
      id: 'image-zoom-in',
      icon: <ZoomIn className="size-3.5" />,
      label: 'Zoom image in',
      key: 'Mod+=',
      run: zoomIn,
    },
    {
      id: 'image-zoom-out',
      icon: <ZoomOut className="size-3.5" />,
      label: 'Zoom image out',
      key: 'Mod+-',
      run: zoomOut,
    },
    {
      id: 'image-fit',
      icon: <Maximize className="size-3.5" />,
      label: 'Fit image',
      key: 'Mod+0',
      run: fit,
    },
  ];
}
function ImageSide({
  repo,
  selection,
  diff,
  version,
  side,
  zoom,
  onError,
}: {
  repo: string;
  selection: Selection;
  diff: Diff;
  version: number;
  side: 'old' | 'new';
  zoom: number;
  onError: () => void;
}) {
  const size = side === 'old' ? diff.oldSize : diff.newSize;
  if (size <= 0)
    return (
      <span className="text-xs text-muted">
        {side === 'old' ? 'No previous image' : 'Image deleted'}
      </span>
    );
  const dimension = side === 'old' ? diff.oldDimensions : diff.newDimensions;
  return (
    <img
      draggable={false}
      alt={side === 'old' ? 'Before' : 'After'}
      width={dimension?.width}
      height={dimension?.height}
      src={imageUrl({
        repo: repo,
        selection: selection,
        side: side,
        version: version,
      })}
      onError={onError}
      className={`max-h-full object-contain ${zoom ? 'w-image max-w-none shrink-0' : 'max-w-full'}`}
      style={dynamic({ '--image-width': `${zoom}px` })}
    />
  );
}
function useImageControls(
  view: string,
  stage: RefObject<HTMLDivElement | null>,
) {
  const { mode, zoom } = useTabImageView(view);
  const update = useImageViews((state) => state.update);
  const current = () =>
    zoom ||
    stage.current?.querySelector('img')?.clientWidth ||
    FALLBACK_IMAGE_WIDTH;
  const zoomOut = () =>
    update(view, { zoom: Math.max(MINIMUM_ZOOM_WIDTH, current() - ZOOM_STEP) });
  const zoomIn = () => update(view, { zoom: current() + ZOOM_STEP });
  const fit = () => update(view, { zoom: 0 });
  const cycleMode = () =>
    update(view, {
      mode: order[stepIndex(order.indexOf(mode), 1, order.length)],
    });
  const setMode = (next: ImageMode) => update(view, { mode: next });
  return { mode, zoom, zoomIn, zoomOut, fit, cycleMode, setMode };
}
function ImageModeBar({
  mode,
  onChange,
}: {
  mode: ImageMode;
  onChange: (mode: ImageMode) => void;
}) {
  return (
    <div className="flex shrink-0 items-center gap-2 border-b border-line bg-sub px-3 py-2 dark:border-line-dark dark:bg-sub-dark">
      <ViewSwitch
        label="Image comparison mode"
        value={mode}
        options={order}
        icons={{
          'side by side': <Columns2 className="size-4" />,
          swipe: <MoveHorizontal className="size-4" />,
          'onion skin': <Layers className="size-4" />,
        }}
        onChange={onChange}
      />
    </div>
  );
}
export function ImageDiff({
  repo,
  view = repo,
  selection,
  diff,
  version = 0,
}: {
  repo: string;
  view?: string;
  selection: Selection;
  diff: Diff;
  version?: number;
}) {
  const [imageError, setImageError] = useState(false);
  const stage = useRef<HTMLDivElement>(null);
  const controls = useImageControls(view, stage);
  const shortcuts = imageShortcuts(controls);
  useActions(scopeKey(repo, 'image'), view === repo ? shortcuts : []);
  const image = (side: 'old' | 'new') => (
    <ImageSide
      repo={repo}
      selection={selection}
      diff={diff}
      version={version}
      side={side}
      zoom={controls.zoom}
      onError={() => setImageError(true)}
    />
  );
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ImageMeta diff={diff} />
      <ImageModeBar mode={controls.mode} onChange={controls.setMode} />
      {imageError && (
        <ErrorRow
          label="Image could not be decoded. Open it in the system application."
          error={{ message: selection.path }}
        />
      )}
      <div
        ref={stage}
        className="relative flex min-h-0 flex-1 items-center justify-center overflow-auto bg-checker p-6 dark:bg-checker-dark"
      >
        {modeStages[controls.mode]({ diff, view, image })}
        <ZoomControls
          zoomIn={controls.zoomIn}
          zoomOut={controls.zoomOut}
          fit={controls.fit}
        />
      </div>
      {controls.mode === 'onion skin' && <BlendSlider view={view} />}
    </div>
  );
}
