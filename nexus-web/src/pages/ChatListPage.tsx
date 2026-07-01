import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { getConversations, createConversation, searchUserByPhone } from "../services/api";
import { useConversationStore } from "../stores/conversationStore";
import { useAuthStore } from "../stores/authStore";
import ConversationItem from "../components/ConversationItem";
import SearchContacts from "../components/SearchContacts";
import CreateGroupModal from "../components/CreateGroupModal";

export default function ChatListPage() {
  const navigate = useNavigate();
  const { conversationId } = useParams();
  const conversations = useConversationStore((s) => s.conversations);
  const setConversations = useConversationStore((s) => s.setConversations);
  const setActiveConversation = useConversationStore((s) => s.setActiveConversation);
  const userId = useAuthStore((s) => s.userId);
  const [loading, setLoading] = useState(true);
  const [searchLoading, setSearchLoading] = useState(false);
  const [isGroupModalOpen, setIsGroupModalOpen] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    loadConversations();
    // Clear active conversation when viewing the list
    setActiveConversation(null);
  }, []);

  async function loadConversations() {
    try {
      const data = await getConversations();
      setConversations(data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleStartChat(phone: string) {
    if (!userId) return;
    setSearchLoading(true);

    try {
      // Look up user by phone first
      const otherUser = await searchUserByPhone(phone);

      // Create or get conversation using the found user's UUID
      const conv = await createConversation({
        is_group: false,
        participant_ids: [otherUser.id],
      });

      // Add to store if not present
      useConversationStore.getState().addConversation(conv);
      navigate(`/chat/${conv.id}`);
    } catch (err: any) {
      alert(err.message || "No Nexus user with that number");
    } finally {
      setSearchLoading(false);
    }
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex-shrink-0 px-4 md:px-6 py-4 flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-dark-50">Chats</h2>
          <p className="text-xs text-dark-300 mt-0.5">
            {conversations.length} conversation{conversations.length !== 1 ? "s" : ""}
          </p>
        </div>

        <div className="flex items-center gap-2">
          {/* New Group Button */}
          <button
            onClick={() => setIsGroupModalOpen(true)}
            className="
              w-10 h-10 rounded-xl flex items-center justify-center
              bg-emerald-500/15 text-emerald-400
              hover:bg-emerald-500/25 hover:text-emerald-300
              transition-all active:scale-95
            "
            title="New Group"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
              <circle cx="9" cy="7" r="4" />
              <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
              <path d="M16 3.13a4 4 0 0 1 0 7.75" />
            </svg>
          </button>
          
          <SearchContacts onStartChat={handleStartChat} isLoading={searchLoading} />
        </div>
      </div>

      {/* Conversation List */}
      <div className="flex-1 overflow-y-auto px-2 md:px-4 pb-4">
        {loading ? (
          <div className="flex items-center justify-center h-40">
            <span className="w-6 h-6 border-2 border-nexus-500/30 border-t-nexus-500 rounded-full animate-spin" />
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center h-40 gap-3">
            <p className="text-red-400 text-sm">{error}</p>
            <button
              onClick={loadConversations}
              className="text-xs text-nexus-400 hover:text-nexus-300 transition-colors"
            >
              Try again
            </button>
          </div>
        ) : conversations.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-60 gap-3">
            <div className="w-16 h-16 rounded-2xl bg-dark-700/50 flex items-center justify-center">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-dark-300">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
            </div>
            <p className="text-dark-300 text-sm">No conversations yet</p>
            <p className="text-dark-400 text-xs">
              Tap the + button to start a new chat
            </p>
          </div>
        ) : (
          <div className="space-y-1">
            {conversations.map((conv) => (
              <ConversationItem
                key={conv.id}
                conversation={conv}
                isActive={conversationId === conv.id}
                onClick={() => navigate(`/chat/${conv.id}`)}
              />
            ))}
          </div>
        )}
      </div>

      <CreateGroupModal
        isOpen={isGroupModalOpen}
        onClose={() => setIsGroupModalOpen(false)}
      />
    </div>
  );
}
