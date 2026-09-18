import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import App from '../App';
import { Providers } from '../providers';
import { registeredActions } from '../lib/actions';
import { usePalette } from '../stores/palette';
import { useTabs } from '../stores/tabs';
import { sourceNotice } from '../components/sidebar/CommitFooter';
import { calls, emit, mockCommand } from './harness';
import { ai, generated, repository, settings, status } from './fixtures';
import type { SettingsResponse } from '../lib/types';
const endpoint = 'https://api.example.com/v1';
const configured: SettingsResponse = {
  ...settings,
  keyStored: true,
  ai: { ...ai, enabled: true, baseUrl: endpoint, model: 'gpt-4o-mini' },
};
function setup(preferences: SettingsResponse) {
  let current = preferences;
  mockCommand('env', () => ({
    found: true,
    supported: true,
    version: '2.50.1',
  }));
  mockCommand('settings_get', () => current);
  mockCommand('settings_set', (next) => {
    current = { ...next, keyStored: current.keyStored };
    emit('settings://changed', null);
    return next;
  });
  mockCommand('status', () => status);
  mockCommand('tree', () => []);
  mockCommand('stashes', () => []);
  mockCommand('history', () => ({ commits: [], cursor: null }));
  mockCommand('branches', () => []);
  mockCommand('commit', () => null);
  useTabs.getState().open(repository.id, repository.name);
}
function mount() {
  return render(
    <Providers>
      <App />
    </Providers>,
  );
}
async function openAiPane(user: ReturnType<typeof userEvent.setup>) {
  await screen.findByLabelText('Commit message');
  await user.click(screen.getByTitle('Settings'));
  await user.click(screen.getByRole('button', { name: 'AI' }));
}
async function run(id: string) {
  await act(async () => {
    const entry = registeredActions(repository.id).find(
      (entry) => entry.id === id,
    );
    expect(entry, id).toBeDefined();
    await entry?.run();
  });
}

describe('ai settings pane', () => {
  it('stores a key, reveals the draft on request, and reports a write failure', async () => {
    setup({ ...settings, ai: { ...ai, enabled: true } });
    const user = userEvent.setup();
    mount();
    await openAiPane(user);
    expect(
      screen.getByText('Save an endpoint to load the list.'),
    ).toBeVisible();
    expect(screen.getByLabelText('Model')).toBeDisabled();
    const key = screen.getByLabelText('API key');
    await user.type(key, 'secret-key');
    expect(key).toHaveAttribute('type', 'password');
    const reveal = screen.getByRole('button', { name: 'Show API key' });
    await user.click(reveal);
    expect(reveal).toHaveAttribute('aria-pressed', 'true');
    expect(key).toHaveAttribute('type', 'text');
    await user.click(screen.getByRole('button', { name: 'Save key' }));
    expect(calls).toContainEqual({
      command: 'ai_key_set',
      args: { key: 'secret-key' },
    });
    mockCommand('ai_key_set', () => {
      throw { category: 'refused', message: 'Keychain refused the write' };
    });
    await user.type(screen.getByLabelText('API key'), 'again');
    await user.click(screen.getByRole('button', { name: 'Save key' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Keychain refused the write',
    );
  });
  it('replaces and clears a stored key without ever showing it', async () => {
    setup(configured);
    mockCommand('ai_models', () => ['gpt-4o-mini']);
    const user = userEvent.setup();
    mount();
    await openAiPane(user);
    expect(screen.queryByLabelText('API key')).not.toBeInTheDocument();
    expect(screen.getByText('A key is stored')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Replace' }));
    expect(screen.getByLabelText('API key')).toHaveValue('');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await user.click(screen.getByRole('button', { name: 'Clear' }));
    await user.click(screen.getByRole('button', { name: 'Keep key' }));
    expect(screen.getByText('A key is stored')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Clear' }));
    await user.click(screen.getByRole('button', { name: 'Remove' }));
    expect(calls).toContainEqual({ command: 'ai_key_set', args: { key: '' } });
  });
  it('tests the endpoint, lists its models, and saves the chosen one', async () => {
    setup(configured);
    mockCommand('ai_models', () => ['gpt-4o-mini', 'gpt-4o']);
    const user = userEvent.setup();
    mount();
    await openAiPane(user);
    await user.click(screen.getByRole('button', { name: 'Test connection' }));
    expect(
      await screen.findByText('Connected — 2 models available'),
    ).toHaveAttribute('role', 'status');
    await user.click(screen.getByLabelText('Model'));
    await user.click(await screen.findByRole('option', { name: 'gpt-4o' }));
    await user.clear(screen.getByLabelText('Prompt'));
    await user.type(screen.getByLabelText('Prompt'), 'Summarize.');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(calls).toContainEqual({
        command: 'settings_set',
        args: {
          ...configured,
          ai: {
            ...configured.ai,
            model: 'gpt-4o',
            prompt: 'Summarize.',
          },
        },
      }),
    );
    await user.click(screen.getByLabelText('Generate commit messages'));
    await waitFor(() =>
      expect(
        calls.some(
          (call) =>
            call.command === 'settings_set' &&
            (call.args as SettingsResponse).ai.enabled === false,
        ),
      ).toBe(true),
    );
  });
  it('says plainly when the endpoint serves no model list, and reports a failed test', async () => {
    setup(configured);
    mockCommand('ai_models', () => []);
    const user = userEvent.setup();
    mount();
    await openAiPane(user);
    expect(
      await screen.findByText(
        'This endpoint does not list models. Use one that does.',
      ),
    ).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Test connection' }));
    expect(
      await screen.findByText('Connected, but this endpoint lists no models.'),
    ).toBeVisible();
    mockCommand('ai_models', () => {
      throw { category: 'network', message: 'The endpoint is unreachable.' };
    });
    await user.click(screen.getByRole('button', { name: 'Test connection' }));
    expect(
      await screen.findByText('The endpoint is unreachable.'),
    ).toBeVisible();
  });
});

describe('commit message generation', () => {
  it('hides the control until the feature is fully configured', async () => {
    setup(settings);
    mount();
    await screen.findByLabelText('Commit message');
    expect(
      screen.queryByRole('button', { name: 'Generate' }),
    ).not.toBeInTheDocument();
    const entry = registeredActions(repository.id).find(
      (action) => action.id === 'generate-message',
    );
    expect(entry?.label).toBe('Generate commit message');
    expect(entry?.disabled).toBe(true);
    await act(async () => usePalette.getState().setOpen(true));
    expect(
      await screen.findByRole('button', { name: /Generate commit message/ }),
    ).toBeDisabled();
  });
  it('runs from the shortcut while the message field holds focus', async () => {
    setup(configured);
    const user = userEvent.setup();
    mount();
    const message = await screen.findByLabelText('Commit message');
    await user.click(screen.getByRole('button', { name: 'Generate' }));
    await waitFor(() => expect(message).toHaveValue(generated.message));
    await user.clear(message);
    message.focus();
    expect(message).toHaveFocus();
    await act(async () => {
      fireEvent.keyDown(message, { key: 'g', metaKey: true, altKey: true });
    });
    await waitFor(() => expect(message).toHaveValue(generated.message));
  });
  it('fills an empty message field and states which source was used', async () => {
    setup(configured);
    mockCommand('ai_generate', () => ({
      ...generated,
      source: 'workingTree' as const,
      detail: 'summary' as const,
    }));
    const user = userEvent.setup();
    mount();
    await screen.findByLabelText('Commit message');
    await user.click(screen.getByRole('button', { name: 'Generate' }));
    await waitFor(() =>
      expect(screen.getByLabelText('Commit message')).toHaveValue(
        generated.message,
      ),
    );
    expect(
      screen.getByText(
        'Generation summarized the unstaged working tree and used the file summary.',
      ),
    ).toBeVisible();
    expect(sourceNotice(generated)).toBeNull();
  });
  it('asks before replacing a draft, from the palette action as well', async () => {
    setup(configured);
    const user = userEvent.setup();
    mount();
    const message = await screen.findByLabelText('Commit message');
    await user.type(message, 'wip sidebar');
    await run('generate-message');
    expect(
      await screen.findByText('Replace your draft with the generated message?'),
    ).toBeVisible();
    expect(message).toHaveValue('wip sidebar');
    await user.click(screen.getByRole('button', { name: 'Keep draft' }));
    expect(message).toHaveValue('wip sidebar');
    await user.click(screen.getByRole('button', { name: 'Generate' }));
    await user.click(await screen.findByRole('button', { name: 'Replace' }));
    expect(message).toHaveValue(generated.message);
  });
  it('reports a failed request inline and leaves the draft alone', async () => {
    setup(configured);
    mockCommand('ai_generate', () => {
      throw {
        category: 'authentication',
        message: 'The endpoint rejected the API key. Check it in Settings.',
      };
    });
    const user = userEvent.setup();
    mount();
    const message = await screen.findByLabelText('Commit message');
    await user.type(message, 'wip');
    await user.click(screen.getByRole('button', { name: 'Generate' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The endpoint rejected the API key. Check it in Settings.',
    );
    expect(message).toHaveValue('wip');
    expect(useTabs.getState().busy).toBe(0);
  });
});
