import { useState } from "react";

interface SearchContactsProps {
  onStartChat: (phone: string) => void;
  isLoading: boolean;
}

export default function SearchContacts({ onStartChat, isLoading }: SearchContactsProps) {
  const [phone, setPhone] = useState("");
  const [isOpen, setIsOpen] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!phone.trim()) return;
    onStartChat(phone.trim());
    setPhone("");
    setIsOpen(false);
  };

  return (
    <div className="relative">
      {/* Toggle button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="
          w-10 h-10 rounded-xl flex items-center justify-center
          bg-nexus-500/15 text-nexus-400
          hover:bg-nexus-500/25 hover:text-nexus-300
          transition-all active:scale-95
        "
        title="New conversation"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="12" y1="5" x2="12" y2="19" />
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
      </button>

      {/* Dropdown */}
      {isOpen && (
        <div className="absolute right-0 top-12 w-80 glass-strong rounded-2xl p-4 animate-slide-up z-50">
          <h3 className="text-sm font-semibold text-dark-50 mb-3">
            Start a new chat
          </h3>

          <form onSubmit={handleSubmit} className="flex gap-2">
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="Enter phone number"
              className="
                flex-1 bg-dark-700/60 text-dark-50 placeholder-dark-300
                px-3 py-2 rounded-xl border border-white/[0.06] text-sm
                focus:outline-none focus:border-nexus-500/40
              "
              autoFocus
            />
            <button
              type="submit"
              disabled={!phone.trim() || isLoading}
              className="
                px-4 py-2 rounded-xl bg-nexus-500 text-white text-sm font-medium
                hover:bg-nexus-400 transition-all
                disabled:opacity-40 disabled:cursor-not-allowed
              "
            >
              {isLoading ? (
                <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin inline-block" />
              ) : (
                "Chat"
              )}
            </button>
          </form>

          <p className="text-[11px] text-dark-300 mt-2">
            Enter a registered phone number (e.g. +91-9999999901)
          </p>
        </div>
      )}

      {/* Backdrop */}
      {isOpen && (
        <div
          className="fixed inset-0 z-40"
          onClick={() => setIsOpen(false)}
        />
      )}
    </div>
  );
}
