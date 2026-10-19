import { useEffect, useRef, useState } from 'react';
import Icon from './Icon';

const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

interface MonthPickerProps {
  year: number;
  month: number;
  onChange: (year: number, month: number) => void;
}

/** Month/year picker — a button plus a popover with a year stepper and a
 *  3×4 month grid. Today's month is marked; Esc / outside click closes. */
export default function MonthPicker({ year, month, onChange }: MonthPickerProps) {
  const [open, setOpen] = useState(false);
  const [viewYear, setViewYear] = useState(year);
  const rootRef = useRef<HTMLDivElement>(null);
  const now = new Date();

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

  function toggle() {
    if (!open) setViewYear(year);
    setOpen((v) => !v);
  }
  function pick(m: number) {
    onChange(viewYear, m);
    setOpen(false);
  }
  function step(delta: number) {
    const d = new Date(year, month - 1 + delta, 1);
    onChange(d.getFullYear(), d.getMonth() + 1);
  }

  return (
    <div className="ac-picker ac-month-picker" ref={rootRef}>
      <button type="button" className="ac-icon-btn ac-month-step" title="Previous month" onClick={() => step(-1)}>
        <Icon className="fa-solid fa-chevron-down ac-rot-l" />
      </button>
      <button type="button" className={`ac-month ac-picker-btn ac-month-btn${open ? ' open' : ''}`} aria-haspopup="dialog" aria-expanded={open} onClick={toggle}>
        <Icon className="fa-solid fa-calendar-days" />
        <span className="ac-picker-label">
          {MONTHS_LONG[month - 1]} {year}
        </span>
        <Icon className="fa-solid fa-chevron-down" />
      </button>
      <button type="button" className="ac-icon-btn ac-month-step" title="Next month" onClick={() => step(1)}>
        <Icon className="fa-solid fa-chevron-down ac-rot-r" />
      </button>
      {open && (
        <div className="ac-picker-pop ac-month-pop" role="dialog" aria-label="Choose month">
          <div className="ac-month-year">
            <button type="button" className="ac-icon-btn" title="Previous year" onClick={() => setViewYear((y) => y - 1)}>
              <Icon className="fa-solid fa-chevron-down ac-rot-l" />
            </button>
            <b className="ac-mono">{viewYear}</b>
            <button type="button" className="ac-icon-btn" title="Next year" onClick={() => setViewYear((y) => y + 1)}>
              <Icon className="fa-solid fa-chevron-down ac-rot-r" />
            </button>
          </div>
          <div className="ac-month-grid">
            {MONTHS_SHORT.map((label, i) => {
              const m = i + 1;
              const isSel = viewYear === year && m === month;
              const isNow = viewYear === now.getFullYear() && m === now.getMonth() + 1;
              return (
                <button key={label} type="button" className={`ac-month-cell${isSel ? ' on' : ''}${isNow ? ' now' : ''}`} aria-pressed={isSel} onClick={() => pick(m)}>
                  {label}
                </button>
              );
            })}
          </div>
          <button
            type="button"
            className="ac-month-today"
            onClick={() => {
              onChange(now.getFullYear(), now.getMonth() + 1);
              setOpen(false);
            }}
          >
            This month
          </button>
        </div>
      )}
    </div>
  );
}
