import { Maximize, ZoomIn, ZoomOut } from 'lucide-react';
import { Button } from '../shared/Button';
export function ZoomControls({
  zoomIn,
  zoomOut,
  fit,
}: {
  zoomIn: () => void;
  zoomOut: () => void;
  fit: () => void;
}) {
  return (
    <div className="absolute top-2 right-2 flex gap-0.5 rounded border border-line bg-surface p-0.5 text-muted dark:border-line-dark dark:bg-surface-dark">
      <Button title="Zoom out" onClick={zoomOut}>
        <ZoomOut className="size-3.5" />
      </Button>
      <Button title="Zoom in" onClick={zoomIn}>
        <ZoomIn className="size-3.5" />
      </Button>
      <Button title="Fit image" onClick={fit}>
        <Maximize className="size-3.5" />
      </Button>
    </div>
  );
}
