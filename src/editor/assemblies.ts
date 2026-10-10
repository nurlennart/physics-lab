import {
  uid,
  makeComponent,
  type Project,
  type Assembly,
  type Component,
} from "../simulation/model";
import { defaultWorld } from '../simulation/spatial-model';
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
  const joints = structuredClone((p.world?.joints ?? []).filter(j => selected.has(j.a) && selected.has(j.b)).filter((j, _, all) => j.kind !== 'gear' || all.some(x => x.id === j.joint1) && all.some(x => x.id === j.joint2)));
  return {
    id: uid(),
    name,
    components,
    joints,
    connections: structuredClone(
      p.connections.filter(
        (w) => selected.has(w.from.component) && selected.has(w.to.component) && (w.domain !== 'mechanical' || !components.some(c => c.kind === 'rigidBody' && [w.from.component, w.to.component].includes(c.id)) || joints.some(j => j.kind === 'revolute' && [w.from.component, w.to.component].includes(j.b) && components.find(c => c.id === j.a)?.spatial?.type === 'static')),
      ),
    ),
  };
}
export function insertAssembly(p: Project, a: Assembly, dx = 40, dy = 40) {
  const ids = new Map(a.components.map((c) => [c.id, uid()])),
    components: Component[] = [];
  const jointIds = new Map((a.joints ?? []).map(j => [j.id, uid()]));
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
      ...(c.spatial ? { spatial: { ...structuredClone(c.spatial), x: c.spatial.x + 1, y: c.spatial.y + 1 } } : {}),
      props: {
        ...c.props,
        ...(c.spatial?.elevationLinked ? { elevation: c.spatial.y + 1 + c.spatial.elevationOffset } : {}),
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
    ...((a.joints?.length || a.components.some(c => c.spatial)) ? { version: 4 as const, world: { ...(p.world ?? defaultWorld()), joints: [...(p.world?.joints ?? []), ...(a.joints ?? []).map(j => ({ ...structuredClone(j), id: jointIds.get(j.id)!, a: ids.get(j.a)!, b: ids.get(j.b)!, ...(j.joint1 ? { joint1: jointIds.get(j.joint1) } : {}), ...(j.joint2 ? { joint2: jointIds.get(j.joint2) } : {}) }))] } } : {}),
  };
}
