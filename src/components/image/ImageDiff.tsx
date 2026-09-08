import { useState } from 'react';
import {
  Columns2,
  Layers,
  Maximize,
  MoveHorizontal,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { useActions } from '../../lib/actions';
import type { Diff, Selection } from '../../lib/types';
import {
  useImageViews,
  useTabImageView,
  type ImageMode,
} from '../../stores/image-view';
import { Segment } from '../shared/Segment';
import { dynamic } from '../shared/styles';
import { ImageMeta } from './ImageMeta';
import { OnionSkin, BlendSlider } from './OnionSkin';
import { SideBySide } from './SideBySide';
import { SwipeCompare } from './SwipeCompare';
import { ZoomControls } from './ZoomControls';
import { imageUrl } from './url';
const order: ImageMode[] = ['side by side', 'swipe', 'onion skin'];
export function ImageDiff({
  repo,
  selection,
  diff,
}: {
  repo: string;
  selection: Selection;
  diff: Diff;
}) {
  const { mode, zoom } = useTabImageView(repo);
  const update = useImageViews((s) => s.update);
  const [imageError, setImageError] = useState(false);
  const zoomOut = () =>
    update(repo, { zoom: Math.max(100, (zoom || 600) - 100) });
  const zoomIn = () => update(repo, { zoom: (zoom || 600) + 100 });
  const fit = () => update(repo, { zoom: 0 });
  useActions(`${repo}:image`, [
    {
      id: 'image-mode',
      icon: <Layers className="size-3.5" />,
      label: 'Cycle image comparison mode',
      key: 'Mod+Alt+i',
      run: () =>
        update(repo, {
          mode: order[(order.indexOf(mode) + 1) % order.length],
        }),
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
  ]);
  const image = (side: 'old' | 'new') =>
    (side === 'old' ? diff.oldSize : diff.newSize) > 0 ? (
      <img
        draggable={false}
        alt={side === 'old' ? 'Before' : 'After'}
        src={imageUrl(repo, selection, side)}
        onError={() => setImageError(true)}
        className={`max-h-full object-contain ${zoom ? 'w-image max-w-none' : 'max-w-full'}`}
        style={dynamic({ '--image-width': `${zoom}px` })}
      />
    ) : (
      <span className="text-xs text-muted">
        {side === 'old' ? 'No previous image' : 'Image deleted'}
      </span>
    );
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ImageMeta diff={diff} />
      <div className="flex shrink-0 items-center gap-2 border-b border-line bg-sub px-3 py-2 dark:border-line-dark dark:bg-sub-dark">
        <Segment
          label="Image comparison mode"
          value={mode}
          options={order}
          icons={{
            'side by side': <Columns2 className="size-3" />,
            swipe: <MoveHorizontal className="size-3" />,
            'onion skin': <Layers className="size-3" />,
          }}
          onChange={(next) => update(repo, { mode: next })}
        />
      </div>
      {imageError && (
        <p role="alert" className="p-3 text-deleted dark:text-deleted-dark">
          Image could not be decoded. Open it in the system application.
        </p>
      )}
      <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-auto bg-checker p-6 dark:bg-checker-dark">
        {mode === 'side by side' ? (
          <SideBySide diff={diff} image={image} />
        ) : mode === 'swipe' ? (
          <SwipeCompare repo={repo} image={image} />
        ) : (
          <OnionSkin repo={repo} image={image} />
        )}
        <ZoomControls zoomIn={zoomIn} zoomOut={zoomOut} fit={fit} />
      </div>
      {mode === 'onion skin' && <BlendSlider repo={repo} />}
    </div>
  );
}
