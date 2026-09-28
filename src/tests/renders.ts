interface Fiber {
  type: unknown;
  memoizedProps: unknown;
  flags: number;
  child: Fiber | null;
  sibling: Fiber | null;
}
interface Root {
  current: Fiber;
}
const performedWork = 1;
const roots = new Set<Root>();
const previous = new WeakMap<Root, Set<Fiber>>();
const counts: { name: string; props: unknown }[] = [];
let counting = false;
function walk(root: Root) {
  const seen = previous.get(root);
  const next = new Set<Fiber>();
  const stack = [root.current];
  while (stack.length) {
    const fiber = stack.pop()!;
    if (typeof fiber.type === 'function') {
      next.add(fiber);
      if (counting && fiber.flags & performedWork && !seen?.has(fiber)) {
        counts.push({ name: fiber.type.name, props: fiber.memoizedProps });
      }
    }
    if (fiber.sibling) stack.push(fiber.sibling);
    if (fiber.child) stack.push(fiber.child);
  }
  previous.set(root, next);
}
export const renders = {
  start() {
    counting = false;
    roots.forEach(walk);
    counts.length = 0;
    counting = true;
  },
  of(name: string, matches: (props: unknown) => boolean = () => true) {
    return counts.filter((entry) => entry.name === name && matches(entry.props))
      .length;
  },
  reset() {
    counting = false;
    counts.length = 0;
    roots.clear();
  },
};
Object.assign(globalThis, {
  __REACT_DEVTOOLS_GLOBAL_HOOK__: {
    supportsFiber: true,
    inject: () => 1,
    checkDCE() {},
    onScheduleFiberRoot() {},
    onCommitFiberRoot(_renderer: number, root: Root) {
      roots.add(root);
      if (counting) walk(root);
    },
    onCommitFiberUnmount() {},
    onPostCommitFiberRoot() {},
  },
});
