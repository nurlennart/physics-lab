import { challengeDefinition } from "../simulation/challenges";
import { useState } from "react";
import {
  Waves,
  Cog,
  Search,
  ChevronDown,
  Plus,
  Zap,
  Flame,
  Activity,
  GripVertical,
  Box,
  BookOpen,
} from "lucide-react";
import { definitions, type Kind } from "../simulation/model";
import { actions, useLab } from "../editor/store";
import { ComponentIcon } from "./Icons";
export default function Library() {
  const s = useLab();
  const [query, setQuery] = useState(""),
    [collapsed, setCollapsed] = useState<string[]>([]);
  const matches = (d: (typeof definitions)[Kind]) =>
    `${d.label} ${d.description} ${(d.variants ?? []).map(v => `${v.label} ${v.spec}`).join(" ")}`.toLowerCase().includes(query.toLowerCase());
  const categories = [
    { name: "Electrical", icon: Zap, color: "electrical" },
    { name: "Hydraulic", icon: Waves, color: "hydraulic" },
    { name: 'Mechanical', icon: Cog, color: 'mechanical' },
    { name: "Thermal", icon: Flame, color: "thermal" },
    { name: "Sensors", icon: Activity, color: "sensors" },
    { name: "Automation", icon: Activity, color: "control" },
  ];
  return (
    <aside className="library">
      <div className="panel-heading">
        <h2>Component library</h2>
        <span className="count">{Object.keys(definitions).length}</span>
      </div>
      <label className="search-field">
        <Search size={15} />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search components…"
          aria-label="Search component library"
        />
        <kbd>/</kbd>
      </label>
      {s.project.challenge && <button className="models-link" onClick={() => actions.set({ view: 'guidebook' })}><BookOpen size={15}/>Mission guidebook & hints</button>}
      <div className="library-scroll">
        {categories.map(({ name, icon: Icon, color }) => {
          const entries = Object.entries(definitions).filter(
            ([kind, d]) =>
              d.category === name &&
              (!s.project.challenge || challengeDefinition(s.project.challenge).rules.allowed.includes(kind) && !["battery", "contactor", "transformer", "radiator", "circulator", "electricBoiler", "panelRadiator", "heatPump", "storageTank", "expansionVessel", "safetyValve"].includes(kind)) &&
              matches(d),
          );
          if (!entries.length) return null;
          const closed = collapsed.includes(name);
          return (
            <section className={`library-category ${color}`} key={name}>
              <button
                className="category-heading"
                onClick={() =>
                  setCollapsed(
                    closed
                      ? collapsed.filter((c) => c !== name)
                      : [...collapsed, name],
                  )
                }
              >
                <Icon size={14} />
                <span>{name}</span>
                <span className="category-count">{entries.length}</span>
                <ChevronDown size={14} className={closed ? "collapsed" : ""} />
              </button>
              {!closed &&
                entries.map(([kind, d]) => (
                  <button
                    className="library-component"
                    key={kind}
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData("physics-component", kind);
                      e.dataTransfer.effectAllowed = "copy";
                    }}
                    onClick={() => actions.add(kind as Kind)}
                    title={`${d.description}. ${d.ports
                      .map((p) => p.domain)
                      .filter((v, i, a) => a.indexOf(v) === i)
                      .join(
                        " + ",
                      )} connections. €${d.cost}. Drag to place or click to add.`}
                  >
                    <span className="library-icon">
                      <ComponentIcon kind={kind as Kind} />
                    </span>
                    <span className="library-item-copy">
                      <strong>{d.label}</strong>
                      <span>{d.variants?.length ? `${d.spec} · ${d.variants.length + 1} models + presets` : d.spec}</span>
                    </span>
                    <Plus className="add-component" size={14} />
                    <GripVertical className="drag-component" size={13} />
                  </button>
                ))}
            </section>
          );
        })}
        {!Object.entries(definitions).some(([kind, d]) => matches(d) && (!s.project.challenge || challengeDefinition(s.project.challenge).rules.allowed.includes(kind) && !["battery", "contactor", "transformer", "radiator", "circulator", "electricBoiler", "panelRadiator", "heatPump", "storageTank", "expansionVessel", "safetyValve"].includes(kind))) && <p className="no-results">No matching components.</p>}
      </div>
      <div className="assembly-tools">
        {s.selected.length > 0 && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const input = e.currentTarget.elements.namedItem(
                "assembly",
              ) as HTMLInputElement;
              actions.saveAssembly(input.value);
              input.value = "";
            }}
          >
            <input
              name="assembly"
              placeholder="Assembly name"
              required
              maxLength={80}
            />
            <button>Save selection</button>
          </form>
        )}
        {(s.project.assemblies ?? []).map((a) => (
          <button key={a.id} onClick={() => actions.insertAssembly(a.id)}>
            Insert {a.name}
          </button>
        ))}
      </div>
      <div className="library-note">
        <Box size={16} />
        <span>
          Drag components onto the grid.
          <br />
          <span>Connect matching terminals.</span>
        </span>
      </div>
      <button
        className="models-link"
        onClick={() => actions.set({ view: "models" })}
      >
        <BookOpen size={15} />
        Physics models & assumptions
      </button>
      <div className="library-version">
        <span>Lab engine</span>
        <span>v3.0.0</span>
      </div>
    </aside>
  );
}
