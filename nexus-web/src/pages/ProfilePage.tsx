import { useState, useRef } from "react";
import { useAuthStore } from "../stores/authStore";
import { updateProfile, setPin as updatePinApi, uploadMedia } from "../services/api";

export default function ProfilePage() {
  const { user, setUser } = useAuthStore();

  const [displayName, setDisplayName] = useState(user?.display_name || "");
  const [avatarUrl, setAvatarUrl] = useState(user?.avatar_url || "");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [uploadingAvatar, setUploadingAvatar] = useState(false);

  const [pin, setPinState] = useState("");
  const [confirmPin, setConfirmPinState] = useState("");
  const [pinSaving, setPinSaving] = useState(false);
  const [pinSaved, setPinSaved] = useState(false);
  const [pinError, setPinError] = useState("");

  const avatarInputRef = useRef<HTMLInputElement>(null);

  const BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:8000";

  const fullAvatarUrl = avatarUrl
    ? avatarUrl.startsWith("http")
      ? avatarUrl
      : `${BASE_URL}${avatarUrl}`
    : "";

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError("");
    setSaved(false);

    try {
      const updated = await updateProfile({
        display_name: displayName.trim() || undefined,
        avatar_url: avatarUrl.trim() || undefined,
      });
      setUser(updated);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err: any) {
      setError(err.message || "Failed to update profile");
    } finally {
      setSaving(false);
    }
  };

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadingAvatar(true);
    setError("");
    setSaved(false);

    try {
      const res = await uploadMedia(file);
      setAvatarUrl(res.media_url);

      // Save to profile immediately
      const updated = await updateProfile({
        display_name: displayName.trim() || undefined,
        avatar_url: res.media_url,
      });
      setUser(updated);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err: any) {
      setError(err.message || "Failed to upload profile picture");
    } finally {
      setUploadingAvatar(false);
      if (avatarInputRef.current) {
        avatarInputRef.current.value = "";
      }
    }
  };

  const handleRemoveAvatar = async () => {
    setUploadingAvatar(true);
    setError("");
    setSaved(false);
    try {
      setAvatarUrl("");
      const updated = await updateProfile({
        display_name: displayName.trim() || undefined,
        avatar_url: "",
      });
      setUser(updated);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err: any) {
      setError(err.message || "Failed to remove avatar");
    } finally {
      setUploadingAvatar(false);
    }
  };

  const handlePinSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pin.length < 4 || pin.length > 6) {
      setPinError("PIN must be between 4 and 6 digits");
      return;
    }
    if (pin !== confirmPin) {
      setPinError("PINs do not match");
      return;
    }

    setPinSaving(true);
    setPinError("");
    setPinSaved(false);

    try {
      await updatePinApi(pin);
      setPinSaved(true);
      setPinState("");
      setConfirmPinState("");
      setTimeout(() => setPinSaved(false), 3000);
    } catch (err: any) {
      setPinError(err.message || "Failed to update PIN");
    } finally {
      setPinSaving(false);
    }
  };

  const initial = (displayName || user?.display_name || "N").charAt(0).toUpperCase();

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-lg mx-auto px-4 md:px-6 py-8">
        <h2 className="text-xl font-bold text-dark-50 mb-6">Profile</h2>

        {/* Avatar preview */}
        <div className="flex flex-col items-center mb-8">
          <div
            onClick={() => avatarInputRef.current?.click()}
            className="relative group cursor-pointer"
            title="Click to upload new photo"
          >
            {avatarUrl ? (
              <img
                src={fullAvatarUrl}
                alt="Avatar"
                className="w-24 h-24 rounded-full object-cover border-2 border-nexus-500/30 shadow-xl shadow-nexus-500/10 group-hover:brightness-90 transition-all"
              />
            ) : (
              <div className="w-24 h-24 rounded-full bg-gradient-to-br from-nexus-500 to-nexus-700 flex items-center justify-center text-3xl font-bold text-white shadow-xl shadow-nexus-500/20 group-hover:from-nexus-450 group-hover:to-nexus-650 transition-all select-none">
                {initial}
              </div>
            )}

            {/* Glow ring & overlay */}
            <div className="absolute inset-0 rounded-full border-2 border-nexus-400/0 group-hover:border-nexus-400/30 transition-all duration-300 flex items-center justify-center bg-black/0 group-hover:bg-black/20">
              <span className="opacity-0 group-hover:opacity-100 text-[10px] text-white font-medium bg-black/60 px-2 py-0.5 rounded-full backdrop-blur-sm transition-opacity duration-300">
                Change
              </span>
            </div>
          </div>

          <p className="text-dark-200 text-sm mt-3">
            {user?.phone || "Unknown"}
          </p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label className="block text-xs font-medium text-dark-200 mb-2 ml-1">
              Display Name
            </label>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Your name"
              className="
                w-full bg-dark-700/60 text-dark-50 placeholder-dark-400
                px-4 py-3 rounded-xl border border-white/[0.06]
                focus:outline-none focus:border-nexus-500/40 focus:ring-2 focus:ring-nexus-500/10
                text-sm transition-all
              "
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-dark-200 mb-2 ml-1">
              Profile Photo
            </label>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => avatarInputRef.current?.click()}
                disabled={uploadingAvatar}
                className="px-4 py-2.5 rounded-xl border border-white/[0.08] bg-dark-700/50 hover:bg-dark-600 text-dark-100 hover:text-white text-xs font-semibold flex items-center gap-2 transition-all active:scale-95 disabled:opacity-50"
              >
                {uploadingAvatar ? (
                  <span className="w-3.5 h-3.5 border-2 border-dark-300/30 border-t-white rounded-full animate-spin" />
                ) : (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                    <circle cx="12" cy="13" r="4" />
                  </svg>
                )}
                Upload Photo
              </button>
              {avatarUrl && (
                <button
                  type="button"
                  onClick={handleRemoveAvatar}
                  disabled={uploadingAvatar}
                  className="text-xs text-red-400 hover:text-red-300 transition-colors disabled:opacity-50"
                >
                  Remove Photo
                </button>
              )}
            </div>
            <input
              type="file"
              ref={avatarInputRef}
              onChange={handleAvatarUpload}
              accept="image/*"
              className="hidden"
            />
          </div>

          {error && (
            <p className="text-red-400 text-xs bg-red-500/10 px-3 py-2 rounded-lg">
              {error}
            </p>
          )}

          {saved && (
            <div className="flex items-center gap-2 text-nexus-400 text-xs bg-nexus-500/10 px-3 py-2 rounded-lg animate-fade-in">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
              Profile updated successfully!
            </div>
          )}

          <button
            type="submit"
            disabled={saving}
            className="
              w-full py-3 rounded-xl font-semibold text-sm
              bg-gradient-to-r from-nexus-500 to-nexus-600
              text-white shadow-lg shadow-nexus-500/25
              hover:shadow-nexus-500/40 hover:from-nexus-400 hover:to-nexus-500
              active:scale-[0.98]
              disabled:opacity-40 disabled:cursor-not-allowed
              transition-all duration-200
            "
          >
            {saving ? (
              <span className="flex items-center justify-center gap-2">
                <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Saving…
              </span>
            ) : (
              "Save Changes"
            )}
          </button>
        </form>

        {/* Security PIN Card */}
        <div className="mt-8 glass rounded-2xl p-6">
          <h3 className="text-sm font-semibold text-dark-100 mb-4 flex items-center gap-2">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-nexus-400">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
            Security PIN settings
          </h3>

          <form onSubmit={handlePinSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-[11px] font-medium text-dark-200 mb-1.5 ml-1">
                  New PIN (4-6 digits)
                </label>
                <input
                  type="password"
                  pattern="\d*"
                  maxLength={6}
                  value={pin}
                  onChange={(e) => setPinState(e.target.value.replace(/\D/g, ""))}
                  placeholder="••••"
                  className="
                    w-full bg-dark-700/60 text-dark-50 placeholder-dark-400
                    px-4 py-2.5 rounded-xl border border-white/[0.06]
                    focus:outline-none focus:border-nexus-500/40 focus:ring-1 focus:ring-nexus-500/20
                    text-sm transition-all
                  "
                />
              </div>

              <div>
                <label className="block text-[11px] font-medium text-dark-200 mb-1.5 ml-1">
                  Confirm new PIN
                </label>
                <input
                  type="password"
                  pattern="\d*"
                  maxLength={6}
                  value={confirmPin}
                  onChange={(e) => setConfirmPinState(e.target.value.replace(/\D/g, ""))}
                  placeholder="••••"
                  className="
                    w-full bg-dark-700/60 text-dark-50 placeholder-dark-400
                    px-4 py-2.5 rounded-xl border border-white/[0.06]
                    focus:outline-none focus:border-nexus-500/40 focus:ring-1 focus:ring-nexus-500/20
                    text-sm transition-all
                  "
                />
              </div>
            </div>

            {pinError && (
              <p className="text-red-400 text-xs bg-red-500/10 px-3 py-2 rounded-lg">
                {pinError}
              </p>
            )}

            {pinSaved && (
              <div className="flex items-center gap-2 text-nexus-400 text-xs bg-nexus-500/10 px-3 py-2 rounded-lg animate-fade-in">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                PIN configured successfully!
              </div>
            )}

            <button
              type="submit"
              disabled={pinSaving || pin.length < 4}
              className="
                w-full py-2.5 rounded-xl font-semibold text-sm
                bg-white/[0.06] border border-white/[0.08] text-dark-100 hover:text-white hover:bg-white/10
                active:scale-[0.98]
                disabled:opacity-40 disabled:cursor-not-allowed
                transition-all duration-200
              "
            >
              {pinSaving ? "Saving..." : "Update PIN"}
            </button>
          </form>
        </div>

        {/* Info card */}
        <div className="mt-8 glass rounded-2xl p-4">
          <h3 className="text-sm font-semibold text-dark-100 mb-2">
            Account Info
          </h3>
          <div className="space-y-2 text-xs">
            <div className="flex justify-between">
              <span className="text-dark-300">User ID</span>
              <span className="text-dark-100 font-mono text-[11px]">
                {user?.id?.slice(0, 8)}…
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-dark-300">Phone</span>
              <span className="text-dark-100">{user?.phone}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-dark-300">Status</span>
              <span className="text-dark-100">{user?.is_active ? "Active" : "Inactive"}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
