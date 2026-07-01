export default function TypingIndicator() {
  return (
    <div className="flex items-center gap-1.5 px-4 py-2 animate-fade-in">
      <div className="flex items-center gap-1 bg-dark-600 rounded-2xl px-3.5 py-2.5 rounded-bl">
        <span className="typing-dot w-2 h-2 rounded-full bg-dark-200" />
        <span className="typing-dot w-2 h-2 rounded-full bg-dark-200" />
        <span className="typing-dot w-2 h-2 rounded-full bg-dark-200" />
      </div>
    </div>
  );
}
