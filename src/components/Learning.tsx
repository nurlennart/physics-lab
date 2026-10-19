import { useState } from 'react';
import { BookOpen, X, ArrowUpRight, Lightbulb, Star, Check, Search } from 'lucide-react';
import { actions, simulation, useLab } from '../editor/store';
import { exampleGroups, examples } from '../simulation/learning';
import { challengeDefinition, evaluateChallenge } from '../simulation/challenges';
import { projectCost } from '../simulation/model';

export function Examples() {
  const [category, setCategory] = useState<string>('Start here'), [query, setQuery] = useState('');
  const groups = ['All', ...exampleGroups];
  // A search looks through every group: all words must appear in the title, tag line, description or group. The whole
  // phrase in the title ranks first, then the phrase anywhere, then the separate words; shelf order within each rank.
  const phrase = query.trim().toLowerCase(), words = phrase.split(/\s+/).filter(Boolean);
  const text = (example: typeof examples[number]) => `${example.title} ${example.category} ${example.description} ${example.group}`.toLowerCase();
  const rank = (example: typeof examples[number]) => example.title.toLowerCase().includes(phrase) ? 0 : text(example).includes(phrase) ? 1 : 2;
  const shown = words.length
    ? examples.filter(example => words.every(word => text(example).includes(word))).map((example, i) => ({ example, i })).sort((a, b) => rank(a.example) - rank(b.example) || a.i - b.i).map(x => x.example)
    : examples.filter(example => category === 'All' || category === example.group);
  return <div className="modal-backdrop"><section className="learning-dialog" role="dialog" aria-modal="true" aria-label="Starters & examples">
    <div className="dialog-header"><div><span className="eyebrow">The experiment shelf</span><h2>Start with something that works.</h2></div><button aria-label="Close examples" onClick={() => actions.set({ view: 'workspace' })}><X size={20}/></button></div>
    <p className="dialog-intro">Working circuits, live measurements, and an idea to try next. Open any example as an editable sandbox.</p>
    <div className="learning-filters" aria-label="Example categories">
      <label className="learning-search"><Search size={15}/><input type="search" aria-label="Search examples" placeholder="Search examples" value={query} onChange={e => setQuery(e.target.value)} /></label>
      {groups.map(group => <button key={group} aria-pressed={!words.length && category === group} onClick={() => { setCategory(group); setQuery(''); }}>{group}</button>)}
    </div>
    {!shown.length && <p className="dialog-intro" data-testid="examples-empty">No example matches “{query.trim()}”.</p>}
    <div className="example-grid">{shown.map(example => <article className="example-card" key={example.mode}>
      <span className="eyebrow">{example.category}</span><h3>{example.title}</h3><p>{example.description}</p><div className="try-next"><Lightbulb size={16}/><p><strong>Try this</strong>{example.experiment}</p></div>
      <button className="primary-button" onClick={() => actions.newProject(example.mode)}>Open {example.title}<ArrowUpRight size={15}/></button>
    </article>)}</div>
  </section></div>;
}

export function ChallengeGuidebook() {
  const s = useLab();
  const id = s.project.challenge;
  if (!id) return null;
  const d = challengeDefinition(id), notes = d.guide, result = evaluateChallenge(s.project, simulation)!;
  return <div className="modal-backdrop"><section className="learning-dialog guidebook-dialog" role="dialog" aria-modal="true" aria-label="Challenge guidebook">
    <div className="dialog-header"><div><span className="eyebrow">MISSION {d.number} · {d.difficulty}</span><h2>{d.title}</h2></div><button aria-label="Close guidebook" onClick={() => actions.set({ view: 'workspace' })}><X size={20}/></button></div>
    <p className="mission-story">{notes.mission}</p>
    <div className="mission-stats"><span>€{projectCost(s.project).toFixed(0)} / €{d.budget} spent</span><span><Star size={15}/>{result.complete ? `${result.stars} stars · ${result.score}/100` : 'Chase three stars'}</span></div>
    <p className="field-hint">Full economy points at €{d.economyTarget} or less; they decrease to zero at the €{d.budget} budget. Earn two stars at 80 points and three at 90. A perfect score is 100.</p>
    <div className="guidebook-columns"><div><h3>Your mission</h3><p>{d.description}</p><ul className="mission-objectives">{d.objectives.map(o => <li key={o}><Check size={15}/>{o}</li>)}</ul><h3>Plan your build</h3><p>{notes.kit}</p><p className="field-hint">Add equipment from the component library in Schematic view. Select a component to choose its catalog model and settings. Connect matching terminals, then run and inspect your measurements. Reset to rebuild and try again.</p></div>
    <div><h3><BookOpen size={17}/> Field notes</h3><p>Open one hint at a time when you need a nudge.</p>{notes.hints.map((hint, index) => <details className="mission-hint" key={hint}><summary>Hint {index + 1} · {['Find your approach', 'Build the connections', 'Tune & test'][index]}</summary><p>{hint}</p></details>)}<p className="field-hint">Completion earns your first star. Use less energy, spend less, and finish efficiently to improve your score. Safety and budget constraints must pass.</p></div></div>
    {simulation.time > 0 && <div className="mission-checks"><h3>Live mission checks</h3>{result.checks.map(c => <p key={c.label}>{c.ok ? '✓' : '○'} {c.label}</p>)}</div>}
    <div className="learning-footer"><button className="text-link" onClick={() => actions.set({ view: 'challenges' })}>Browse missions</button><button className="primary-button" onClick={() => actions.set({ view: 'workspace' })}>{simulation.time > 0 ? 'Back to my experiment' : 'Let’s build'}<ArrowUpRight size={15}/></button></div>
  </section></div>;
}
