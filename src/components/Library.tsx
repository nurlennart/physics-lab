import { useState } from "react";
import {
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
  useLab();
  const [query, setQuery] = useState(""),
    [collapsed, setCollapsed] = useState<string[]>([]);
  const categories = [
    { name: "Electrical", icon: Zap, color: "electrical" },
    { name: "Thermal", icon: Flame, color: "thermal" },
    { name: "Sensors", icon: Activity, color: "sensors" },
  ];
  return (
    <aside className="library">
      <div className="panel-heading">
        <h2>Component library</h2>
        <span className="count">09</span>
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
      <div className="library-scroll">
        {categories.map(({ name, icon: Icon, color }) => {
          const entries = Object.entries(definitions).filter(
            ([, d]) =>
              d.category === name &&
              (d.label + " " + d.description)
                .toLowerCase()
                .includes(query.toLowerCase()),
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
                      <span>{d.spec}</span>
                    </span>
                    <Plus className="add-component" size={14} />
                    <GripVertical className="drag-component" size={13} />
                  </button>
                ))}
            </section>
          );
        })}
        {!Object.values(definitions).some((d) =>
          (d.label + " " + d.description)
            .toLowerCase()
            .includes(query.toLowerCase()),
        ) && <p className="no-results">No matching components.</p>}
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
        <span>LAB ENGINE</span>
        <span>v1.0.0</span>
      </div>
    </aside>
  );
}
