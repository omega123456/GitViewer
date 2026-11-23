import { useEffect, useRef } from 'react';
import { create } from 'zustand';
import type { Action } from './keyboard';
import { isScopeOf } from './git';
interface Registry {
  scopes: Record<string, Action[]>;
  set: (scope: string, actions: Action[]) => void;
  remove: (scope: string) => void;
}
export const useActionRegistry = create<Registry>((set) => ({
  scopes: {},
  set: (scope, actions) =>
    set((state) => ({ scopes: { ...state.scopes, [scope]: actions } })),
  remove: (scope) =>
    set((state) => ({
      scopes: Object.fromEntries(
        Object.entries(state.scopes).filter(([key]) => key !== scope),
      ),
    })),
}));
export function registeredActions(repo: string) {
  return Object.entries(useActionRegistry.getState().scopes)
    .filter(([scope]) => scope === 'app' || isScopeOf(scope, repo))
    .flatMap(([, actions]) => actions);
}
function describeActions(actions: Action[]) {
  return actions.map(({ id, label, key, disabled }) => ({
    id,
    label,
    key,
    disabled,
  }));
}
export function useActions(scope: string, actions: Action[]) {
  const latest = useRef(actions);
  useEffect(() => {
    latest.current = actions;
  });
  const signature = JSON.stringify(describeActions(actions));
  useEffect(() => {
    const descriptions = describeActions(latest.current);
    useActionRegistry.getState().set(
      scope,
      descriptions.map((description) => ({
        ...description,
        icon: latest.current.find((action) => action.id === description.id)
          ?.icon,
        run: () =>
          latest.current.find((action) => action.id === description.id)?.run(),
      })),
    );
    return () => useActionRegistry.getState().remove(scope);
  }, [scope, signature]);
}
