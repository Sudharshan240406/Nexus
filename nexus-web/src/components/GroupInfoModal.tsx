import { useState } from "react";
import { useAuthStore } from "../stores/authStore";
import { useConversationStore } from "../stores/conversationStore";
import {
  searchUserByPhone,
  addGroupMember,
  removeGroupMember,
  updateMemberRole,
  getConversations,
} from "../services/api";
import { useNavigate } from "react-router-dom";
import type { Conversation, Participant } from "../types";

interface GroupInfoModalProps {
  conversation: Conversation;
  onClose: () => void;
}

export default function GroupInfoModal({ conversation, onClose }: GroupInfoModalProps) {
  const navigate = useNavigate();
  const currentUserId = useAuthStore((s) => s.userId);
  const setConversations = useConversationStore((s) => s.setConversations);

  // Search/Add states
  const [phone, setPhone] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const currentUserParticipant = conversation.participants.find(
    (p) => p.user_id === currentUserId
  );
  const isCurrentUserAdmin = currentUserParticipant?.role === "admin";

  const refreshConversations = async () => {
    try {
      const data = await getConversations();
      setConversations(data);
    } catch (err) {
      console.error("Failed to refresh conversations:", err);
    }
  };

  const handleAddMember = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!phone.trim()) return;

    setLoading(true);
    setError("");
    setMessage("");

    try {
      // 1. Search user
      const user = await searchUserByPhone(phone.trim());
      
      // 2. Check if already in conversation
      const alreadyMember = conversation.participants.some(
        (p) => p.user_id === user.id
      );
      if (alreadyMember) {
        setError("User is already in this group");
        setLoading(false);
        return;
      }

      // 3. Add user
      await addGroupMember(conversation.id, user.id);
      setMessage("Member added successfully!");
      setPhone("");
      await refreshConversations();
    } catch (err: any) {
      setError(err.message || "User not found or failed to add");
    } finally {
      setLoading(false);
    }
  };

  const handleRemoveMember = async (targetUserId: string) => {
    if (!confirm("Are you sure you want to remove this member?")) return;

    try {
      await removeGroupMember(conversation.id, targetUserId);
      await refreshConversations();
    } catch (err: any) {
      alert(err.message || "Failed to remove member");
    }
  };

  const handleToggleAdmin = async (targetParticipant: Participant) => {
    const nextRole = targetParticipant.role === "admin" ? "member" : "admin";
    try {
      await updateMemberRole(conversation.id, targetParticipant.user_id, nextRole);
      await refreshConversations();
    } catch (err: any) {
      alert(err.message || "Failed to update role");
    }
  };

  const handleLeaveGroup = async () => {
    if (!confirm("Are you sure you want to leave this group?")) return;

    try {
      await removeGroupMember(conversation.id, currentUserId!);
      await refreshConversations();
      onClose();
      navigate("/");
    } catch (err: any) {
      alert(err.message || "Failed to leave group");
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-dark-950/80 backdrop-blur-md"
        onClick={onClose}
      />

      {/* Modal Box */}
      <div className="relative w-full max-w-md bg-dark-900/95 border border-white/[0.08] rounded-3xl overflow-hidden shadow-2xl z-10 animate-fade-in">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-white/[0.06]">
          <div>
            <h3 className="text-base font-bold text-dark-50 truncate">
              {conversation.title || "Group Info"}
            </h3>
            <p className="text-xs text-dark-300">
              {conversation.participants.length} members
            </p>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full flex items-center justify-center bg-white/[0.04] hover:bg-white/[0.08] text-dark-200 hover:text-white transition-colors"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="p-6 max-h-[60vh] overflow-y-auto space-y-6">
          {/* Add member section (Admins only) */}
          {isCurrentUserAdmin && (
            <div className="space-y-3">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-nexus-400">
                Add member
              </h4>
              <form onSubmit={handleAddMember} className="flex gap-2">
                <input
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="Phone number (+91-XXXXXXXXXX)"
                  className="
                    flex-1 bg-dark-800/60 text-dark-50 placeholder-dark-400
                    px-4 py-2.5 rounded-xl border border-white/[0.06] text-sm
                    focus:outline-none focus:border-nexus-500/40 focus:ring-1 focus:ring-nexus-500/20
                    transition-all
                  "
                />
                <button
                  type="submit"
                  disabled={loading || !phone.trim()}
                  className="
                    px-4 py-2.5 rounded-xl bg-nexus-500 text-white text-sm font-semibold
                    hover:bg-nexus-400 transition-all active:scale-95
                    disabled:opacity-40 disabled:cursor-not-allowed
                  "
                >
                  {loading ? (
                    <span className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin inline-block" />
                  ) : (
                    "Add"
                  )}
                </button>
              </form>
              {error && (
                <p className="text-xs text-red-400 bg-red-500/10 px-3 py-1.5 rounded-lg">
                  {error}
                </p>
              )}
              {message && (
                <p className="text-xs text-nexus-400 bg-nexus-500/10 px-3 py-1.5 rounded-lg">
                  {message}
                </p>
              )}
            </div>
          )}

          {/* Members list */}
          <div className="space-y-3">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-dark-300">
              Group members
            </h4>
            <div className="space-y-2">
              {conversation.participants.map((p) => {
                const isSelf = p.user_id === currentUserId;
                const pInitial = (p.display_name || "M").charAt(0).toUpperCase();

                return (
                  <div
                    key={p.id}
                    className="flex items-center justify-between p-2.5 rounded-2xl bg-white/[0.02] border border-white/[0.04]"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      {/* Avatar */}
                      <div className="w-9 h-9 rounded-full bg-gradient-to-br from-dark-700 to-dark-800 flex items-center justify-center text-dark-200 font-semibold border border-white/[0.06] flex-shrink-0">
                        {p.avatar_url ? (
                          <img
                            src={p.avatar_url}
                            alt={p.display_name || "Member"}
                            className="w-full h-full rounded-full object-cover"
                          />
                        ) : (
                          pInitial
                        )}
                      </div>

                      {/* Info */}
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-dark-100 truncate">
                          {p.display_name || "Nexus User"}{" "}
                          {isSelf && <span className="text-[10px] text-nexus-400 font-normal ml-1">(You)</span>}
                        </p>
                        <p className="text-[10px] text-dark-400 capitalize">
                          {p.role}
                        </p>
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-1">
                      {isCurrentUserAdmin && !isSelf && (
                        <>
                          {/* Make/Remove Admin Toggle */}
                          <button
                            onClick={() => handleToggleAdmin(p)}
                            className={`
                              px-2 py-1 rounded-lg text-[10px] font-bold border transition-all active:scale-95
                              ${
                                p.role === "admin"
                                  ? "bg-amber-500/10 border-amber-500/20 text-amber-400 hover:bg-amber-500/25"
                                  : "bg-white/5 border-white/[0.06] text-dark-200 hover:bg-white/10 hover:text-white"
                              }
                            `}
                            title={p.role === "admin" ? "Demote from admin" : "Promote to admin"}
                          >
                            {p.role === "admin" ? "Demote" : "Make Admin"}
                          </button>

                          {/* Remove button */}
                          <button
                            onClick={() => handleRemoveMember(p.user_id)}
                            className="p-1.5 rounded-lg bg-red-500/10 border border-red-500/10 hover:border-red-500/20 text-red-400 hover:bg-red-500/25 transition-all active:scale-95"
                            title="Remove member"
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                              <polyline points="3 6 5 6 21 6" />
                              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                              <line x1="10" y1="11" x2="10" y2="17" />
                              <line x1="14" y1="11" x2="14" y2="17" />
                            </svg>
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Footer with Leave Group for members */}
        <div className="p-6 bg-white/[0.02] border-t border-white/[0.06] flex justify-end">
          <button
            onClick={handleLeaveGroup}
            className="w-full py-2.5 rounded-xl border border-red-500/30 bg-red-500/10 hover:bg-red-500/20 text-red-400 hover:text-red-300 text-sm font-semibold transition-all active:scale-98"
          >
            Leave Group
          </button>
        </div>
      </div>
    </div>
  );
}
