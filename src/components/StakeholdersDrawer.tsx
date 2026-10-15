import { useState } from 'react';
import Icon from './Icon';
import { useConfirm } from '../lib/useConfirm';
import {
  DEPARTMENT_OPTIONS,
  ROLE_OPTIONS,
  createStakeholder,
  deleteStakeholder,
  initials,
  updateStakeholder,
  type Stakeholder,
} from '../lib/stakeholders';

interface StakeholdersDrawerProps {
  open: boolean;
  account: { id: string; name: string; code: string } | null;
  stakeholders: Stakeholder[];
  /** Open straight into the "add" form (used when the account has none yet). */
  startInAddMode: boolean;
  onClose: () => void;
  /** Called after any successful write so the parent can reload its stakeholder map. */
  onChanged: (message: string) => Promise<void> | void;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_PATTERN = /^\+?[0-9\s\-()]{6,20}$/;

/** Department → accent class, so each department reads as its own color in the list. */
function deptClass(department: number | null): string {
  switch (department) {
    case 983080000:
      return 'sh-dept-mgmt';
    case 983080001:
      return 'sh-dept-hr';
    case 983080002:
      return 'sh-dept-fin';
    case 983080003:
      return 'sh-dept-med';
    default:
      return 'sh-dept-none';
  }
}

export default function StakeholdersDrawer({ open, account, stakeholders, startInAddMode, onClose, onChanged }: StakeholdersDrawerProps) {
  const { confirm, dialog } = useConfirm();
  const [mode, setMode] = useState<'list' | 'form'>('list');
  const [editId, setEditId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [role, setRole] = useState('');
  const [department, setDepartment] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  function resetForm(s?: Stakeholder) {
    setError('');
    setEditId(s?.id || null);
    setName(s?.name || '');
    setRole(s?.role != null ? String(s.role) : '');
    setDepartment(s?.department != null ? String(s.department) : '');
    setPhone(s?.phone || '');
    setEmail(s?.email || '');
  }

  // Reset whenever the drawer is (re)opened for an account — done during render
  // rather than in an effect so the first painted frame already shows the right mode.
  const openKey = open ? `${account?.id || ''}|${startInAddMode}` : '';
  const [lastOpenKey, setLastOpenKey] = useState('');
  if (openKey !== lastOpenKey) {
    setLastOpenKey(openKey);
    if (openKey) {
      resetForm();
      setMode(startInAddMode ? 'form' : 'list');
    }
  }

  function startAdd() {
    resetForm();
    setMode('form');
  }

  function startEdit(s: Stakeholder) {
    resetForm(s);
    setMode('form');
  }

  function cancelForm() {
    resetForm();
    if (stakeholders.length === 0) onClose();
    else setMode('list');
  }

  async function handleSave() {
    if (!account) return;
    const trimmedName = name.trim();
    const trimmedPhone = phone.trim();
    const trimmedEmail = email.trim();
    if (!trimmedName) return setError('Name is required.');
    if (!department) return setError('Department is required.');
    if (!role) return setError('Role is required.');
    if (!trimmedPhone) return setError('Phone is required.');
    if (!PHONE_PATTERN.test(trimmedPhone)) return setError('Phone number looks invalid — use digits, spaces, dashes and an optional leading +.');
    if (trimmedEmail && !EMAIL_PATTERN.test(trimmedEmail)) return setError('Email address looks invalid.');

    setSaving(true);
    setError('');
    try {
      const input = {
        name: trimmedName,
        role: parseInt(role, 10),
        department: parseInt(department, 10),
        phone: trimmedPhone,
        email: trimmedEmail,
      };
      if (editId) await updateStakeholder(editId, input);
      else await createStakeholder(account.id, input);
      await onChanged(editId ? 'Stakeholder updated' : 'Stakeholder added');
      resetForm();
      setMode('list');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(s: Stakeholder) {
    const ok = await confirm({
      title: 'Remove stakeholder?',
      message: `${s.name} will be permanently removed from ${account?.name || 'this account'}.`,
      danger: true,
      confirmLabel: 'Remove',
    });
    if (!ok) return;
    setDeletingId(s.id);
    try {
      await deleteStakeholder(s.id);
      await onChanged('Stakeholder removed');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setDeletingId(null);
    }
  }

  const inForm = mode === 'form';

  return (
    <>
      <aside className={`acc-drawer sh-drawer${open ? ' on' : ''}`}>
        <div className="acc-dhead">
          <div className="sh-dhead-text">
            <h2>
              <Icon className="fa-solid fa-users" style={{ color: 'var(--gold)', fontSize: 16 }} />
              {inForm ? (editId ? 'Edit Stakeholder' : 'Add Stakeholder') : 'Stakeholders'}
            </h2>
            {account && (
              <div className="sh-dhead-sub">
                {account.name}
                {account.code && account.code !== '—' && <span className="acc-code"> · {account.code}</span>}
              </div>
            )}
          </div>
          <button className="acc-dclose" onClick={onClose} aria-label="Close">
            <Icon className="fa-solid fa-xmark" />
          </button>
        </div>

        <div className="acc-dbody">
          <div className={`acc-err${error ? ' on' : ''}`}>{error}</div>

          {inForm ? (
            <>
              {!editId && stakeholders.length === 0 && (
                <div className="sh-intro">
                  <span className="sh-intro-icon">
                    <Icon className="fa-solid fa-user-plus" />
                  </span>
                  <div>
                    <div className="sh-intro-title">No stakeholders on this account yet</div>
                    <div className="sh-intro-text">Add the key people you deal with — decision makers, finance and medical contacts.</div>
                  </div>
                </div>
              )}
              <div className="acc-fld">
                <label>
                  Full Name <span className="dm-req">*</span>
                </label>
                <input placeholder="e.g. Dr. Ahmed Hassan" value={name} maxLength={100} onChange={(e) => setName(e.target.value)} autoFocus />
              </div>
              <div className="dm-fld-row">
                <div className="acc-fld">
                  <label>
                    Role <span className="dm-req">*</span>
                  </label>
                  <select value={role} onChange={(e) => setRole(e.target.value)}>
                    <option value="">— Select role —</option>
                    {ROLE_OPTIONS.map((r) => (
                      <option key={r.value} value={r.value}>
                        {r.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="acc-fld">
                  <label>
                    Department <span className="dm-req">*</span>
                  </label>
                  <select value={department} onChange={(e) => setDepartment(e.target.value)}>
                    <option value="">— Select —</option>
                    {DEPARTMENT_OPTIONS.map((d) => (
                      <option key={d.value} value={d.value}>
                        {d.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="acc-fld">
                <label>
                  Phone <span className="dm-req">*</span>
                </label>
                <input type="tel" inputMode="tel" placeholder="e.g. +20 100 123 4567" value={phone} maxLength={20} onChange={(e) => setPhone(e.target.value)} />
              </div>
              <div className="acc-fld">
                <label>Email</label>
                <input type="email" inputMode="email" placeholder="name@company.com" value={email} maxLength={100} onChange={(e) => setEmail(e.target.value)} />
              </div>
            </>
          ) : stakeholders.length === 0 ? (
            <div className="sh-empty">
              <span className="sh-empty-icon">
                <Icon className="fa-solid fa-user-plus" />
              </span>
              <div className="sh-intro-title">No stakeholders yet</div>
              <div className="sh-intro-text">Every account should have at least one point of contact.</div>
              <button className="acc-btn acc-btn-primary" onClick={startAdd}>
                <Icon className="fa-solid fa-plus" /> Add first stakeholder
              </button>
            </div>
          ) : (
            <div className="sh-list">
              {stakeholders.map((s) => (
                <div key={s.id} className="sh-card">
                  <div className={`sh-avatar ${deptClass(s.department)}`}>{initials(s.name)}</div>
                  <div className="sh-card-body">
                    <div className="sh-card-top">
                      <div className="sh-name">{s.name}</div>
                      <div className="sh-card-act">
                        <button title="Edit" onClick={() => startEdit(s)}>
                          <Icon className="fa-solid fa-pen" />
                        </button>
                        <button className="sh-del" title="Remove" disabled={deletingId === s.id} onClick={() => handleDelete(s)}>
                          <Icon className={`fa-solid ${deletingId === s.id ? 'fa-spinner fa-spin' : 'fa-trash'}`} />
                        </button>
                      </div>
                    </div>
                    <div className="sh-meta">
                      <span className="sh-role">{s.roleLabel || 'Role not set'}</span>
                      {s.departmentLabel && <span className={`sh-dept ${deptClass(s.department)}`}>{s.departmentLabel}</span>}
                    </div>
                    <div className="sh-contacts">
                      {s.phone ? (
                        <a href={`tel:${s.phone.replace(/\s+/g, '')}`} className="sh-contact">
                          <Icon className="fa-solid fa-phone" /> {s.phone}
                        </a>
                      ) : (
                        <span className="sh-contact sh-contact-missing">
                          <Icon className="fa-solid fa-phone" /> No phone
                        </span>
                      )}
                      {s.email ? (
                        <a href={`mailto:${s.email}`} className="sh-contact">
                          <Icon className="fa-solid fa-envelope" /> {s.email}
                        </a>
                      ) : (
                        <span className="sh-contact sh-contact-missing">
                          <Icon className="fa-solid fa-envelope" /> No email
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="acc-dfoot">
          {inForm ? (
            <>
              <button className="acc-btn acc-btn-ghost" onClick={cancelForm} disabled={saving}>
                Cancel
              </button>
              <button className="acc-btn acc-btn-primary" disabled={saving} onClick={handleSave}>
                {saving ? (
                  <>
                    <Icon className="fa-solid fa-spinner fa-spin" /> Saving…
                  </>
                ) : editId ? (
                  'Save Changes'
                ) : (
                  'Add Stakeholder'
                )}
              </button>
            </>
          ) : (
            <>
              <button className="acc-btn acc-btn-ghost" onClick={onClose}>
                Close
              </button>
              {stakeholders.length > 0 && (
                <button className="acc-btn acc-btn-primary" onClick={startAdd}>
                  <Icon className="fa-solid fa-plus" /> Add Stakeholder
                </button>
              )}
            </>
          )}
        </div>
      </aside>
      {dialog}
    </>
  );
}
