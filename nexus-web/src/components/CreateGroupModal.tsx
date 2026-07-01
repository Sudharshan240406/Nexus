import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { createConversation, searchUserByPhone } from "../services/api";
import { useConversationStore } from "../stores/conversationStore";
import type { User } from "../types";

interface CreateGroupModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function CreateGroupModal({ isOpen, onClose }: CreateGroupModalProps) {
  const navigate = useNavigate();
  const [groupName, setGroupName] = useState("");
  const [searchPhone, setSearchPhone] = useState("");
  const [selectedParticipants, setSelectedParticipants] = useState<User[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [createLoading, setCreateLoading] = useState(false);
  const [error, setError] = useState("");

  if (!isOpen) return null;

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchPhone.trim()) return;
    setSearchLoading(true);
    setError("");
    try {
      const user = await searchUserByPhone(searchPhone.trim());
      // Check if already in selected
      if (selectedParticipants.some((p) => p.id === user.id)) {
        setError("User already added to the group");
        setSearchPhone("");
        return;
      }
      
      setSelectedParticipants((prev) => [...prev, user]);
      setSearchPhone("");
    } catch (err: any) {
      setError(err.message || "User not found");
    } finally {
      setSearchLoading(false);
    }
  };

  const handleRemoveParticipant = (id: string) => {
    setSelectedParticipants((prev) => prev.filter((p) => p.id !== id));
  };

  const handleCreate = async () => {
    if (!groupName.trim() || selectedParticipants.length === 0) return;
    setCreateLoading(true);
    setError("");
    try {
      const conv = await createConversation({
        is_group: true,
        title: groupName.trim(),
        participant_ids: selectedParticipants.map((p) => p.id),
      });

      // Add to store
      useConversationStore.getState().addConversation(conv);
      // Close modal
      onClose();
      // Navigate to chat
      navigate(`/chat/${conv.id}`);
    } catch (err: any) {
      setError(err.message || "Failed to create group");
    } finally {
      setCreateLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-dark-950/70 backdrop-blur-sm animate-fade-in">
      <div className="w-full max-w-md bg-dark-800/95 glass-strong rounded-2xl p-6 shadow-2xl relative border border-white/[0.08] text-dark-50 animate-scale-up">
        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-dark-300 hover:text-dark-50 transition-colors"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>

        <h3 className="text-lg font-bold text-gradient mb-5">Create New Group</h3>

        <div className="space-y-4">
          {/* Group Name */}
          <div>
            <label className="block text-xs font-semibold text-dark-300 uppercase tracking-wider mb-1.5">
              Group Name
            </label>
            <input
              type="text"
              value={groupName}
              onChange={(e) => setGroupName(e.target.value)}
              placeholder="e.g. Project Nexus"
              className="
                w-full bg-dark-700/60 text-dark-50 placeholder-dark-400
                px-4 py-2.5 rounded-xl border border-white/[0.06] text-sm
                focus:outline-none focus:border-nexus-500/40 focus:ring-1 focus:ring-nexus-500/20
                transition-all
              "
              autoFocus
            />
          </div>

          {/* Add Participants */}
          <div>
            <label className="block text-xs font-semibold text-dark-300 uppercase tracking-wider mb-1.5">
              Add Participants by Phone
            </label>
            <form onSubmit={handleSearch} className="flex gap-2">
              <input
                type="tel"
                value={searchPhone}
                onChange={(e) => setSearchPhone(e.target.value)}
                placeholder="e.g. +91-9999999902"
                className="
                  flex-1 bg-dark-700/60 text-dark-50 placeholder-dark-400
                  px-4 py-2.5 rounded-xl border border-white/[0.06] text-sm
                  focus:outline-none focus:border-nexus-500/40 focus:ring-1 focus:ring-nexus-500/20
                  transition-all
                "
              />
              <button
                type="submit"
                disabled={!searchPhone.trim() || searchLoading}
                className="
                  px-4 rounded-xl bg-nexus-500 text-white text-sm font-semibold
                  hover:bg-nexus-400 active:scale-95 transition-all
                  disabled:opacity-40 disabled:cursor-not-allowed
                "
              >
                {searchLoading ? (
                  <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin inline-block" />
                ) : (
                  "Add"
                )}
              </button>
            </form>
            {error && <p className="text-xs text-red-400 mt-1.5">{error}</p>}
          </div>

          {/* Participant List */}
          <div>
            <label className="block text-xs font-semibold text-dark-300 uppercase tracking-wider mb-2">
              Selected Participants ({selectedParticipants.length})
            </label>
            {selectedParticipants.length === 0 ? (
              <div className="py-4 text-center border border-dashed border-white/[0.05] rounded-xl text-dark-400 text-xs">
                No participants added yet.
              </div>
            ) : (
              <div className="max-h-40 overflow-y-auto space-y-1.5 pr-1">
                {selectedParticipants.map((p) => (
                  <div
                    key={p.id}
                    className="flex items-center justify-between px-3 py-2 bg-white/[0.02] border border-white/[0.04] rounded-xl hover:bg-white/[0.04] transition-all"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className="w-7 h-7 rounded-full bg-nexus-500/10 text-nexus-400 flex items-center justify-center font-bold text-xs">
                        {p.display_name?.charAt(0).toUpperCase() || p.phone.charAt(0)}
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-dark-100 truncate">
                          {p.display_name || p.phone}
                        </p>
                        {p.display_name && (
                          <p className="text-[10px] text-dark-400 truncate">{p.phone}</p>
                        )}
                      </div>
                    </div>
                    <button
                      onClick={() => handleRemoveParticipant(p.id)}
                      className="p-1 rounded-lg text-dark-300 hover:text-red-400 hover:bg-red-500/10 transition-all"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="18" y1="6" x2="6" y2="18" />
                        <line x1="6" y1="6" x2="18" y2="18" />
                      </svg>
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Footer Actions */}
          <div className="flex gap-3 pt-3 border-t border-white/[0.05]">
            <button
              onClick={onClose}
              type="button"
              className="
                flex-1 px-4 py-2.5 rounded-xl border border-white/[0.08] text-dark-200 hover:text-white hover:bg-white/5 text-sm font-medium transition-all
              "
            >
              Cancel
            </button>
            <button
              onClick={handleCreate}
              disabled={!groupName.trim() || selectedParticipants.length === 0 || createLoading}
              className="
                flex-1 px-4 py-2.5 rounded-xl bg-nexus-500 text-white text-sm font-semibold
                hover:bg-nexus-400 active:scale-98 transition-all shadow-lg shadow-nexus-500/15
                disabled:opacity-40 disabled:cursor-not-allowed
              "
            >
              {createLoading ? (
                <span className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin inline-block" />
              ) : (
                "Create Group"
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
