import { useCallback, useState } from 'react';
export interface FormState<Form> {
  form: Form;
  update: (patch: Partial<Form>) => void;
  reset: () => void;
}
export function patched<Form>(form: Form, patch: Partial<Form>): Form {
  return { ...form, ...patch };
}
export function useFormState<Form>(initial: Form): FormState<Form> {
  const [form, setForm] = useState(initial);
  const update = useCallback(
    (patch: Partial<Form>) => setForm((current) => patched(current, patch)),
    [],
  );
  const reset = useCallback(() => setForm(initial), [initial]);
  return { form: form, update: update, reset: reset };
}
