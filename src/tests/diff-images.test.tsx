import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it } from 'vitest';
import { QueryProvider } from '../providers/QueryProvider';
import { useSelection } from '../stores/selection';
import { DiffPane } from '../components/diff/DiffPane';
import { ImageDiff } from '../components/image/ImageDiff';
import { calls, mockCommand } from './harness';
import { diff, repository, settings } from './fixtures';
import { mountApp, runAction, setup } from './workbench';

const SWIPE_MID_X = 600;
const SWIPE_PAST_RIGHT_X = 900;
const SWIPE_PAST_LEFT_X = -10;
const KILOBYTE = 1024;
const OVERSIZE_MEGABYTES = 21;
const OVERSIZE_IMAGE_BYTES = OVERSIZE_MEGABYTES * KILOBYTE * KILOBYTE;
const OLD_IMAGE_WIDTH = 20;
const OLD_IMAGE_HEIGHT = 30;
const NEW_IMAGE_WIDTH = 25;
const NEW_IMAGE_HEIGHT = 40;
const IMAGE_MODE_COUNT = 3;

it('runs image comparison and zoom actions through the shared registry', async () => {
  render(
    <ImageDiff
      repo={repository.id}
      selection={{ path: 'image.png', source: 'staged' }}
      diff={diff}
    />,
  );
  for (const mode of ['swipe', 'onion skin', 'side by side']) {
    await runAction('image-mode');
    expect(screen.getByRole('tab', { name: mode })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  }
  await runAction('image-zoom-in');
  expect(screen.getByAltText('Before')).toHaveStyle('--image-width: 700px');
  await runAction('image-zoom-out');
  expect(screen.getByAltText('Before')).toHaveStyle('--image-width: 600px');
  await runAction('image-fit');
  expect(screen.getByAltText('Before')).toHaveClass('max-w-full');
});

it('keeps the image mode and swipe position through a re-selection', async () => {
  mockCommand('diff', () => ({ ...diff, image: true }));
  const user = userEvent.setup();
  const pane = (path: string) => (
    <QueryProvider>
      <DiffPane
        repo={repository.id}
        selection={{ path: path, source: 'unstaged' }}
        settings={settings}
        disabled={false}
      />
    </QueryProvider>
  );
  const { rerender } = render(pane('before.png'));
  await user.click(await screen.findByRole('tab', { name: 'swipe' }));
  const divider = screen.getByRole('slider', { name: 'Swipe divider' });
  fireEvent.pointerDown(divider);
  fireEvent.pointerMove(divider, { clientX: SWIPE_MID_X });
  expect(divider).toHaveAttribute('aria-valuenow', '75');
  fireEvent.error(screen.getByAltText('Before'));
  expect(screen.getByText(/Image could not be decoded/)).toBeVisible();
  rerender(pane('after.png'));
  expect(
    await screen.findByRole('slider', { name: 'Swipe divider' }),
  ).toHaveAttribute('aria-valuenow', '75');
  expect(screen.getByRole('tab', { name: 'swipe' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  expect(
    screen.queryByText(/Image could not be decoded/),
  ).not.toBeInTheDocument();
});

it('drags the image swipe and keeps it bounded at both edges', async () => {
  const user = userEvent.setup();
  render(
    <ImageDiff
      repo={repository.id}
      selection={{ path: 'image.png', source: 'staged' }}
      diff={diff}
    />,
  );
  await user.click(screen.getByRole('tab', { name: 'swipe' }));
  const divider = screen.getByLabelText('Swipe divider');
  fireEvent.pointerDown(divider);
  fireEvent.pointerMove(divider, { clientX: SWIPE_MID_X });
  expect(divider).toHaveAttribute('aria-valuenow', '75');
  fireEvent.pointerMove(divider, { clientX: SWIPE_PAST_RIGHT_X });
  expect(divider).toHaveAttribute('aria-valuenow', '100');
  fireEvent.keyDown(divider, { key: 'ArrowLeft' });
  expect(divider).toHaveAttribute('aria-valuenow', '99');
  fireEvent.pointerMove(divider, { clientX: SWIPE_PAST_LEFT_X });
  expect(divider).toHaveAttribute('aria-valuenow', '0');
});

it('opens oversized images externally without offering an in-app override', async () => {
  setup();
  useSelection
    .getState()
    .select(repository.id, { path: 'large.png', source: 'file' });
  mockCommand('diff', () => ({
    ...diff,
    image: true,
    tooLarge: true,
    newSize: OVERSIZE_IMAGE_BYTES,
  }));
  mockCommand('system_open', () => null);
  mountApp();
  await screen.findByText('File too large to diff');
  expect(screen.queryByText('View anyway')).not.toBeInTheDocument();
  await userEvent.setup().click(screen.getByText('Open in system application'));
  expect(calls).toContainEqual({
    command: 'system_open',
    args: { repo: repository.id, path: 'large.png' },
  });
});

it('renders both image dimensions, their delta, and decoding errors', () => {
  render(
    <ImageDiff
      repo={repository.id}
      selection={{ path: 'image.png', source: 'staged' }}
      diff={{
        ...diff,
        oldDimensions: { width: OLD_IMAGE_WIDTH, height: OLD_IMAGE_HEIGHT },
        newDimensions: { width: NEW_IMAGE_WIDTH, height: NEW_IMAGE_HEIGHT },
      }}
    />,
  );
  expect(screen.getByText(/20×30 → 25×40/)).toBeVisible();
  fireEvent.error(screen.getByAltText('After'));
  expect(screen.getByRole('status')).toHaveTextContent(
    'Image could not be decoded',
  );
  expect(
    within(screen.getByLabelText('Image comparison mode')).getAllByRole('tab'),
  ).toHaveLength(IMAGE_MODE_COUNT);
});
