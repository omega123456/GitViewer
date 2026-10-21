import { useState } from 'react';
import { perform } from '../../lib/query';
import { Button } from '../shared/Button';
import { Modal } from '../shared/Modal';
import { TextInput } from '../shared/TextInput';
import { field } from '../shared/styles';
const fallback = 'Saved from GitViewer';
export function StashDialog({
  repo,
  open,
  onOpenChange,
}: {
  repo: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [name, setName] = useState('');
  const close = () => {
    onOpenChange(false);
    setName('');
  };
  return (
    <Modal
      title="Stash changes"
      open={open}
      focusId="stash-name"
      onOpenChange={(next) => (next ? onOpenChange(true) : close())}
      footer={
        <>
          <Button
            type="submit"
            form="stash-form"
            variant="primary"
            className="h-8"
          >
            Stash
          </Button>
          <Button variant="standard" className="h-8" onClick={close}>
            Cancel
          </Button>
        </>
      }
    >
      <form
        id="stash-form"
        className="flex flex-col gap-1 text-sm"
        onSubmit={(event) => {
          event.preventDefault();
          close();
          void perform('stash_save', {
            repo,
            message: name.trim() || fallback,
          });
        }}
      >
        <label htmlFor="stash-name">Name</label>
        <TextInput
          id="stash-name"
          className={`${field} h-8`}
          placeholder={fallback}
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      </form>
    </Modal>
  );
}
