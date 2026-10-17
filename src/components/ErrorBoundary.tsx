import { Component, type ReactNode } from "react";
import { actions, getState, useLab } from "../editor/store";

/**
 * Keeps a rendering error in one pane from unmounting the whole application. The project, the
 * simulation and the undo history live outside React (editor store), so they survive: the fallback
 * pauses the run and offers to retry, undo the last change or save the project file.
 *
 * Regression hook: `window.__physicsLabRenderFault = "<area>"` makes that area's next render throw
 * (used by e2e/editor-regressions.spec.ts; inert otherwise).
 */
declare global { interface Window { __physicsLabRenderFault?: string } }
function FaultProbe({ area }: { area: string }) {
  // Renders with every store update, like the panes themselves (the shell no longer re-renders them on each refresh).
  useLab();
  // Cleared in componentDidCatch, not here: React retries a failed render once before giving up.
  if (typeof window !== "undefined" && window.__physicsLabRenderFault === area) throw new Error(`Injected rendering fault in ${area}`);
  return null;
}
interface Props { area: string; label: string; children: ReactNode }
export default class ErrorBoundary extends Component<Props, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error, info: { componentStack?: string | null }) {
    console.error(`Physics Lab: ${this.props.label} failed to render`, error, info.componentStack);
    if (typeof window !== "undefined" && window.__physicsLabRenderFault === this.props.area) window.__physicsLabRenderFault = undefined;
    // A running simulation would keep advancing behind a broken view. Deferred: the failing render may come
    // from an update emitted in the middle of an action (e.g. while the run is being started).
    setTimeout(() => { if (getState().running) actions.run(); }, 0);
  }
  retry = () => this.setState({ error: null });
  render() {
    if (!this.state.error) return <><FaultProbe area={this.props.area} />{this.props.children}</>;
    return (
      <div className="render-error" role="alert" data-testid={`render-error-${this.props.area}`}>
        <strong>{this.props.label} could not be displayed.</strong>
        <p>Your project and simulation state are kept; the simulation was paused. Try again, undo the last change, or save the project file.</p>
        <code>{this.state.error.message}</code>
        <div>
          <button onClick={this.retry}>Try again</button>
          <button onClick={() => { actions.undo(); this.retry(); }}>Undo last change</button>
          <button onClick={() => actions.save()}>Save project file</button>
        </div>
      </div>
    );
  }
}
