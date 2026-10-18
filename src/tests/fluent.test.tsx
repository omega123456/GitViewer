import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Button } from '../components/shared/Button';
import { Modal } from '../components/shared/Modal';
import { Choice } from '../components/shared/Choice';
import { Toggle } from '../components/shared/Toggle';
import { ViewSwitch } from '../components/shared/ViewSwitch';
import { Toaster } from '../components/shell/Toaster';
import { mica } from '../lib/platform';
import { useErrors } from '../stores/errors';
import { useSuccesses } from '../stores/successes';
import { useTabs } from '../stores/tabs';
import { host } from './harness';
describe('Fluent primitives', () => {
  it('draws a view switch as tabs with a pill under the selection and arrow keys', async () => {
    const onChange = vi.fn();
    render(
      <ViewSwitch
        stretch
        label="Sidebar mode"
        value="history"
        options={['working tree', 'history', 'compare']}
        icons={{ history: <svg data-testid="icon" /> }}
        onChange={onChange}
      />,
    );
    const selected = screen.getByRole('tab', { name: 'history' });
    expect(selected).toHaveAttribute('aria-selected', 'true');
    expect(selected).toHaveClass(
      'font-semibold',
      'after:w-4',
      'h-8.5',
      'flex-1',
    );
    expect(
      screen.getByRole('tablist', { name: 'Sidebar mode' }),
    ).not.toHaveClass('bg-track');
    await userEvent.click(screen.getByRole('tab', { name: 'working tree' }));
    expect(onChange).toHaveBeenLastCalledWith('working tree');
    selected.focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(onChange).toHaveBeenLastCalledWith('compare');
    expect(screen.getByRole('tab', { name: 'compare' })).toHaveFocus();
    await userEvent.keyboard('{Home}');
    expect(onChange).toHaveBeenLastCalledWith('working tree');
    await userEvent.keyboard('{End}');
    expect(onChange).toHaveBeenLastCalledWith('compare');
    await userEvent.keyboard('a');
    expect(onChange).toHaveBeenCalledTimes(4);
  });
  it('gives an unstretched view switch equal-width 32px options', () => {
    render(
      <ViewSwitch
        label="Diff mode"
        value="split"
        options={['split', 'unified']}
        onChange={() => undefined}
      />,
    );
    expect(screen.getByRole('tablist', { name: 'Diff mode' })).toHaveClass(
      'auto-cols-fr',
    );
    expect(screen.getByRole('tab', { name: 'unified' })).toHaveClass(
      'h-8',
      'text-muted',
    );
  });
  it('draws a choice as a white segmented control with a solid accent selection', async () => {
    const onChange = vi.fn();
    render(
      <Choice
        label="Theme"
        value="system"
        options={['light', 'dark', 'system']}
        onChange={onChange}
      />,
    );
    expect(screen.getByRole('radiogroup', { name: 'Theme' })).toHaveClass(
      'bg-control',
      'rounded-card',
    );
    expect(screen.getByRole('radio', { name: 'system' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await userEvent.click(screen.getByRole('radio', { name: 'dark' }));
    expect(onChange).toHaveBeenCalledWith('dark');
  });
  it('draws a radio choice with a ring per option', () => {
    const { container } = render(
      <Choice
        appearance="radio"
        label="Worktree branch"
        value="detached"
        options={['detached', 'new branch']}
        onChange={() => undefined}
      />,
    );
    expect(screen.getByRole('radio', { name: 'detached' })).toHaveClass('h-8');
    expect(container.querySelectorAll('.rounded-full.size-5')).toHaveLength(2);
  });
  it('labels a toggle switch On or Off', async () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <Toggle label="Pull on checkout" checked={false} onChange={onChange} />,
    );
    expect(screen.getByText('Off')).toBeVisible();
    await userEvent.click(
      screen.getByRole('switch', { name: 'Pull on checkout' }),
    );
    expect(onChange).toHaveBeenCalledWith(true);
    rerender(<Toggle label="Pull on checkout" checked onChange={onChange} />);
    expect(screen.getByText('On')).toBeVisible();
  });
  it('gives the standard button a control fill and a darker bottom edge', () => {
    render(<Button variant="standard">Fetch</Button>);
    expect(screen.getByRole('button', { name: 'Fetch' })).toHaveClass(
      'bg-control',
      'border-b-control-edge',
      'text-sm',
    );
  });
  it('renders a dialog footer band below the titled body', () => {
    render(
      <Modal
        title="New branch"
        open
        onOpenChange={() => undefined}
        footer={<Button>Cancel</Button>}
      >
        <p>Body</p>
      </Modal>,
    );
    expect(screen.getByRole('heading', { name: 'New branch' })).toHaveClass(
      'text-subtitle',
    );
    const band = screen.getByRole('button', { name: 'Cancel' }).parentElement;
    expect(band).toHaveClass('grid-cols-2', 'bg-sub', 'border-t');
    expect(screen.queryByLabelText('Close dialog')).not.toBeInTheDocument();
  });
  it('tints each toast card by type', async () => {
    useTabs.getState().open('/repo', 'repo');
    render(<Toaster />);
    act(() => {
      const { announce } = useSuccesses.getState();
      announce('/repo', { key: 'done', title: 'Pushed main' });
      announce('/repo', { key: 'same', title: 'Up to date', info: true });
      announce('/repo', {
        key: 'warn',
        title: 'Partly applied',
        warning: true,
      });
      useErrors
        .getState()
        .report('/repo', { category: 'refused', message: 'nope' });
    });
    const card = async (text: string) =>
      (await screen.findByText(text)).closest('.w-toast');
    expect(await card('Pushed main')).toHaveClass('bg-success-ground');
    expect(await card('Up to date')).toHaveClass('bg-surface');
    expect(await card('Partly applied')).toHaveClass('bg-caution-ground');
    expect(await card('Git refused the request')).toHaveClass(
      'bg-critical-ground',
    );
  });
  it('shows Mica only on Windows 11', () => {
    expect(mica()).toBe(false);
    host.platform = 'windows';
    host.version = '10.0.19045';
    expect(mica()).toBe(false);
    host.version = '10.0.22631';
    expect(mica()).toBe(true);
  });
});
