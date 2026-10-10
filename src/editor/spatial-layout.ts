import type { Project } from '../simulation/model';
import { defaultWorld, makeSpatial, physicalKinds, type SpatialBody } from '../simulation/spatial-model';

/** Equipment shares component IDs and solver state. These are static housings,
 * not extra shafts, water inventories, thermal masses or inferred pipe lengths. */
export function layoutEquipment(project: Project): Project {
  const occupied = project.components.flatMap(c => c.spatial ? [c.spatial] : []);
  let changed = false;
  const components = project.components.map(c => {
    if (c.spatial || !physicalKinds.has(c.kind)) return c;
    const spatial: SpatialBody = {
      ...makeSpatial(), type: 'static', collision: false,
      width: c.kind === 'tank' ? 1.5 : 1,
      height: c.kind === 'tank' ? 2 : 0.8,
    };
    // A deterministic metre-based equipment grid, independent of schematic pixels.
    // Reserve existing placements and leave their geometry and settings untouched.
    for (let slot = 0; slot < 1000; slot++) {
      spatial.x = 3 + (slot % 5) * 2;
      spatial.y = 2 - Math.floor(slot / 5) * 3;
      if (!occupied.some(b => {
        const w = Math.abs(Math.cos(b.angle)) * b.width + Math.abs(Math.sin(b.angle)) * b.height;
        const h = Math.abs(Math.sin(b.angle)) * b.width + Math.abs(Math.cos(b.angle)) * b.height;
        return Math.abs(b.x - spatial.x) < (w + spatial.width) / 2 + 0.3 &&
          Math.abs(b.y - spatial.y) < (h + spatial.height) / 2 + 0.3;
      })) break;
    }
    occupied.push(spatial);
    changed = true;
    return { ...c, spatial };
  });
  return changed ? { ...project, version: 4, world: project.world ?? defaultWorld(), components } : project;
}
