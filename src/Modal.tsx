import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

// A native modal makes the entire background inert, including xterm's hidden textarea.
export function Modal({ label, onClose, children, backdropClose = false, className = '' }: {
  label: string; onClose: () => void; children: ReactNode; backdropClose?: boolean; className?: string;
}) {
  const element = useRef<HTMLDialogElement>(null);
  useLayoutEffect(() => {
    const dialog = element.current!;
    const previous = document.activeElement as HTMLElement | null;
    dialog.showModal();
    const first = dialog.querySelector<HTMLElement>('[data-modal-initial]') || dialog.querySelector<HTMLElement>('input:not([type="checkbox"]):not([disabled])') || dialog.querySelector<HTMLElement>('button:not([disabled])');
    first?.focus();
    return () => {
      dialog.close();
      if (previous?.isConnected) previous.focus();
    };
  }, []);
  return createPortal(<dialog ref={element} className={`modal-backdrop ${className}`} aria-label={label}
    onCancel={event => { event.preventDefault(); onClose(); }}
    onMouseDown={event => { if (backdropClose && event.target === event.currentTarget) onClose(); }}>
    {children}
  </dialog>, document.body);
}
