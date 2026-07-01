import type { Message } from "../types";

interface ReplyPreviewProps {
  replyTo: Message | null;
  onCancel: () => void;
}

export default function ReplyPreview({ replyTo, onCancel }: ReplyPreviewProps) {
  if (!replyTo) return null;

  const isImage = replyTo.message_type === "image";
  const isAudio = replyTo.message_type === "audio";
  const isGif = replyTo.message_type === "gif";

  let previewText = replyTo.content || "";
  if (isImage) previewText = "📷 Photo";
  else if (isAudio) previewText = "🎵 Voice Message";
  else if (isGif) previewText = "🎬 GIF";

  return (
    <div className="flex items-center justify-between bg-dark-800/80 border border-white/[0.06] border-b-0 rounded-t-2xl px-4 py-2.5 animate-slide-up">
      <div className="flex flex-col border-l-2 border-nexus-500 pl-3 overflow-hidden">
        <span className="text-xs font-semibold text-nexus-400">
          Replying to {replyTo.sender_name || "User"}
        </span>
        <span className="text-xs text-dark-200 truncate max-w-[200px] sm:max-w-[400px]">
          {previewText}
        </span>
      </div>

      <button
        type="button"
        onClick={onCancel}
        className="w-6 h-6 rounded-full flex items-center justify-center bg-white/5 hover:bg-white/10 text-dark-300 hover:text-white transition-colors"
        title="Cancel reply"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
    </div>
  );
}
