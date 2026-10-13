import {
  Waves,
  Cog,
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
import { challengeDefinition, challengeList, evaluateChallenge, type ChallengeDefinition } from "../simulation/challenges";
import { projectCost } from "../simulation/model";
const familyArt: Record<ChallengeDefinition["family"], { icon: typeof Cog; equation: string }> = {
  electrical: { icon: Lightbulb, equation: "V = IR" },
  thermal: { icon: Flame, equation: "Q = mcΔT" },
  hydraulic: { icon: Waves, equation: "P = Δp Q" },
  mechanical: { icon: Cog, equation: "τ = Iα" },
};
export function ChallengeStrip() {
  const s = useLab();
  if (!s.project.challenge) return null;
  const d = challengeDefinition(s.project.challenge),
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
            : `${d.progressLabel?.(simulation.challengeState) ?? ""}${Math.round(r.progress * 100)}%`}
      </span>
      <button
        title="Open challenge guidebook"
        aria-label="Open challenge guidebook"
        onClick={() => actions.set({ view: "guidebook" })}
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
            <span className="eyebrow">The engineering playground</span>
            <h2>Nine missions. Your inventions.</h2>
          </div>
          <button
            aria-label="Close challenges"
            onClick={() => actions.set({ view: "workspace" })}
          >
            <X size={20} />
          </button>
        </div>
        <p className="dialog-intro">
          Pick a mission, choose your equipment, and chase three stars. Each mission comes with a guidebook and optional hints. Only the fixed test environment is supplied.
        </p>
        <div className="challenge-cards">
          {challengeList()
            .map((d) => {
              const { icon: Icon, equation } = familyArt[d.family];
              return (
                <article className={`challenge-card ${d.id}`} key={d.id}>
                  <div className="challenge-card-top">
                    <span className="assignment-id">Challenge {d.number}</span>
                    <span className="difficulty">{d.difficulty}</span>
                  </div>
                  <div className="challenge-illustration">
                    <Icon size={45} strokeWidth={1} />
                    <span>{equation}</span>
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
            and budget constraints must pass. Economy earns full points at or below the reference build cost shown in each mission guidebook, then decreases to zero at the budget.
          </p>
        </div>
        {s.project.challenge && challengeDefinition(s.project.challenge).liveStatus && (
          <div className="runaway-details">
            <p>
              {challengeDefinition(s.project.challenge).liveStatus!(simulation.challengeState).map((part, i) =>
                typeof part === "string" ? part : <strong key={i}>{part.strong}</strong>,
              )}
            </p>
          </div>
        )}
        {s.project.challenge && <div className="runaway-details">
            {evaluateChallenge(s.project, simulation)?.checks.map((c) => (
              <p key={c.label}>
                {c.ok ? "✓" : "○"} {c.label}
              </p>
            ))}
          </div>}
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
