import { useState, useEffect, useRef } from "react";

interface VoiceRecorderProps {
  onSend: (file: File, duration: number) => void;
  onCancel: () => void;
}

export default function VoiceRecorder({ onSend, onCancel }: VoiceRecorderProps) {
  const [isRecording, setIsRecording] = useState(false);
  const [duration, setDuration] = useState(0);
  const [recordedFile, setRecordedFile] = useState<File | null>(null);
  
  // Preview state
  const [previewAudio, setPreviewAudio] = useState<HTMLAudioElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [previewCurrentTime, setPreviewCurrentTime] = useState(0);
  const [previewDuration, setPreviewDuration] = useState(0);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const progressRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    startRecording();
    return () => {
      stopRecordingStream();
      cleanupPreview();
    };
  }, []);

  const cleanupPreview = () => {
    if (previewAudio) {
      previewAudio.pause();
      previewAudio.src = "";
    }
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioChunksRef.current = [];

      let options = {};
      let extension = "webm";
      if (MediaRecorder.isTypeSupported("audio/webm;codecs=opus")) {
        options = { mimeType: "audio/webm;codecs=opus" };
        extension = "webm";
      } else if (MediaRecorder.isTypeSupported("audio/webm")) {
        options = { mimeType: "audio/webm" };
        extension = "webm";
      } else if (MediaRecorder.isTypeSupported("audio/ogg;codecs=opus")) {
        options = { mimeType: "audio/ogg;codecs=opus" };
        extension = "ogg";
      } else if (MediaRecorder.isTypeSupported("audio/mp4")) {
        options = { mimeType: "audio/mp4" };
        extension = "mp4";
      }

      const mediaRecorder = new MediaRecorder(stream, options);
      mediaRecorderRef.current = mediaRecorder;

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = () => {
        const audioBlob = new Blob(audioChunksRef.current, {
          type: mediaRecorder.mimeType || "audio/webm",
        });
        const file = new File([audioBlob], `voice_${Date.now()}.${extension}`, {
          type: audioBlob.type,
        });

        setRecordedFile(file);
        
        // Setup preview audio element
        const url = URL.createObjectURL(audioBlob);
        const audio = new Audio(url);
        
        audio.ontimeupdate = () => {
          setPreviewCurrentTime(audio.currentTime);
        };
        audio.onloadedmetadata = () => {
          if (audio.duration && !isNaN(audio.duration) && audio.duration !== Infinity) {
            setPreviewDuration(audio.duration);
          } else {
            setPreviewDuration(duration);
          }
        };
        audio.onended = () => {
          setIsPlaying(false);
          setPreviewCurrentTime(0);
        };

        setPreviewAudio(audio);
        stream.getTracks().forEach((track) => track.stop());
      };

      mediaRecorder.start();
      setIsRecording(true);

      timerRef.current = setInterval(() => {
        setDuration((prev) => prev + 1);
      }, 1000);
    } catch (err) {
      console.error("Microphone access denied or error:", err);
      alert("Could not access microphone. Please check browser permissions.");
      onCancel();
    }
  };

  const stopRecordingStream = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (
      mediaRecorderRef.current &&
      mediaRecorderRef.current.state !== "inactive"
    ) {
      mediaRecorderRef.current.stop();
    }
    setIsRecording(false);
  };

  const handleStopRecording = () => {
    stopRecordingStream();
  };

  const handleCancel = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (mediaRecorderRef.current) {
      mediaRecorderRef.current.onstop = null;
      if (mediaRecorderRef.current.state !== "inactive") {
        mediaRecorderRef.current.stop();
      }
      if (mediaRecorderRef.current.stream) {
        mediaRecorderRef.current.stream.getTracks().forEach((track) => track.stop());
      }
    }
    cleanupPreview();
    onCancel();
  };

  const handleSend = () => {
    if (recordedFile) {
      const finalDuration = previewDuration || duration || 1;
      cleanupPreview();
      onSend(recordedFile, finalDuration);
    }
  };

  const togglePlayPreview = () => {
    if (!previewAudio) return;
    if (isPlaying) {
      previewAudio.pause();
      setIsPlaying(false);
    } else {
      previewAudio.play().catch(console.error);
      setIsPlaying(true);
    }
  };

  const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!previewAudio || !progressRef.current || !previewDuration) return;
    const rect = progressRef.current.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const percentage = Math.max(0, Math.min(1, clickX / rect.width));
    previewAudio.currentTime = percentage * previewDuration;
    setPreviewCurrentTime(previewAudio.currentTime);
  };

  const formatDuration = (secs: number) => {
    const mins = Math.floor(secs / 60);
    const remainingSecs = Math.floor(secs % 60);
    return `${mins}:${remainingSecs < 10 ? "0" : ""}${remainingSecs}`;
  };

  if (recordedFile) {
    // ── Preview Render State ─────────────────────────────────────────────────
    return (
      <div className="flex items-center justify-between w-full bg-dark-700/80 border border-white/[0.06] rounded-2xl px-4 py-2 animate-fade-in">
        <div className="flex items-center gap-3 flex-1 mr-4">
          {/* Play/Pause */}
          <button
            type="button"
            onClick={togglePlayPreview}
            className="w-9 h-9 rounded-full flex items-center justify-center bg-nexus-500 hover:bg-nexus-400 text-white shadow-md active:scale-95 transition-all"
            title={isPlaying ? "Pause preview" : "Play preview"}
          >
            {isPlaying ? (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                <rect x="6" y="4" width="4" height="16" rx="1" />
                <rect x="14" y="4" width="4" height="16" rx="1" />
              </svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" className="ml-0.5">
                <path d="M8 5v14l11-7z" />
              </svg>
            )}
          </button>

          {/* Progress / Seek bar */}
          <div className="flex-1 flex flex-col gap-1">
            <div 
              ref={progressRef}
              onClick={handleSeek}
              className="h-1.5 bg-dark-600 rounded-full overflow-hidden cursor-pointer relative"
            >
              <div 
                className="h-full bg-nexus-400"
                style={{ width: `${(previewCurrentTime / (previewDuration || 1)) * 100}%` }}
              />
            </div>
            <div className="text-[10px] text-dark-300">
              <span>{formatDuration(previewCurrentTime)} / {formatDuration(previewDuration || duration)}</span>
            </div>
          </div>
        </div>

        {/* Send / Discard */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleCancel}
            className="w-9 h-9 rounded-full flex items-center justify-center bg-dark-600 text-red-400 hover:bg-red-500/10 transition-all active:scale-95"
            title="Discard voice note"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
            </svg>
          </button>

          <button
            type="button"
            onClick={handleSend}
            className="w-9 h-9 rounded-full flex items-center justify-center bg-nexus-500 text-white hover:bg-nexus-400 shadow-md shadow-nexus-500/20 active:scale-95 transition-all"
            title="Send voice note"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="22" y1="2" x2="11" y2="13" />
              <polygon points="22 2 15 22 11 13 2 9 22 2" />
            </svg>
          </button>
        </div>
      </div>
    );
  }

  // ── Recording Render State ─────────────────────────────────────────────────
  return (
    <div className="flex items-center justify-between w-full bg-dark-700/80 border border-white/[0.06] rounded-2xl px-4 py-2 animate-pulse-subtle">
      {/* Waveform and Timer */}
      <div className="flex items-center gap-3">
        {/* Bouncing Audio Waveform animation */}
        <div className="flex items-center gap-0.5 h-4 w-12 px-1">
          <span className="w-0.75 h-2 bg-red-500 rounded-full animate-bounce" style={{ animationDelay: "0.1s" }} />
          <span className="w-0.75 h-4 bg-red-500 rounded-full animate-bounce" style={{ animationDelay: "0.2s" }} />
          <span className="w-0.75 h-3 bg-red-500 rounded-full animate-bounce" style={{ animationDelay: "0.3s" }} />
          <span className="w-0.75 h-5 bg-red-500 rounded-full animate-bounce" style={{ animationDelay: "0.4s" }} />
          <span className="w-0.75 h-2 bg-red-500 rounded-full animate-bounce" style={{ animationDelay: "0.5s" }} />
        </div>
        <span className="text-sm text-dark-100 font-medium select-none">
          Recording {formatDuration(duration)}
        </span>
      </div>

      {/* Control Buttons */}
      <div className="flex items-center gap-2">
        {/* Cancel */}
        <button
          type="button"
          onClick={handleCancel}
          className="w-9 h-9 rounded-full flex items-center justify-center bg-dark-600 text-dark-200 hover:bg-dark-500 hover:text-white transition-colors active:scale-95"
          title="Cancel recording"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>

        {/* Stop to Preview */}
        <button
          type="button"
          onClick={handleStopRecording}
          className="w-9 h-9 rounded-full flex items-center justify-center bg-red-500 text-white hover:bg-red-400 shadow-md active:scale-95 transition-all"
          title="Stop and preview"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
            <rect x="5" y="5" width="14" height="14" rx="1.5" />
          </svg>
        </button>
      </div>
    </div>
  );
}
