import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { Button } from './Button';
export function CopyButton({
  text,
  label,
  className = '',
}: {
  text: string;
  label: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant="icon"
      aria-label={copied ? 'Copied' : label}
      title={copied ? 'Copied' : label}
      className={className}
      onClick={() =>
        void navigator.clipboard.writeText(text).then(
          () => setCopied(true),
          () => setCopied(false),
        )
      }
    >
      {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
    </Button>
  );
}
