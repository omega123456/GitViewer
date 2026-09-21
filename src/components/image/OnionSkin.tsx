import type { ReactNode } from 'react';
import { useImageViews, useTabImageView } from '../../stores/image-view';
import { dynamic } from '../shared/styles';
export function OnionSkin({
  view,
  image,
}: {
  view: string;
  image: (side: 'old' | 'new') => ReactNode;
}) {
  const { blend } = useTabImageView(view);
  return (
    <div className="relative flex h-full w-full items-center justify-center">
      {image('old')}
      <div
        className="absolute inset-0 flex items-center justify-center opacity-blend"
        style={dynamic({ '--blend-opacity': blend / 100 })}
      >
        {image('new')}
      </div>
    </div>
  );
}
export function BlendSlider({ view }: { view: string }) {
  const { blend } = useTabImageView(view);
  return (
    <label className="flex shrink-0 items-center gap-3 border-t border-line p-3 text-xs dark:border-line-dark">
      Blend
      <input
        aria-label="Onion skin blend"
        className="flex-1 accent-accent"
        type="range"
        value={blend}
        onChange={(event) =>
          useImageViews
            .getState()
            .update(view, { blend: Number(event.target.value) })
        }
      />
      <span>{blend}%</span>
    </label>
  );
}
