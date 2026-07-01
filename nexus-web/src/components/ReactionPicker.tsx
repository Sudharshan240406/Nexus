interface ReactionPickerProps {
  onReact: (emoji: string) => void;
  onClose?: () => void;
}

const EMOJIS = ["👍", "❤️", "😂", "😮", "😢", "🙏"];

export default function ReactionPicker({ onReact, onClose }: ReactionPickerProps) {
  return (
    <div className="flex items-center gap-1 bg-dark-800/95 border border-white/[0.08] shadow-xl rounded-full px-2.5 py-1.5 backdrop-blur-md animate-scale-up">
      {EMOJIS.map((emoji) => (
        <button
          key={emoji}
          type="button"
          onClick={() => {
            onReact(emoji);
            onClose?.();
          }}
          className="text-lg hover:scale-125 hover:rotate-3 active:scale-95 transition-all duration-150 px-1 py-0.5 rounded-full hover:bg-white/[0.04]"
        >
          {emoji}
        </button>
      ))}
    </div>
  );
}
