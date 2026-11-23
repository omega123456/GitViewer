export const createModes = { switch: 'Create & switch', stay: 'Create only' };
export type CreateMode = keyof typeof createModes;
export interface CreateFlow<Created> {
  mode: CreateMode;
  create: () => Promise<Created | undefined>;
  finish: () => void;
  switchTo: (created: Created) => Promise<void>;
}
export async function createThenSwitch<Created>(flow: CreateFlow<Created>) {
  const created = await flow.create();
  if (created === undefined) return;
  flow.finish();
  if (flow.mode === 'switch') await flow.switchTo(created);
}
