import React from 'react';
import { CircleAlert } from 'lucide-react';
import { t } from '../../i18n/index.js';

// An uncaught error while React renders, or in an effect, unmounts the whole tree: the window
// went blank. A boundary keeps the failure inside the part it wraps. Everything held above it
// (for the editor: the open project, its history and autosave) stays mounted and keeps working;
// Try again renders the part afresh. The error goes to the console, which the main process
// copies into the crash log.
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error(`Interface error in ${this.props.name || 'the app'}: ${error?.stack || error}${info?.componentStack || ''}`);
  }

  render() {
    if (!this.state.error) return this.props.children;
    const retry = () => this.setState({ error: null });
    return (
      <div className="error-boundary" role="alert">
        <div className="modal">
          <div className="modal-icon error"><CircleAlert size={26} /></div>
          <h3>{t('error-boundary.title')}</h3>
          <p className="muted">{this.props.message || t('error-boundary.message')}</p>
          <div className="modal-actions">
            {window.api?.openCrashLog && <button className="btn" onClick={() => window.api.openCrashLog()}>{t('app.show_crash_log')}</button>}
            {this.props.onUndo && <button className="btn" onClick={() => { this.props.onUndo(); retry(); }}>{t('error-boundary.undo')}</button>}
            <button className="btn btn-primary" onClick={retry}>{t('error-boundary.try_again')}</button>
          </div>
        </div>
      </div>
    );
  }
}
