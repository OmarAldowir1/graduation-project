// ============================================
// MOTION — Reusable Modal Component
// ============================================

import { useEffect, useRef } from 'react';

/**
 * Reusable Modal component.
 *
 * @param {Object} props
 * @param {boolean} props.isOpen - Whether the modal is visible
 * @param {Function} props.onClose - Called when backdrop or X is clicked
 * @param {string} props.title - Modal header title
 * @param {React.ReactNode} props.children - Modal body content
 * @param {React.ReactNode} [props.footer] - Optional footer content
 * @param {string} [props.size] - 'sm' | 'md' | 'lg'  (default 'md')
 */
export default function Modal({ isOpen, onClose, title, children, footer, size = 'md' }) {
  const backdropRef = useRef(null);

  useEffect(() => {
    if (!isOpen) return;

    const handleEsc = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const maxWidth = size === 'sm' ? '360px' : size === 'lg' ? '640px' : '480px';

  return (
    <div
      ref={backdropRef}
      className="modal-backdrop"
      onClick={(e) => {
        if (e.target === backdropRef.current) onClose();
      }}
    >
      <div className="modal-container" style={{ maxWidth }}>
        <div className="modal-header">
          <h3>{title}</h3>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: 'var(--on-surface-variant, #5a6060)',
              display: 'flex',
              alignItems: 'center',
              padding: '0.25rem',
              borderRadius: '0.375rem',
              transition: 'background 0.15s'
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--surface-container, #ebeeed)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}
          >
            <span className="material-symbols-outlined" style={{ fontSize: '1.25rem' }}>
              close
            </span>
          </button>
        </div>

        <div className="modal-body">{children}</div>

        {footer ? <div className="modal-footer">{footer}</div> : null}
      </div>
    </div>
  );
}

// ============================================
// Shortcut: Confirm Dialog (replaces window.confirm)
// ============================================

export function ConfirmDialog({ isOpen, onClose, onConfirm, title, message, confirmText = 'Confirm', danger = false }) {
  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title || 'Confirm'} size="sm"
      footer={
        <>
          <button className="modal-btn-secondary" onClick={onClose}>Cancel</button>
          <button className={danger ? 'modal-btn-danger' : 'modal-btn-primary'} onClick={onConfirm}>
            {confirmText}
          </button>
        </>
      }
    >
      <p className="confirm-dialog-message">{message}</p>
    </Modal>
  );
}

// ============================================
// Shortcut: Prompt Dialog (replaces window.prompt)
// ============================================

import { useState } from 'react';

export function PromptDialog({ isOpen, onClose, onSubmit, title, placeholder, submitText = 'Create', defaultValue = '' }) {
  const [value, setValue] = useState(defaultValue);

  useEffect(() => {
    if (!isOpen) return undefined;
    const timer = window.setTimeout(() => setValue(defaultValue), 0);
    return () => window.clearTimeout(timer);
  }, [isOpen, defaultValue]);

  function handleSubmit(e) {
    e.preventDefault();
    if (value.trim()) {
      onSubmit(value.trim());
      onClose();
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title} size="sm"
      footer={
        <>
          <button className="modal-btn-secondary" onClick={onClose}>Cancel</button>
          <button className="modal-btn-primary" onClick={handleSubmit} disabled={!value.trim()}>
            {submitText}
          </button>
        </>
      }
    >
      <form onSubmit={handleSubmit}>
        <input
          className="modal-input"
          type="text"
          placeholder={placeholder || 'Enter a name...'}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          autoFocus
        />
      </form>
    </Modal>
  );
}
