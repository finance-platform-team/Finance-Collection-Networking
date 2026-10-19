import { useEffect, useMemo, useRef, useState } from 'react';
import Icon from './Icon';
import { initials } from '../lib/activityComm';

interface AgentPickerProps {
  options: { id: string; name: string }[];
  value: string;
  onChange: (id: string) => void;
}

/** Styled single-select for the Activity Communication agent filter — a
 *  button plus a searchable popover, keyboard friendly (Esc closes). */
export default function AgentPicker({ options, value, onChange }: AgentPickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);
  const selected = options.find((o) => o.id === value);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? options.filter((o) => o.name.toLowerCase().includes(q)) : options;
  }, [options, query]);

  function pick(id: string) {
    onChange(id);
    setOpen(false);
    setQuery('');
  }

  return (
    <div className="ac-picker" ref={rootRef}>
      <button type="button" className={`ac-month ac-picker-btn${open ? ' open' : ''}`} aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        {selected ? <span className="ac-avatar ac-avatar-sm">{initials(selected.name)}</span> : <Icon className="fa-solid fa-users" />}
        <span className="ac-picker-label">{selected ? selected.name : `All agents (${options.length})`}</span>
        <Icon className="fa-solid fa-chevron-down" />
      </button>
      {open && (
        <div className="ac-picker-pop" role="listbox">
          <label className="ac-picker-search">
            <Icon className="fa-solid fa-magnifying-glass" />
            <input autoFocus placeholder="Search agent" value={query} onChange={(e) => setQuery(e.target.value)} />
          </label>
          <div className="ac-picker-list">
            {!query && (
              <button type="button" role="option" aria-selected={!value} className={`ac-picker-opt${!value ? ' on' : ''}`} onClick={() => pick('')}>
                <span className="ac-avatar ac-avatar-sm ac-avatar-all">
                  <Icon className="fa-solid fa-users" />
                </span>
                <span className="ac-picker-name">All agents</span>
                <span className="ac-picker-count ac-mono">{options.length}</span>
                {!value && <Icon className="fa-solid fa-check" />}
              </button>
            )}
            {matches.map((o) => (
              <button key={o.id} type="button" role="option" aria-selected={o.id === value} className={`ac-picker-opt${o.id === value ? ' on' : ''}`} onClick={() => pick(o.id)}>
                <span className="ac-avatar ac-avatar-sm">{initials(o.name)}</span>
                <span className="ac-picker-name">{o.name}</span>
                {o.id === value && <Icon className="fa-solid fa-check" />}
              </button>
            ))}
            {matches.length === 0 && <div className="ac-picker-empty">No agent matches “{query}”.</div>}
          </div>
        </div>
      )}
    </div>
  );
}
