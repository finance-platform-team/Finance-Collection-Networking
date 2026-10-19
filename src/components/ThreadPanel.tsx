import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import Icon from './Icon';
import {
  EMPTY_MIX,
  MSG_CHANGE_RECOMMENDATION,
  MSG_CONFIRMATION_REQUEST,
  MSG_SYSTEM_EVENT,
  OBJECTIVES,
  ROLE_AGENT,
  ROLE_MANAGER,
  STATUS_CHANGE_REQUESTED,
  STATUS_CONFIRMED,
  fmtDateRange,
  fmtShortDate,
  mixSummary,
  type ActivityRow,
  type Message,
  type ObjectiveMix,
  type PlanRow,
} from '../lib/activityComm';
import type { UserRole } from '../lib/useCurrentUser';

export type ThreadTarget = { kind: 'plan'; row: PlanRow } | { kind: 'activity'; row: ActivityRow };

interface ThreadPanelProps {
  target: ThreadTarget;
  messages: Message[];
  role: UserRole;
  myIds: string[];
  monthLabel: string;
  onSend: (body: string) => void;
  onToggleConfirm: (row: PlanRow, confirmed: boolean) => void;
  onRecommend: (row: PlanRow, mix: ObjectiveMix, note: string) => void;
  onAskReconfirm: (row: PlanRow) => void;
  onEditObjectives: () => void;
  onToggleReviewed: (row: ActivityRow, reviewed: boolean) => void;
  onClose: () => void;
}

const QUICK_REPLIES: Record<'plan' | 'activity', Record<UserRole, string[]>> = {
  plan: {
    manager: ["Please confirm this week's objectives.", 'Plan looks good — thanks.', 'Can you add one more Collection visit?'],
    agent: ['Confirmed, will proceed.', 'Can we discuss the mix?', 'One account is unavailable this week.'],
  },
  activity: {
    manager: ['Good outcome — well done.', 'Please upload the missing documents.', 'Follow up on the promised payment date.'],
    agent: ['Documents uploaded.', 'Customer confirmed the payment date.', 'Need support escalating this.'],
  },
};

function fmtTime(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export function StatusPill({ status }: { status: PlanRow['status'] }) {
  if (status === STATUS_CONFIRMED) return <span className="ac-pill ac-pill-ok">Confirmed</span>;
  if (status === STATUS_CHANGE_REQUESTED) return <span className="ac-pill ac-pill-info">Change requested</span>;
  return <span className="ac-pill ac-pill-warn">Awaiting agent</span>;
}

export function OutcomePill({ label }: { label: string }) {
  if (!label) return <span className="ac-pill ac-pill-none">Not logged</span>;
  const tone =
    label === 'Full Payment'
      ? 'ok'
      : label === 'Promise to Pay'
        ? 'info'
        : label === 'Missing Doc' || label === 'Partial Payment'
          ? 'warn'
          : label === 'No Payment' || label === 'Escalated'
            ? 'bad'
            : 'none';
  return <span className={`ac-pill ac-pill-${tone}`}>{label}</span>;
}

export default function ThreadPanel(props: ThreadPanelProps) {
  const { target, messages, role, myIds, monthLabel } = props;
  const [draft, setDraft] = useState('');
  const [recommendOpen, setRecommendOpen] = useState(false);
  const [mixDraft, setMixDraft] = useState<ObjectiveMix>(EMPTY_MIX);
  const [mixNote, setMixNote] = useState('');
  const listRef = useRef<HTMLDivElement>(null);
  const myRole = role === 'agent' ? ROLE_AGENT : ROLE_MANAGER;

  const targetId = target.row.id;
  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages.length, targetId]);

  const latestRecommendation = useMemo(
    () => [...messages].reverse().find((m) => m.type === MSG_CHANGE_RECOMMENDATION && m.suggestedMix),
    [messages]
  );

  function send() {
    const body = draft.trim();
    if (!body) return;
    props.onSend(body);
    setDraft('');
  }
  function onKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  const isMine = (m: Message) => (m.senderId ? myIds.some((id) => id.toLowerCase() === m.senderId.toLowerCase()) : m.senderRole === myRole);

  let title: string;
  let subtitle: string;
  let linked: string;
  let chips: ReactNode;
  if (target.kind === 'plan') {
    const r = target.row;
    title = r.ownerName;
    subtitle = `Week ${r.weekNumber} · ${fmtDateRange(r.from, r.to)}`;
    linked = `KPI Achievement · No. of visits · ${monthLabel} · Week ${r.weekNumber}`;
    chips = (
      <>
        <span className="ac-chip ac-chip-copper">Objective planning</span>
        <span className="ac-chip">{r.plan} planned {r.plan === 1 ? 'activity' : 'activities'}</span>
        <StatusPill status={r.status} />
      </>
    );
  } else {
    const r = target.row;
    title = r.accountName;
    subtitle = `${r.agentName} · ${fmtShortDate(r.date)}`;
    linked = `Activities Log · ${r.accountName} · ${fmtShortDate(r.date)}`;
    chips = (
      <>
        <span className="ac-chip ac-chip-copper">After-activity feedback</span>
        <OutcomePill label={r.outcomeLabel} />
        {r.reviewed ? <span className="ac-pill ac-pill-ok">Reviewed</span> : <span className="ac-pill ac-pill-warn">Not reviewed</span>}
      </>
    );
  }

  return (
    <aside className="ac-panel" aria-label="Thread">
      <div className="ac-panel-head">
        <div className="ac-panel-title-row">
          <div>
            <h2 className="ac-panel-title">{title}</h2>
            <div className="ac-panel-sub">{subtitle}</div>
          </div>
          <button type="button" className="ac-icon-btn" title="Close thread" onClick={props.onClose}>
            <Icon className="fa-solid fa-xmark" />
          </button>
        </div>
        <div className="ac-chips">{chips}</div>
        <div className="ac-linked">
          <Icon className="fa-solid fa-link" /> {linked}
        </div>
      </div>

      <div className="ac-panel-body" ref={listRef}>
        {target.kind === 'plan' ? (
          <PlanContext
            row={target.row}
            role={role}
            recommendation={latestRecommendation?.suggestedMix || null}
            recommendOpen={recommendOpen}
            mixDraft={mixDraft}
            mixNote={mixNote}
            onOpenRecommend={() => {
              setMixDraft({ ...target.row.mix });
              setMixNote('');
              setRecommendOpen(true);
            }}
            onCancelRecommend={() => setRecommendOpen(false)}
            onMixChange={setMixDraft}
            onNoteChange={setMixNote}
            onSubmitRecommend={() => {
              props.onRecommend(target.row, mixDraft, mixNote.trim());
              setRecommendOpen(false);
            }}
            onToggleConfirm={(v) => props.onToggleConfirm(target.row, v)}
            onAskReconfirm={() => props.onAskReconfirm(target.row)}
            onEditObjectives={props.onEditObjectives}
          />
        ) : (
          <FeedbackContext row={target.row} role={role} onToggle={(v) => props.onToggleReviewed(target.row, v)} />
        )}

        <div className="ac-timeline">
          {messages.length === 0 && <div className="ac-empty-thread">No messages yet — start the conversation below.</div>}
          {messages.map((m) =>
            m.type === MSG_SYSTEM_EVENT ? (
              <div key={m.id} className="ac-sys">
                <span>
                  {m.body} · {fmtTime(m.createdOn)}
                </span>
              </div>
            ) : (
              <div key={m.id} className={`ac-msg${isMine(m) ? ' mine' : ''}${m.pending ? ' pending' : ''}`}>
                <div className="ac-msg-meta">
                  {m.senderName || (isMine(m) ? 'You' : m.senderRole === ROLE_AGENT ? 'Agent' : 'Manager')} ·{' '}
                  {m.senderRole === ROLE_AGENT ? 'Collection Agent' : 'Collection Supervisor'}
                </div>
                <div className="ac-bubble">
                  {m.type === MSG_CHANGE_RECOMMENDATION && <span className="ac-tag">Change recommendation</span>}
                  {m.type === MSG_CONFIRMATION_REQUEST && <span className="ac-tag">Confirmation request</span>}
                  <div className="ac-bubble-text">{m.body}</div>
                  {m.suggestedMix && <div className="ac-bubble-mix">Suggested: {mixSummary(m.suggestedMix)}</div>}
                </div>
                <div className="ac-msg-time">{m.pending ? 'Sending…' : fmtTime(m.createdOn)}</div>
              </div>
            )
          )}
        </div>
      </div>

      <div className="ac-composer">
        <div className="ac-quick">
          {QUICK_REPLIES[target.kind][role].map((q) => (
            <button key={q} type="button" className="ac-quick-chip" onClick={() => setDraft(q)}>
              {q}
            </button>
          ))}
        </div>
        <div className="ac-compose-row">
          <textarea
            className="ac-textarea"
            rows={2}
            placeholder="Write a message… (Enter to send, Shift+Enter for a new line)"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKey}
          />
          <button type="button" className="ac-btn ac-btn-primary" disabled={!draft.trim()} onClick={send}>
            <Icon className="fa-solid fa-paper-plane" /> Send
          </button>
        </div>
      </div>
    </aside>
  );
}

interface PlanContextProps {
  row: PlanRow;
  role: UserRole;
  recommendation: ObjectiveMix | null;
  recommendOpen: boolean;
  mixDraft: ObjectiveMix;
  mixNote: string;
  onOpenRecommend: () => void;
  onCancelRecommend: () => void;
  onMixChange: (m: ObjectiveMix) => void;
  onNoteChange: (s: string) => void;
  onSubmitRecommend: () => void;
  onToggleConfirm: (confirmed: boolean) => void;
  onAskReconfirm: () => void;
  onEditObjectives: () => void;
}

function PlanContext(p: PlanContextProps) {
  const { row, role } = p;
  const confirmed = row.status === STATUS_CONFIRMED;
  const isAgent = role === 'agent';
  return (
    <div className="ac-context">
      <div className="ac-context-hdr">
        <span>Objectives this week</span>
        <span className="ac-mono">{row.plan} planned</span>
      </div>
      <div className="ac-obj-list">
        {OBJECTIVES.map((o) => {
          const n = row.mix[o.value];
          const suggested = row.status === STATUS_CHANGE_REQUESTED ? p.recommendation?.[o.value] : undefined;
          return (
            <div key={o.value} className={`ac-obj${n > 0 ? ' on' : ''}`}>
              <span>{o.label}</span>
              <span className="ac-obj-counts">
                {suggested != null && suggested !== n && <span className="ac-obj-suggest" title="Agent's suggestion">→ {suggested}</span>}
                <span className={`ac-count${n > 0 ? ' on' : ''}`}>{n}</span>
              </span>
            </div>
          );
        })}
      </div>

      <label className={`ac-confirm${isAgent ? '' : ' locked'}${confirmed ? ' checked' : ''}`}>
        <input type="checkbox" checked={confirmed} disabled={!isAgent} onChange={(e) => p.onToggleConfirm(e.target.checked)} />
        <span>
          <b>Agent confirms this week's objectives</b>
          <small>
            {confirmed
              ? `Confirmed${row.confirmedByName ? ` by ${row.confirmedByName}` : ''}${row.confirmedOn ? ` · ${fmtTime(row.confirmedOn)}` : ''}`
              : row.status === STATUS_CHANGE_REQUESTED
                ? 'Agent proposed a different mix'
                : 'Awaiting agent confirmation'}
          </small>
        </span>
      </label>

      {!isAgent && (
        <div className="ac-lock-hint">
          <Icon className="fa-solid fa-lock" /> Only the agent can tick the confirmation. You can reply, adjust the plan or ask again.
        </div>
      )}

      {isAgent && !confirmed && !p.recommendOpen && (
        <button type="button" className="ac-btn ac-btn-ghost ac-btn-block" onClick={p.onOpenRecommend}>
          <Icon className="fa-solid fa-rotate" /> Recommend a different mix
        </button>
      )}

      {isAgent && p.recommendOpen && (
        <div className="ac-recommend">
          {OBJECTIVES.map((o) => (
            <div key={o.value} className="ac-recommend-row">
              <span>{o.label}</span>
              <div className="ac-stepper">
                <button type="button" onClick={() => p.onMixChange({ ...p.mixDraft, [o.value]: Math.max(0, p.mixDraft[o.value] - 1) })} aria-label={`Fewer ${o.label}`}>
                  −
                </button>
                <span className="ac-mono">{p.mixDraft[o.value]}</span>
                <button type="button" onClick={() => p.onMixChange({ ...p.mixDraft, [o.value]: p.mixDraft[o.value] + 1 })} aria-label={`More ${o.label}`}>
                  +
                </button>
              </div>
            </div>
          ))}
          <textarea className="ac-textarea" rows={2} placeholder="Why? (optional)" value={p.mixNote} onChange={(e) => p.onNoteChange(e.target.value)} />
          <div className="ac-recommend-actions">
            <button type="button" className="ac-btn ac-btn-ghost" onClick={p.onCancelRecommend}>
              Cancel
            </button>
            <button type="button" className="ac-btn ac-btn-primary" onClick={p.onSubmitRecommend}>
              Send recommendation
            </button>
          </div>
        </div>
      )}

      {!isAgent && row.status === STATUS_CHANGE_REQUESTED && (
        <div className="ac-manager-actions">
          <button type="button" className="ac-btn ac-btn-ghost" onClick={p.onAskReconfirm}>
            <Icon className="fa-solid fa-rotate-left" /> Keep plan, ask to re-confirm
          </button>
          <button type="button" className="ac-btn ac-btn-primary" onClick={p.onEditObjectives}>
            <Icon className="fa-solid fa-pen" /> Edit objectives
          </button>
        </div>
      )}
    </div>
  );
}

function FeedbackContext({ row, role, onToggle }: { row: ActivityRow; role: UserRole; onToggle: (v: boolean) => void }) {
  const isManager = role === 'manager';
  return (
    <div className="ac-context">
      <div className="ac-context-hdr">
        <span>Activity outcome</span>
        <span className="ac-mono">{fmtShortDate(row.date)}</span>
      </div>
      <div className="ac-obj-list">
        <div className="ac-obj">
          <span>Objective</span>
          <span>{row.objectiveLabel || '—'}</span>
        </div>
        <div className="ac-obj">
          <span>Outcome</span>
          <OutcomePill label={row.outcomeLabel} />
        </div>
      </div>
      <label className={`ac-confirm${isManager ? '' : ' locked'}${row.reviewed ? ' checked' : ''}`}>
        <input type="checkbox" checked={row.reviewed} disabled={!isManager} onChange={(e) => onToggle(e.target.checked)} />
        <span>
          <b>Reviewed by manager</b>
          <small>
            {row.reviewed
              ? `Checked${row.reviewedByName ? ` by ${row.reviewedByName}` : ''}${row.reviewedOn ? ` · ${fmtTime(row.reviewedOn)}` : ''}`
              : 'Not reviewed yet'}
          </small>
        </span>
      </label>
      {!isManager && (
        <div className="ac-lock-hint">
          <Icon className="fa-solid fa-lock" /> Only the manager can mark this activity as reviewed.
        </div>
      )}
    </div>
  );
}
