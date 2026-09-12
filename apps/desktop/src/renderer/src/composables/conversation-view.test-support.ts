import { createRenderer, defineComponent, type Component } from "vue";

interface TestNode {
  parent: TestNode | null;
  children: TestNode[];
  text: string;
}
const node = (text = ""): TestNode => ({ parent: null, children: [], text });

const renderer = createRenderer<TestNode, TestNode>({
  createElement: () => node(),
  createText: node,
  createComment: node,
  setText: (target, text) => {
    target.text = text;
  },
  setElementText: (target, text) => {
    target.text = text;
  },
  patchProp: () => undefined,
  parentNode: (target) => target.parent,
  nextSibling: (target) => {
    const siblings = target.parent?.children ?? [];
    return siblings[siblings.indexOf(target) + 1] ?? null;
  },
  insert: (target, parent, anchor) => {
    const index = anchor ? parent.children.indexOf(anchor) : -1;
    parent.children.splice(
      index < 0 ? parent.children.length : index,
      0,
      target
    );
    target.parent = parent;
  },
  remove: (target) => {
    const siblings = target.parent?.children;
    if (siblings) siblings.splice(siblings.indexOf(target), 1);
    target.parent = null;
  }
});

export function mountConversationTestComponent(component: Component) {
  const app = renderer.createApp(component);
  app.mount(node());
  return () => app.unmount();
}

export function mountConversationTestSetup<T>(setup: () => T) {
  let result: T;
  const unmount = mountConversationTestComponent(
    defineComponent({
      setup() {
        result = setup();
        return () => null;
      }
    })
  );
  return { result: result!, unmount };
}
