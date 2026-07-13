import { useState, useRef, useCallback, useEffect } from "react";
import { sendTypingEvent } from "../services/ws";
import { uploadMedia } from "../services/api";
import EmojiPicker, { Theme, EmojiClickData } from "emoji-picker-react";
import GifPicker from "./GifPicker";
import VoiceRecorder from "./VoiceRecorder";
import ReplyPreview from "./ReplyPreview";
import type { Message } from "../types";

interface MessageInputProps {
  conversationId: string;
  onSend: (
    content: string,
    type?: string,
    replyToMessageId?: string | null,
    mediaUrl?: string | null,
    fileNonce?: string | null,
    version?: string | null,
    algo?: string | null
  ) => void;
  replyTo: Message | null;
  onCancelReply: () => void;
}

export default function MessageInput({
  conversationId,
  onSend,
  replyTo,
  onCancelReply,
}: MessageInputProps) {
  const [text, setText] = useState("");
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [showGifPicker, setShowGifPicker] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [caption, setCaption] = useState("");
  const typingTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const emojiWrapperRef = useRef<HTMLDivElement>(null);
  const gifWrapperRef = useRef<HTMLDivElement>(null);

  // Close wrappers when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        emojiWrapperRef.current &&
        !emojiWrapperRef.current.contains(event.target as Node)
      ) {
        setShowEmojiPicker(false);
      }
      if (
        gifWrapperRef.current &&
        !gifWrapperRef.current.contains(event.target as Node)
      ) {
        setShowGifPicker(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  useEffect(() => {
    return () => {
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }
    };
  }, [previewUrl]);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      setText(e.target.value);

      // Throttled typing indicator
      if (!typingTimeout.current) {
        sendTypingEvent(conversationId);
        typingTimeout.current = setTimeout(() => {
          typingTimeout.current = null;
        }, 2000);
      }
    },
    [conversationId]
  );

  const handleSend = () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    onSend(trimmed, "text", replyTo?.id);
    setText("");
    onCancelReply();

    // Reset height of textarea
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const onEmojiClick = (emojiData: EmojiClickData) => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const cursorVal = text.substring(0, start) + emojiData.emoji + text.substring(end);
    setText(cursorVal);

    const newPos = start + emojiData.emoji.length;
    setTimeout(() => {
      textarea.focus();
      textarea.setSelectionRange(newPos, newPos);
    }, 0);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const url = URL.createObjectURL(file);
    setSelectedFile(file);
    setPreviewUrl(url);
    setCaption("");
    setShowEmojiPicker(false);
    setShowGifPicker(false);
  };

  const handleCancelUpload = () => {
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
    }
    setSelectedFile(null);
    setPreviewUrl(null);
    setCaption("");
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const getFileCategory = (file: File): string => {
    const mime = file.type;
    const ext = file.name.split(".").pop()?.toLowerCase();
    if (mime.startsWith("image/")) return "image";
    if (mime.startsWith("video/")) return "video";
    if (mime.startsWith("audio/")) return "audio";
    if (mime === "application/pdf" || ["doc", "docx", "xls", "xlsx", "ppt", "pptx", "txt", "csv", "rtf", "zip", "rar"].includes(ext || "")) {
      return "document";
    }
    return "document";
  };

  const handleConfirmUpload = async () => {
    if (!selectedFile) return;

    setUploading(true);
    try {
      const res = await uploadMedia(selectedFile, conversationId);
      
      const category = getFileCategory(selectedFile);
      const isE2EE = !!localStorage.getItem("nexus_device_id_str");
      const msgType = isE2EE ? "enc_" + category : category;

      // For E2EE media, content is the JSON envelope, otherwise caption
      const contentVal = isE2EE ? res.envelopeJson : caption.trim();

      onSend(
        contentVal || "",
        msgType,
        replyTo?.id,
        res.media_url,
        isE2EE ? res.fileNonce : undefined,
        isE2EE ? res.version : undefined,
        isE2EE ? res.algo : undefined
      );

      handleCancelUpload();
      onCancelReply();
    } catch (err: any) {
      alert(err.message || "Failed to upload file");
    } finally {
      setUploading(false);
    }
  };

  const handleGifSelect = (gifUrl: string) => {
    onSend(gifUrl, "image", replyTo?.id);
    setShowGifPicker(false);
    onCancelReply();
  };

  return (
    <div className="flex-shrink-0 p-3 md:p-4 glass border-x-0 border-b-0">
      <div className="max-w-4xl mx-auto flex flex-col">
        {/* Reply Preview */}
        {replyTo && (
          <ReplyPreview replyTo={replyTo} onCancel={onCancelReply} />
        )}

        {previewUrl ? (
          /* 📸 File Preview Card with Caption and Confirm/Cancel Buttons */
          <div className="bg-dark-800/90 rounded-2xl p-3 border border-white/[0.08] flex flex-col sm:flex-row gap-3 items-center animate-fade-in">
            {/* Thumbnail / File Icon */}
            <div className="relative w-24 h-20 rounded-xl overflow-hidden border border-white/[0.1] bg-dark-900 flex-shrink-0 flex items-center justify-center">
              {selectedFile?.type.startsWith("image/") ? (
                <img
                  src={previewUrl}
                  alt="Upload preview"
                  className="w-full h-full object-cover"
                />
              ) : selectedFile?.type.startsWith("video/") ? (
                <div className="flex flex-col items-center justify-center text-nexus-400">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polygon points="23 7 16 12 23 17 23 7" />
                    <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
                  </svg>
                  <span className="text-[9px] mt-1 truncate max-w-[80px] px-1">{selectedFile.name}</span>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center text-nexus-400 p-1 text-center">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                    <polyline points="14 2 14 8 20 8" />
                  </svg>
                  <span className="text-[9px] mt-1 truncate max-w-[80px] px-1">{selectedFile?.name}</span>
                </div>
              )}
              <button
                type="button"
                onClick={handleCancelUpload}
                className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/75 hover:bg-black text-white flex items-center justify-center transition-colors border border-white/10"
                title="Remove file"
              >
                ✕
              </button>
            </div>

            {/* Caption Input & Confirm Buttons */}
            <div className="flex-1 w-full flex flex-col sm:flex-row items-center gap-2">
              <input
                type="text"
                value={caption}
                onChange={(e) => setCaption(e.target.value)}
                placeholder="Add a caption..."
                className="
                  flex-1 bg-dark-700/60 text-dark-50 placeholder-dark-300
                  px-3.5 py-2.5 rounded-xl border border-white/[0.06]
                  focus:outline-none focus:border-nexus-500/40 focus:ring-1 focus:ring-nexus-500/20
                  text-sm transition-all w-full
                "
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleConfirmUpload();
                  }
                }}
                autoFocus
              />

              {/* Confirm / Cancel Buttons */}
              <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
                <button
                  type="button"
                  onClick={handleCancelUpload}
                  className="px-4 py-2.5 rounded-xl border border-white/[0.08] bg-dark-700/50 hover:bg-dark-600 text-dark-100 hover:text-white text-xs font-semibold transition-all active:scale-95 flex-1 sm:flex-initial"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleConfirmUpload}
                  disabled={uploading}
                  className="px-4 py-2.5 rounded-xl bg-nexus-500 hover:bg-nexus-400 text-white text-xs font-semibold transition-all active:scale-95 flex-1 sm:flex-initial flex items-center justify-center gap-1.5 shadow-lg shadow-nexus-500/20"
                >
                  {uploading ? (
                    <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  ) : (
                    "Send"
                  )}
                </button>
              </div>
            </div>
          </div>
        ) : isRecording ? (
          <VoiceRecorder
            onSend={async (file, duration) => {
              setIsRecording(false);
              setUploading(true);
              try {
                // Pass conversationId, duration and replyTo?.id to create the message
                await uploadMedia(file, conversationId, duration, replyTo?.id);
                onCancelReply();
              } catch (err: any) {
                alert(err.message || "Failed to upload audio");
              } finally {
                setUploading(false);
              }
            }}
            onCancel={() => setIsRecording(false)}
          />
        ) : (
          <div className="flex items-end gap-2 relative">
            {/* Attachment button */}
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center bg-dark-800/60 border border-white/[0.06] text-dark-300 hover:text-white hover:bg-white/[0.04] transition-all active:scale-95 disabled:opacity-50"
              title="Upload file"
            >
              {uploading ? (
                <span className="w-5 h-5 border-2 border-nexus-400/30 border-t-nexus-400 rounded-full animate-spin" />
              ) : (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
                </svg>
              )}
            </button>
            <input
              type="file"
              ref={fileInputRef}
              accept="image/*,video/*,audio/*,application/pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.zip,.rar"
              className="hidden"
              onChange={handleFileChange}
            />

            {/* Emoji Button */}
            <div className="relative" ref={emojiWrapperRef}>
              <button
                type="button"
                onClick={() => {
                  setShowEmojiPicker(!showEmojiPicker);
                  setShowGifPicker(false);
                }}
                className={`flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center border border-white/[0.06] transition-all active:scale-95 ${
                  showEmojiPicker
                    ? "bg-nexus-500/20 border-nexus-500/30 text-nexus-400"
                    : "bg-dark-800/60 text-dark-300 hover:text-white hover:bg-white/[0.04]"
                }`}
                title="Choose emoji"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10" />
                  <path d="M8 14s1.5 2 4 2 4-2 4-2" />
                  <line x1="9" y1="9" x2="9.01" y2="9" />
                  <line x1="15" y1="9" x2="15.01" y2="9" />
                </svg>
              </button>

              {showEmojiPicker && (
                <div className="absolute bottom-12 left-0 z-50 shadow-2xl rounded-2xl overflow-hidden border border-white/[0.08]">
                  <EmojiPicker
                    theme={Theme.DARK}
                    onEmojiClick={onEmojiClick}
                    skinTonesDisabled
                  />
                </div>
              )}
            </div>

            {/* GIF Button */}
            <div className="relative" ref={gifWrapperRef}>
              <button
                type="button"
                onClick={() => {
                  setShowGifPicker(!showGifPicker);
                  setShowEmojiPicker(false);
                }}
                className={`flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center border border-white/[0.06] transition-all active:scale-95 ${
                  showGifPicker
                    ? "bg-nexus-500/20 border-nexus-500/30 text-nexus-400"
                    : "bg-dark-800/60 text-dark-300 hover:text-white hover:bg-white/[0.04]"
                }`}
                title="Choose GIF"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                  <path d="M7 8h4v2H9v2h2v2H7z" />
                  <path d="M14 8h1v6h-1z" />
                  <path d="M18 8h-3v6h1v-2h2v-1-2V9h3z" />
                </svg>
              </button>

              {showGifPicker && (
                <GifPicker
                  onSelect={handleGifSelect}
                  onClose={() => setShowGifPicker(false)}
                />
              )}
            </div>

            {/* Text area */}
            <div className="flex-1 relative">
              <textarea
                ref={textareaRef}
                value={text}
                onChange={handleChange}
                onKeyDown={handleKeyDown}
                placeholder="Type a message…"
                rows={1}
                className="
                  w-full bg-dark-700/60 text-dark-50 placeholder-dark-300
                  px-4 py-2.5 rounded-2xl border border-white/[0.06]
                  focus:outline-none focus:border-nexus-500/40 focus:ring-1 focus:ring-nexus-500/20
                  resize-none text-sm leading-relaxed pr-3
                  transition-all
                "
                style={{ maxHeight: "120px" }}
                onInput={(e) => {
                  const target = e.target as HTMLTextAreaElement;
                  target.style.height = "auto";
                  target.style.height = `${Math.min(target.scrollHeight, 120)}px`;
                }}
              />
            </div>

            {/* Mic button (shown only when text is empty and not uploading) */}
            {!text.trim() && !uploading && (
              <button
                type="button"
                onClick={() => setIsRecording(true)}
                className="flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center bg-dark-800/60 border border-white/[0.06] text-dark-300 hover:text-white hover:bg-white/[0.04] transition-all active:scale-95"
                title="Record voice message"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                  <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                  <line x1="12" y1="19" x2="12" y2="23" />
                  <line x1="8" y1="23" x2="16" y2="23" />
                </svg>
              </button>
            )}

            {/* Send button (shown only when text has content) */}
            {text.trim() && (
              <button
                onClick={handleSend}
                className="flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center bg-nexus-500 text-white shadow-lg shadow-nexus-500/30 hover:bg-nexus-400 hover:shadow-nexus-500/50 hover:scale-105 active:scale-95 transition-all"
                title="Send message"
              >
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.0"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <line x1="22" y1="2" x2="11" y2="13" />
                  <polygon points="22 2 15 22 11 13 2 9 22 2" />
                </svg>
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
