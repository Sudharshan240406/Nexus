import { useState, useEffect, useRef } from "react";
import { getTrendingGifs, searchGifs } from "../services/api";

interface GifPickerProps {
  onSelect: (gifUrl: string) => void;
  onClose: () => void;
}

interface GiphyGif {
  id: string;
  title: string;
  images: {
    fixed_height_small: {
      url: string;
    };
    downsized: {
      url: string;
    };
  };
}

export default function GifPicker({ onSelect, onClose }: GifPickerProps) {
  const [gifs, setGifs] = useState<GiphyGif[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const fetchGifs = async (query: string) => {
    setLoading(true);
    try {
      let res;
      if (query.trim()) {
        res = await searchGifs(query);
      } else {
        res = await getTrendingGifs();
      }
      setGifs(res.data || []);
    } catch (err) {
      console.error("Failed to fetch GIFs", err);
    } finally {
      setLoading(false);
    }
  };

  // Debounced search
  useEffect(() => {
    const timer = setTimeout(() => {
      fetchGifs(search);
    }, 400);

    return () => clearTimeout(timer);
  }, [search]);

  // Handle outside clicks to close
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        onClose();
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [onClose]);

  return (
    <div
      ref={containerRef}
      className="absolute bottom-12 left-0 z-50 w-72 sm:w-80 h-96 rounded-2xl bg-dark-900/95 backdrop-blur-xl border border-white/[0.08] shadow-2xl flex flex-col overflow-hidden animate-fade-in"
    >
      {/* Header / Search */}
      <div className="p-3 border-b border-white/[0.06] bg-dark-900/40">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search GIFs via GIPHY…"
          className="w-full bg-dark-800/80 text-dark-50 placeholder-dark-400 px-3.5 py-1.5 rounded-xl border border-white/[0.05] focus:outline-none focus:border-nexus-500/40 focus:ring-1 focus:ring-nexus-500/20 text-xs transition-all"
          autoFocus
        />
      </div>

      {/* GIFs Grid */}
      <div className="flex-1 overflow-y-auto p-3 custom-scrollbar">
        {loading ? (
          <div className="h-full flex items-center justify-center">
            <span className="w-6 h-6 border-2 border-nexus-400/30 border-t-nexus-400 rounded-full animate-spin" />
          </div>
        ) : gifs.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-dark-400 text-xs">
            <span>No GIFs found</span>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            {gifs.map((gif) => (
              <button
                key={gif.id}
                type="button"
                onClick={() => onSelect(gif.images.downsized.url)}
                className="group relative h-24 rounded-lg overflow-hidden border border-white/[0.04] bg-dark-800 focus:outline-none hover:scale-[1.02] active:scale-95 transition-all duration-200"
              >
                <img
                  src={gif.images.fixed_height_small.url}
                  alt={gif.title}
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                  loading="lazy"
                />
                <div className="absolute inset-0 bg-black/10 group-hover:bg-black/0 transition-colors" />
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
