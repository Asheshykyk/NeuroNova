import type { ViewId } from '../types';

const links: Array<{ id: ViewId; label: string; mark: string }> = [
  { id: 'overview', label: 'Overview', mark: '◫' },
  { id: 'live-feed', label: 'Live evidence feed', mark: '◌' },
  { id: 'verification', label: 'Three-way verification', mark: '◇' },
  { id: 'explorer', label: 'Evidence explorer', mark: '▤' },
  { id: 'recovery', label: 'Recovery & continuity', mark: '↗' },
  { id: 'checkpoints', label: 'Checkpoint status', mark: '⌁' }
];

export function Navigation({ activeView, onNavigate }: { activeView: ViewId; onNavigate: (view: ViewId) => void }) {
  return (
    <nav aria-label="Primary navigation" className="navigation">
      {links.map((link) => (
        <button
          className={`nav-link ${activeView === link.id ? 'active' : ''}`}
          key={link.id}
          onClick={() => onNavigate(link.id)}
          aria-current={activeView === link.id ? 'page' : undefined}
        >
          <span aria-hidden="true">{link.mark}</span>
          {link.label}
        </button>
      ))}
    </nav>
  );
}
