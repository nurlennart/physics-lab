import {
  uid,
  makeComponent,
  type Project,
  type Assembly,
  type Component,
} from "../simulation/model";
export function captureAssembly(
  p: Project,
  ids: string[],
  name = "Assembly",
): Assembly {
  const selected = new Set(ids),
    components = structuredClone(
      p.components.filter((c) => selected.has(c.id)),
    );
  for (const c of components)
    if (typeof c.props.target === "string" && !selected.has(c.props.target))
      c.props.target = "";
  return {
    id: uid(),
    name,
    components,
    connections: structuredClone(
      p.connections.filter(
        (w) => selected.has(w.from.component) && selected.has(w.to.component),
      ),
    ),
  };
}
export function insertAssembly(p: Project, a: Assembly, dx = 40, dy = 40) {
  const ids = new Map(a.components.map((c) => [c.id, uid()])),
    components: Component[] = [];
  for (const c of a.components) {
    const n = makeComponent(c.kind, c.x + dx, c.y + dy, [
      ...p.components,
      ...components,
    ]);
    components.push({
      ...structuredClone(c),
      id: ids.get(c.id)!,
      name: n.name,
      x: c.x + dx,
      y: c.y + dy,
      props: {
        ...c.props,
        ...(typeof c.props.target === "string"
          ? { target: ids.get(c.props.target) ?? "" }
          : {}),
      },
    });
  }
  const connections = a.connections.map((w) => ({
    ...structuredClone(w),
    id: uid(),
    from: { ...w.from, component: ids.get(w.from.component)! },
    to: { ...w.to, component: ids.get(w.to.component)! },
    route: w.route?.map((pt) => ({ x: pt.x + dx, y: pt.y + dy })),
  }));
  return {
    ...p,
    components: [...p.components, ...components],
    connections: [...p.connections, ...connections],
  };
}
