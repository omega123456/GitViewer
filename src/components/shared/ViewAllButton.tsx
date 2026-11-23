import { Layers } from 'lucide-react';
import { useSelection, type Stack } from '../../stores/selection';
import { Button } from './Button';
import { iconButton, quietIcon } from './styles';
const looks = {
  group: { button: `${iconButton} ${quietIcon}`, icon: 'size-4' },
  section: {
    button: iconButton,
    icon: 'size-4 text-muted dark:text-muted-dark',
  },
};
export function ViewAllButton({
  repo,
  stack,
  label,
  look,
}: {
  repo: string;
  stack: Stack;
  label: string;
  look: keyof typeof looks;
}) {
  return (
    <Button
      variant="icon"
      className={looks[look].button}
      aria-label={label}
      title={label}
      onClick={() => useSelection.getState().viewAll(repo, stack)}
    >
      <Layers className={looks[look].icon} />
    </Button>
  );
}
