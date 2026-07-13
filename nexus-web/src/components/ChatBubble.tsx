import { useState, useEffect, useRef } from "react";
import { format } from "date-fns";
import type { Message } from "../types";
import { useAuthStore } from "../stores/authStore";
import { useConversationStore } from "../stores/conversationStore";
import ReactionPicker from "./ReactionPicker";

interface ChatBubbleProps {
  message: Message;
  isGroup?: boolean;
  onReply: (msg: Message) => void;
  onReact: (emoji: string) => void;
  onEdit: (content: string) => void;
  onDelete: () => void;
  onForward: (msg: Message) => void;
  onPin: (msg: Message) => void;
}

function formatTime(dateStr: string | undefined | null): string {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return "";
  return format(d, "h:mm a");
}

function triggerDownload(url: string, filename: string) {
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

function CustomAudioPlayer({ url, duration }: { url: string; duration?: number | null }) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [totalDuration, setTotalDuration] = useState(duration || 0);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const progressRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const audio = new Audio(url);
    audioRef.current = audio;

    const onTimeUpdate = () => {
      setCurrentTime(audio.currentTime);
    };

    const onLoadedMetadata = () => {
      if (audio.duration && !isNaN(audio.duration) && audio.duration !== Infinity) {
        setTotalDuration(audio.duration);
      }
    };

    const onEnded = () => {
      setIsPlaying(false);
      setCurrentTime(0);
    };

    audio.addEventListener("timeupdate", onTimeUpdate);
    audio.addEventListener("loadedmetadata", onLoadedMetadata);
    audio.addEventListener("ended", onEnded);

    return () => {
      audio.pause();
      audio.removeEventListener("timeupdate", onTimeUpdate);
      audio.removeEventListener("loadedmetadata", onLoadedMetadata);
      audio.removeEventListener("ended", onEnded);
    };
  }, [url]);

  const togglePlay = () => {
    if (!audioRef.current) return;
    if (isPlaying) {
      audioRef.current.pause();
      setIsPlaying(false);
    } else {
      audioRef.current.play().catch(console.error);
      setIsPlaying(true);
    }
  };

  const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!audioRef.current || !progressRef.current || !totalDuration) return;
    const rect = progressRef.current.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const percentage = Math.max(0, Math.min(1, clickX / rect.width));
    audioRef.current.currentTime = percentage * totalDuration;
    setCurrentTime(audioRef.current.currentTime);
  };

  const formatPlaybackTime = (time: number) => {
    if (isNaN(time)) return "0:00";
    const mins = Math.floor(time / 60);
    const secs = Math.floor(time % 60);
    return `${mins}:${secs < 10 ? "0" : ""}${secs}`;
  };

  const handleDownload = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      const response = await fetch(url);
      const blob = await response.blob();
      const blobUrl = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = blobUrl;
      link.download = url.split("/").pop() || "voice_note.webm";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (err) {
      console.error("Failed to download audio", err);
    }
  };

  return (
    <div 
      className="flex items-center gap-3 bg-white/[0.04] hover:bg-white/[0.08] p-3 rounded-2xl border border-white/[0.06] transition-all cursor-pointer w-64 max-w-full"
      onClick={togglePlay}
    >
      <button 
        type="button" 
        className="w-10 h-10 rounded-full bg-nexus-500 hover:bg-nexus-400 flex items-center justify-center text-white shadow-md active:scale-95 transition-all flex-shrink-0"
      >
        {isPlaying ? (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
            <rect x="6" y="4" width="4" height="16" rx="1" />
            <rect x="14" y="4" width="4" height="16" rx="1" />
          </svg>
        ) : (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" className="ml-0.5">
            <path d="M8 5v14l11-7z" />
          </svg>
        )}
      </button>

      <div className="flex-1 flex flex-col gap-1.5 min-w-0" onClick={(e) => e.stopPropagation()}>
        {/* Playback Seek Bar */}
        <div 
          ref={progressRef}
          className="h-1.5 bg-dark-600 rounded-full overflow-hidden cursor-pointer relative"
          onClick={handleSeek}
        >
          <div 
            className="h-full bg-nexus-400"
            style={{ width: `${(currentTime / totalDuration) * 100}%` }}
          />
        </div>

        <div className="flex justify-between items-center text-[10px] text-dark-300">
          <span>{formatPlaybackTime(currentTime)} / {formatPlaybackTime(totalDuration)}</span>
          <button 
            type="button" 
            onClick={handleDownload} 
            className="hover:text-white transition-colors"
            title="Download voice note"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}

export default function ChatBubble({
  message,
  isGroup,
  onReply,
  onReact,
  onEdit,
  onDelete,
  onForward,
  onPin,
}: ChatBubbleProps) {
  const userId = useAuthStore((s) => s.userId);
  const isSent = message.sender_id === userId;

  const [isLightboxOpen, setIsLightboxOpen] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editVal, setEditVal] = useState(message.content || "");
  const [showReactionPicker, setShowReactionPicker] = useState(false);

  const [decryptedUrl, setDecryptedUrl] = useState<string>("");
  const [loadingMedia, setLoadingMedia] = useState(false);
  const [mediaError, setMediaError] = useState<string>("");
  const decryptedUrlRef = useRef<string>("");

  useEffect(() => {
    const isE2EEMedia = ["enc_image", "enc_audio", "enc_video", "enc_document"].includes(message.message_type);
    if (!isE2EEMedia || !message.media_url) return;

    if (!message.decrypted_key) {
      setMediaError("Missing session keys");
      return;
    }

    let active = true;
    setLoadingMedia(true);
    setMediaError("");

    const decrypt = async () => {
      try {
        const { downloadAndDecryptFile } = await import("../services/api");
        const url = await downloadAndDecryptFile(
          message.media_url || "",
          message.decrypted_key || "",
          message.file_nonce || "",
          message.decrypted_algo || "AES-GCM-256",
          message.mime_type || "application/octet-stream"
        );
        if (active) {
          if (decryptedUrlRef.current) {
            URL.revokeObjectURL(decryptedUrlRef.current);
          }
          decryptedUrlRef.current = url;
          setDecryptedUrl(url);
        }
      } catch (err: any) {
        console.error("Failed to decrypt attachment:", err);
        if (active) {
          setMediaError("Failed to decrypt attachment");
        }
      } finally {
        if (active) {
          setLoadingMedia(false);
        }
      }
    };

    decrypt();

    return () => {
      active = false;
    };
  }, [message.id, message.media_url, message.decrypted_key]);

  useEffect(() => {
    return () => {
      if (decryptedUrlRef.current) {
        URL.revokeObjectURL(decryptedUrlRef.current);
      }
    };
  }, []);

  // Retrieve values from Zustand store
  const conversation = useConversationStore((s) =>
    s.conversations.find((c) => c.id === message.conversation_id)
  );
  const messages = useConversationStore((s) =>
    s.messagesByConversation[message.conversation_id] || []
  );
  const onlineUsers = useConversationStore((s) => s.onlineUsers);

  const BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:8000";

  const imageUrl = message.media_url || message.content;
  const fullImageUrl = imageUrl
    ? imageUrl.startsWith("http")
      ? imageUrl
      : `${BASE_URL}${imageUrl}`
    : "";

  const audioUrl = message.media_url || message.content;
  const fullAudioUrl = audioUrl
    ? audioUrl.startsWith("http")
      ? audioUrl
      : `${BASE_URL}${audioUrl}`
    : "";

  useEffect(() => {
    if (!isLightboxOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setIsLightboxOpen(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isLightboxOpen]);

  const onScrollToReply = () => {
    if (!message.reply_to_message_id) return;
    const element = document.getElementById(`msg-${message.reply_to_message_id}`);
    if (element) {
      element.scrollIntoView({ behavior: "smooth", block: "center" });
      element.classList.add("bg-nexus-500/20", "rounded-2xl");
      setTimeout(() => {
        element.classList.remove("bg-nexus-500/20", "rounded-2xl");
      }, 1200);
    }
  };

  const handleEditSubmit = () => {
    const trimmed = editVal.trim();
    if (!trimmed) return;
    onEdit(trimmed);
    setIsEditing(false);
  };

  const renderTicks = () => {
    if (!isSent) return null;

    if (message.status === "read") {
      return (
        <span className="text-nexus-400 font-bold leading-none flex items-center select-none" title="Read">
          ✓✓
        </span>
      );
    }

    if (message.status === "delivered") {
      return (
        <span className="text-dark-300 opacity-70 leading-none flex items-center select-none" title="Delivered">
          ✓✓
        </span>
      );
    }

    return (
      <span className="text-dark-300 opacity-40 leading-none flex items-center select-none" title="Sent">
        ✓
      </span>
    );
  };

  return (
    <div
      id={`msg-${message.id}`}
      className={`flex animate-slide-up ${
        isSent ? "justify-end" : "justify-start"
      } mb-2.5 px-4 sm:px-12 group relative transition-all duration-300`}
    >
      <div
        className={`
          relative max-w-[80%] sm:max-w-[65%] px-3.5 py-2.5 rounded-2xl shadow-sm
          ${
            isSent
              ? "bg-nexus-800 text-nexus-50 bubble-sent"
              : "bg-dark-600 text-dark-50 bubble-received"
          }
          ${message.is_deleted ? "bg-dark-800/40 text-dark-300 border border-white/[0.04]" : ""}
        `}
      >
        {/* Forwarded Header */}
        {!message.is_deleted && message.is_forwarded && (
          <div className="flex items-center gap-1 text-[10px] text-nexus-400 opacity-90 mb-1 select-none font-medium italic">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 3 21 3 21 9" />
              <path d="M18 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h5" />
              <line x1="10" y1="14" x2="21" y2="3" />
            </svg>
            <span>Forwarded {message.forwarded_from ? `from ${message.forwarded_from}` : ""}</span>
          </div>
        )}

        {/* Quoted Reply Block */}
        {!message.is_deleted && message.reply_to_preview && (
          <div
            onClick={onScrollToReply}
            className="bg-white/5 border-l-[3px] border-nexus-500 pl-2.5 pr-2 py-1 rounded-r-xl mb-2 text-xs cursor-pointer hover:bg-white/10 transition-colors select-none"
          >
            <div className="font-semibold text-nexus-400 mb-0.5 truncate text-[11px]">
              {message.reply_to_preview.sender_name || "User"}
            </div>
            <div className="text-dark-200 truncate leading-tight text-[11.5px]">
              {message.reply_to_preview.message_type === "image"
                ? "📷 Photo"
                : message.reply_to_preview.message_type === "audio"
                ? "🎵 Voice Message"
                : message.reply_to_preview.message_type === "gif"
                ? "🎬 GIF"
                : message.reply_to_preview.content}
            </div>
          </div>
        )}

        {/* Sender Name for Group Chats */}
        {!isSent && isGroup && message.sender_name && !message.reply_to_preview && (
          <div className="text-[11px] font-semibold text-nexus-400 mb-1 leading-none select-none">
            {message.sender_name}
          </div>
        )}

        {/* Content */}
        {message.is_deleted ? (
          <p className="text-[13.5px] italic text-dark-300 opacity-60 leading-relaxed py-0.5">
            This message was deleted
          </p>
        ) : isEditing ? (
          <div className="flex flex-col gap-2 w-56 sm:w-64">
            <textarea
              value={editVal}
              onChange={(e) => setEditVal(e.target.value)}
              className="bg-dark-700/80 text-white border border-white/10 rounded-xl p-2 text-sm w-full focus:outline-none focus:border-nexus-500/50 resize-none leading-relaxed"
              rows={2}
            />
            <div className="flex justify-end gap-1.5">
              <button
                type="button"
                onClick={() => {
                  setIsEditing(false);
                  setEditVal(message.content || "");
                }}
                className="px-2.5 py-1 rounded-lg text-xs bg-dark-500 text-dark-100 hover:text-white transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleEditSubmit}
                className="px-2.5 py-1 rounded-lg text-xs bg-nexus-500 text-white hover:bg-nexus-400 transition-colors font-medium"
              >
                Save
              </button>
            </div>
          </div>
        ) : (message.message_type === "image" || message.message_type === "enc_image") ? (
          <div className="mt-0.5 flex flex-col gap-1.5">
            {message.message_type === "enc_image" && loadingMedia ? (
              <div className="flex items-center justify-center w-40 h-32 bg-dark-700/30 rounded-xl">
                <span className="w-5 h-5 border-2 border-nexus-500/35 border-t-nexus-500 rounded-full animate-spin" />
              </div>
            ) : message.message_type === "enc_image" && mediaError ? (
              <div className="flex items-center gap-2 p-3 bg-red-950/20 text-red-400 rounded-xl border border-red-500/20 text-xs">
                <span>🔒 {mediaError}</span>
              </div>
            ) : (
              <img
                src={message.message_type === "enc_image" ? decryptedUrl : fullImageUrl}
                alt="Sent image"
                onClick={() => setIsLightboxOpen(true)}
                className="rounded-xl max-w-[240px] max-h-[200px] object-cover cursor-pointer hover:brightness-95 hover:scale-[1.01] active:scale-98 transition-all border border-white/[0.06] shadow-md"
              />
            )}
            {message.content && (
              <p className="text-[14.5px] leading-relaxed break-words whitespace-pre-wrap px-0.5 py-0.5">
                {message.content}
              </p>
            )}
          </div>
        ) : (message.message_type === "audio" || message.message_type === "enc_audio") ? (
          <div className="mt-1">
            {message.message_type === "enc_audio" && loadingMedia ? (
              <div className="flex items-center gap-2 p-3 bg-dark-700/30 rounded-2xl w-64 max-w-full">
                <span className="w-4 h-4 border-2 border-nexus-400/30 border-t-nexus-400 rounded-full animate-spin" />
                <span className="text-xs text-dark-300">Decrypting voice note…</span>
              </div>
            ) : message.message_type === "enc_audio" && mediaError ? (
              <div className="flex items-center gap-2 p-3 bg-red-950/20 text-red-400 rounded-xl border border-red-500/20 text-xs">
                <span>🔒 {mediaError}</span>
              </div>
            ) : (
              <CustomAudioPlayer url={message.message_type === "enc_audio" ? decryptedUrl : fullAudioUrl} duration={message.duration} />
            )}
          </div>
        ) : (message.message_type === "video" || message.message_type === "enc_video") ? (
          <div className="mt-1 max-w-[320px]">
            {message.message_type === "enc_video" && loadingMedia ? (
              <div className="flex items-center justify-center w-56 h-36 bg-dark-700/30 rounded-xl">
                <span className="w-5 h-5 border-2 border-nexus-500/35 border-t-nexus-500 rounded-full animate-spin" />
              </div>
            ) : message.message_type === "enc_video" && mediaError ? (
              <div className="flex items-center gap-2 p-3 bg-red-950/20 text-red-400 rounded-xl border border-red-500/20 text-xs">
                <span>🔒 {mediaError}</span>
              </div>
            ) : (
              <video
                src={message.message_type === "enc_video" ? decryptedUrl : (message.media_url ? (message.media_url.startsWith("http") ? message.media_url : `${BASE_URL}${message.media_url}`) : "")}
                controls
                className="rounded-xl w-full border border-white/[0.06] shadow-md max-h-[240px]"
              />
            )}
            {message.content && (
              <p className="text-[14.5px] leading-relaxed break-words whitespace-pre-wrap px-0.5 mt-1.5">
                {message.content}
              </p>
            )}
          </div>
        ) : (message.message_type === "document" || message.message_type === "enc_document" || message.message_type === "pdf" || message.message_type === "enc_pdf") ? (
          <div className="mt-1 flex flex-col gap-1 w-64 max-w-full">
            {loadingMedia && message.message_type.startsWith("enc_") ? (
              <div className="flex items-center gap-2 p-3 bg-dark-700/30 rounded-2xl w-full">
                <span className="w-4 h-4 border-2 border-nexus-400/30 border-t-nexus-400 rounded-full animate-spin" />
                <span className="text-xs text-dark-300">Decrypting document…</span>
              </div>
            ) : mediaError && message.message_type.startsWith("enc_") ? (
              <div className="flex items-center gap-2 p-3 bg-red-950/20 text-red-400 rounded-xl border border-red-500/20 text-xs">
                <span>🔒 {mediaError}</span>
              </div>
            ) : (
              <div className="flex items-center gap-3 bg-white/[0.04] hover:bg-white/[0.08] p-3 rounded-2xl border border-white/[0.06] transition-all">
                <div className="w-10 h-10 rounded-xl bg-nexus-500/10 flex items-center justify-center text-nexus-400 flex-shrink-0">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                    <polyline points="14 2 14 8 20 8" />
                  </svg>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-white truncate" title={message.file_name || "Attachment"}>
                    {message.file_name || "Attachment"}
                  </p>
                  <p className="text-[10px] text-dark-300">
                    {message.file_size ? `${(message.file_size / 1024).toFixed(1)} KB` : "Document"} {message.mime_type ? `• ${message.mime_type.split("/")[1] || ""}`.toUpperCase() : ""}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    const url = message.message_type.startsWith("enc_") ? decryptedUrl : (message.media_url ? (message.media_url.startsWith("http") ? message.media_url : `${BASE_URL}${message.media_url}`) : "");
                    if (url) triggerDownload(url, message.file_name || "attachment");
                  }}
                  className="w-8 h-8 rounded-lg bg-white/5 hover:bg-white/10 flex items-center justify-center text-dark-200 hover:text-white transition-all active:scale-95 flex-shrink-0"
                  title="Download attachment"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="7 10 12 15 17 10" />
                    <line x1="12" y1="15" x2="12" y2="3" />
                  </svg>
                </button>
              </div>
            )}
            {message.content && (
              <p className="text-[14.5px] leading-relaxed break-words whitespace-pre-wrap px-0.5 mt-1.5">
                {message.content}
              </p>
            )}
          </div>
        ) : (
          message.content && (
            <p className="text-[14.5px] leading-relaxed break-words whitespace-pre-wrap py-0.5">
              {message.content}
            </p>
          )
        )}

        {/* Timestamp + Status */}
        <div
          className={`flex items-center gap-1.5 mt-1 ${
            isSent ? "justify-end" : "justify-start"
          }`}
        >
          <span className="text-[10px] text-dark-200 opacity-60">
            {formatTime(message.created_at)}
          </span>
          {!message.is_deleted && message.is_edited && (
            <span className="text-[9px] text-dark-300 opacity-50 italic">
              (edited)
            </span>
          )}
          {!message.is_deleted && message.is_pinned && (
            <span className="text-[10px] text-nexus-400 leading-none flex items-center select-none" title="Pinned">
              📌
            </span>
          )}
          {renderTicks()}
        </div>

        {/* Reactions List */}
        {!message.is_deleted && message.reactions && message.reactions.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-2 border-t border-white/[0.05] pt-1.5">
            {message.reactions.map((r) => {
              const hasReacted = r.user_ids.includes(userId || "");
              return (
                <button
                  key={r.emoji}
                  type="button"
                  onClick={() => onReact(r.emoji)}
                  className={`
                    flex items-center gap-1 px-2 py-0.5 rounded-full text-xs transition-all duration-200 border
                    ${
                      hasReacted
                        ? "bg-nexus-500/20 text-nexus-300 border-nexus-500/40 font-medium"
                        : "bg-white/[0.03] text-dark-200 border-white/[0.04] hover:bg-white/[0.06]"
                    }
                  `}
                >
                  <span className="text-xs leading-none">{r.emoji}</span>
                  {r.count > 1 && (
                    <span className="text-[9.5px] opacity-75">{r.count}</span>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Hover action toolbar */}
      {!message.is_deleted && !isEditing && (
        <div
          className={`
            absolute top-1/2 -translate-y-1/2 z-10 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity duration-200
            ${isSent ? "left-0 pl-1 sm:pl-3" : "right-0 pr-1 sm:pr-3"}
          `}
        >
          {/* Reaction Button */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setShowReactionPicker(!showReactionPicker)}
              className="w-7 h-7 rounded-full flex items-center justify-center bg-dark-800 border border-white/[0.08] text-dark-200 hover:text-white hover:bg-dark-700 transition-colors"
              title="React"
            >
              😊
            </button>
            {showReactionPicker && (
              <div
                className={`absolute bottom-8 z-50 ${
                  isSent ? "left-0" : "right-0"
                }`}
              >
                <ReactionPicker
                  onReact={onReact}
                  onClose={() => setShowReactionPicker(false)}
                />
              </div>
            )}
          </div>

          {/* Reply */}
          <button
            type="button"
            onClick={() => onReply(message)}
            className="w-7 h-7 rounded-full flex items-center justify-center bg-dark-800 border border-white/[0.08] text-dark-200 hover:text-white hover:bg-dark-700 transition-colors"
            title="Reply"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="9 17 4 12 9 7" />
              <path d="M20 18v-2a4 4 0 0 0-4-4H4" />
            </svg>
          </button>

          {/* Forward */}
          <button
            type="button"
            onClick={() => onForward(message)}
            className="w-7 h-7 rounded-full flex items-center justify-center bg-dark-800 border border-white/[0.08] text-dark-200 hover:text-white hover:bg-dark-700 transition-colors"
            title="Forward"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="17 11 22 16 17 21" />
              <path d="M21 16H9a4 4 0 0 1-4-4V3" />
            </svg>
          </button>

          {/* Pin / Unpin */}
          <button
            type="button"
            onClick={() => onPin(message)}
            className={`w-7 h-7 rounded-full flex items-center justify-center bg-dark-800 border border-white/[0.08] hover:bg-dark-700 transition-colors ${message.is_pinned ? "text-nexus-400" : "text-dark-200 hover:text-white"}`}
            title={message.is_pinned ? "Unpin message" : "Pin message"}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 17v5M5 12h14M19 12l-4-8H9l-4 8" />
            </svg>
          </button>

          {/* Edit (own text messages only) */}
          {isSent && message.message_type === "text" && (
            <button
              type="button"
              onClick={() => {
                setIsEditing(true);
                setEditVal(message.content || "");
              }}
              className="w-7 h-7 rounded-full flex items-center justify-center bg-dark-800 border border-white/[0.08] text-dark-200 hover:text-white hover:bg-dark-700 transition-colors"
              title="Edit"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 20h9" />
                <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
              </svg>
            </button>
          )}

          {/* Delete */}
          {isSent && (
            <button
              type="button"
              onClick={onDelete}
              className="w-7 h-7 rounded-full flex items-center justify-center bg-dark-800 border border-white/[0.08] text-red-400 hover:text-red-300 hover:bg-dark-700 transition-colors"
              title="Delete"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
              </svg>
            </button>
          )}
        </div>
      )}

      {/* Lightbox Modal */}
      {isLightboxOpen && (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/90 backdrop-blur-md"
            onClick={() => setIsLightboxOpen(false)}
          />
          <button
            onClick={() => setIsLightboxOpen(false)}
            className="absolute top-4 right-4 z-10 w-10 h-10 rounded-full flex items-center justify-center bg-white/10 hover:bg-white/20 text-white transition-colors border border-white/[0.08]"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
          <img
            src={message.message_type === "enc_image" ? decryptedUrl : fullImageUrl}
            alt="Enlarged view"
            className="relative z-10 max-w-[90%] max-h-[85vh] object-contain rounded-2xl shadow-2xl border border-white/10"
          />
        </div>
      )}
    </div>
  );
}
