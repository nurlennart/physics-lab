import {
  X,
  Lightbulb,
  Flame,
  Check,
  Lock,
  Star,
  ArrowUpRight,
  Timer,
  Coins,
  ShieldCheck,
  BookOpen,
  Play,
  AlertCircle,
} from "lucide-react";
import { actions, simulation, useLab } from "../editor/store";
import { challenges, evaluateChallenge } from "../simulation/challenges";
import { projectCost } from "../simulation/model";
export function ChallengeStrip() {
  const s = useLab();
  if (!s.project.challenge) return null;
  const d = challenges[s.project.challenge],
    r = evaluateChallenge(s.project, simulation)!;
  return (
    <div className={`challenge-strip ${r.complete ? "complete" : ""}`}>
      <span className="challenge-number">{d.number}</span>
      <strong>{d.title}</strong>
      <div className="challenge-progress">
        <i style={{ width: `${r.progress * 100}%` }} />
      </div>
      <span>
        {r.complete
          ? `${r.stars} stars · ${r.score}/100`
          : r.failed
            ? "Safety constraint violated — reset"
            : `${s.project.challenge === "runaway" ? simulation.runaway.phase + " · " : ""}${Math.round(r.progress * 100)}%`}
      </span>
      <button
        title="Challenge details"
        onClick={() => actions.set({ view: "challenges" })}
      >
        <BookOpen size={14} />
      </button>
    </div>
  );
}
export default function Challenges() {
  const s = useLab();
  return (
    <div className="modal-backdrop">
      <section
        className="challenge-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Engineering challenges"
      >
        <div className="dialog-header">
          <div>
            <span className="eyebrow">ENGINEERING ASSIGNMENTS</span>
            <h2>Put your engineering to the test.</h2>
          </div>
          <button
            aria-label="Close challenges"
            onClick={() => actions.set({ view: "workspace" })}
          >
            <X size={20} />
          </button>
        </div>
        <p className="dialog-intro">
          Design, measure, iterate. Every objective is evaluated against your
          actual simulation.
        </p>
        <div className="challenge-cards">
          {Object.values(challenges)
            .sort((a, b) => a.number.localeCompare(b.number))
            .map((d) => {
              const Icon = d.id === "light" ? Lightbulb : Flame;
              return (
                <article className={`challenge-card ${d.id}`} key={d.id}>
                  <div className="challenge-card-top">
                    <span className="assignment-id">CHALLENGE {d.number}</span>
                    <span className="difficulty">{d.difficulty}</span>
                  </div>
                  <div className="challenge-illustration">
                    <Icon size={45} strokeWidth={1} />
                    <span>{d.id === "light" ? "V = IR" : "Q = mcΔT"}</span>
                  </div>
                  <h3>{d.title}</h3>
                  <p>{d.description}</p>
                  <ul>
                    {d.objectives.map((o) => (
                      <li key={o}>
                        <Check size={14} />
                        {o}
                      </li>
                    ))}
                  </ul>
                  <div className="challenge-meta">
                    <span>
                      <Coins size={14} />€{d.budget} budget
                    </span>
                    <span>
                      <Star size={14} />
                      3-star rating
                    </span>
                  </div>
                  <button
                    className="primary-button"
                    onClick={() => actions.newProject(d.id, true)}
                  >
                    <Play size={14} />
                    Start assignment
                  </button>
                </article>
              );
            })}
        </div>
        <div className="challenge-footnote">
          <ShieldCheck size={17} />
          <p>
            <strong>Performance determines your score.</strong> Completion is
            worth 60 points for First Light and Heating, with efficiency 20,
            economy 10, and time 10. Thermal Runaway uses completion 50,
            stability/overshoot 15, efficiency 10, economy 10, time 10, and
            switching economy 5. Earn 2 stars at 80 points and 3 at 90. Safety
            and budget constraints must pass.
          </p>
        </div>
        {s.project.challenge === "runaway" && (
          <div className="runaway-details">
            <p>
              State: <strong>{simulation.runaway.phase}</strong> · Regulation{" "}
              {simulation.runaway.normalTime.toFixed(1)}/≥240 s · Recovery{" "}
              {simulation.runaway.recoveryTime.toFixed(1)}/≥120 s. Feedback
              transitions: {simulation.runaway.automaticSwitches}, recovery
              transitions: {simulation.runaway.recoverySwitches}. After the
              fault, select ST-01 and manually reset its safety latch once the
              vessel is below its reset margin.
            </p>
            {evaluateChallenge(s.project, simulation)?.checks.map((c) => (
              <p key={c.label}>
                {c.ok ? "✓" : "○"} {c.label}
              </p>
            ))}
          </div>
        )}
        {s.project.challenge && (
          <button
            className="text-link"
            onClick={() => actions.set({ view: "workspace" })}
          >
            Return to current assignment · €{projectCost(s.project)} spent
          </button>
        )}
      </section>
    </div>
  );
}
