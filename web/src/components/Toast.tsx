import { useEffect, useState } from 'react';

export interface ToastMessage {
  id: number;
  text: string;
  tone: 'info' | 'error';
}

type Listener = (messages: ToastMessage[]) => void;

let messages: ToastMessage[] = [];
const listeners = new Set<Listener>();
let nextId = 1;

function emit() {
  for (const l of listeners) l([...messages]);
}

export function toast(text: string, tone: ToastMessage['tone'] = 'info'): void {
  const message = { id: nextId++, text, tone };
  messages = [...messages, message];
  emit();
  setTimeout(() => {
    messages = messages.filter((m) => m.id !== message.id);
    emit();
  }, tone === 'error' ? 6000 : 3000);
}

/** Renders anywhere; there is one queue for the whole app. */
export function Toaster() {
  const [items, setItems] = useState<ToastMessage[]>(messages);
  useEffect(() => {
    listeners.add(setItems);
    return () => {
      listeners.delete(setItems);
    };
  }, []);

  if (!items.length) return null;
  return (
    <div className="fixed bottom-5 left-1/2 -translate-x-1/2 z-[100] flex flex-col gap-2 items-center pointer-events-none">
      {items.map((m) => (
        <div
          key={m.id}
          role="status"
          className={`pointer-events-auto rounded-lg px-4 py-2 text-sm shadow-lg border ${
            m.tone === 'error'
              ? 'bg-red-600 text-white border-red-700'
              : 'bg-raised text-ink border-rule'
          }`}
        >
          {m.text}
        </div>
      ))}
    </div>
  );
}
