import { useEffect, useState } from "react";
import { useAuthStore } from "../stores/authStore";
import { getCurrentUser, setPin, verifyPin } from "../services/api";

interface PinGateProps {
  children: React.ReactNode;
}

export default function PinGate({ children }: PinGateProps) {
  const { token, user, isUnlocked, setUnlocked, setUser, logout } = useAuthStore();
  const [pin, setPinState] = useState("");
  const [confirmPin, setConfirmPinState] = useState("");
  const [step, setStep] = useState<"setup" | "confirm" | "verify">("verify");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);

  // Sync user status on mount to check if has_pin
  useEffect(() => {
    if (!token) {
      setInitialLoading(false);
      return;
    }

    getCurrentUser()
      .then((u) => {
        setUser(u);
        if (!u.has_pin) {
          setStep("setup");
        } else {
          setStep("verify");
        }
      })
      .catch((err) => {
        console.error("Failed to fetch user status:", err);
      })
      .finally(() => {
        setInitialLoading(false);
      });
  }, [token]);

  if (!token) return <>{children}</>;

  if (initialLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-dark-950">
        <span className="w-8 h-8 border-2 border-nexus-500/30 border-t-nexus-500 rounded-full animate-spin" />
      </div>
    );
  }

  if (isUnlocked) return <>{children}</>;

  const handleKeyPress = (num: string) => {
    setError("");
    if (step === "setup") {
      if (pin.length < 6) setPinState((p) => p + num);
    } else if (step === "confirm") {
      if (confirmPin.length < 6) setConfirmPinState((p) => p + num);
    } else {
      if (pin.length < 6) {
        setPinState((p) => p + num);
      }
    }
  };

  const handleDelete = () => {
    setError("");
    if (step === "setup") {
      setPinState((p) => p.slice(0, -1));
    } else if (step === "confirm") {
      setConfirmPinState((p) => p.slice(0, -1));
    } else {
      setPinState((p) => p.slice(0, -1));
    }
  };

  const handleNextSetup = () => {
    if (pin.length < 4 || pin.length > 6) {
      setError("PIN must be between 4 and 6 digits");
      return;
    }
    setStep("confirm");
  };

  const handleConfirmSetup = async () => {
    if (pin !== confirmPin) {
      setError("PINs do not match. Try again.");
      setPinState("");
      setConfirmPinState("");
      setStep("setup");
      return;
    }

    setLoading(true);
    setError("");
    try {
      await setPin(pin);
      const updatedUser = await getCurrentUser();
      setUser(updatedUser);
      setUnlocked(true);
    } catch (err: any) {
      setError(err.message || "Failed to set PIN");
    } finally {
      setLoading(false);
    }
  };

  const handleVerify = async () => {
    if (pin.length < 4 || pin.length > 6) {
      setError("PIN must be between 4 and 6 digits");
      return;
    }

    setLoading(true);
    setError("");
    try {
      await verifyPin(pin);
      setUnlocked(true);
    } catch (err: any) {
      setError(err.message || "Incorrect PIN");
      setPinState("");
    } finally {
      setLoading(false);
    }
  };

  const keyPad = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "Clear", "0", "Back"];

  return (
    <div className="min-h-screen flex items-center justify-center bg-dark-950 relative overflow-hidden px-4">
      {/* Background blobs */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-nexus-500/5 rounded-full blur-3xl" />
        <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-emerald-500/5 rounded-full blur-3xl" />
      </div>

      <div className="w-full max-w-sm glass-strong rounded-3xl p-8 relative z-10 text-center animate-fade-in shadow-2xl border border-white/[0.08]">
        <div className="inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-gradient-to-br from-nexus-500 to-nexus-700 shadow-lg shadow-nexus-500/10 mb-6 text-white">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
        </div>

        <h2 className="text-xl font-bold text-gradient mb-2">
          {step === "setup"
            ? "Create Security PIN"
            : step === "confirm"
            ? "Confirm Security PIN"
            : "Enter Security PIN"}
        </h2>
        <p className="text-xs text-dark-300 mb-8">
          {step === "setup"
            ? "Configure a 4 to 6-digit numeric PIN to secure your app."
            : step === "confirm"
            ? "Please re-type your PIN to confirm setup."
            : "Enter your PIN to unlock Nexus."}
        </p>

        {/* Display Dots */}
        <div className="flex justify-center gap-3.5 mb-8">
          {Array.from({ length: step === "confirm" ? confirmPin.length : pin.length }).map((_, i) => (
            <span key={i} className="w-3.5 h-3.5 rounded-full bg-nexus-400 shadow-md shadow-nexus-500/35 animate-ping-soft" />
          ))}
          {Array.from({
            length: Math.max(0, 6 - (step === "confirm" ? confirmPin.length : pin.length)),
          }).map((_, i) => (
            <span key={i} className="w-3.5 h-3.5 rounded-full bg-dark-700/60 border border-white/[0.04]" />
          ))}
        </div>

        {error && (
          <p className="text-xs text-red-400 bg-red-500/10 px-3 py-1.5 rounded-xl mb-6">
            {error}
          </p>
        )}

        {/* Keypad */}
        <div className="grid grid-cols-3 gap-4 mb-8">
          {keyPad.map((key) => {
            if (key === "Clear") {
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => {
                    if (step === "setup") setPinState("");
                    else if (step === "confirm") setConfirmPinState("");
                    else setPinState("");
                  }}
                  className="h-14 rounded-2xl flex items-center justify-center text-xs font-semibold text-dark-300 hover:text-white hover:bg-white/[0.03] active:scale-95 transition-all"
                >
                  Clear
                </button>
              );
            }
            if (key === "Back") {
              return (
                <button
                  key={key}
                  type="button"
                  onClick={handleDelete}
                  className="h-14 rounded-2xl flex items-center justify-center text-dark-300 hover:text-white hover:bg-white/[0.03] active:scale-95 transition-all"
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 4H8l-7 8 7 8h13a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2z" />
                    <line x1="18" y1="9" x2="12" y2="15" />
                    <line x1="12" y1="9" x2="18" y2="15" />
                  </svg>
                </button>
              );
            }
            return (
              <button
                key={key}
                type="button"
                onClick={() => handleKeyPress(key)}
                className="h-14 rounded-2xl bg-dark-800/40 border border-white/[0.03] text-lg font-bold text-dark-50 hover:bg-white/[0.04] active:scale-95 transition-all"
              >
                {key}
              </button>
            );
          })}
        </div>

        {/* Confirm Action Button */}
        <div className="space-y-4">
          {step === "setup" && (
            <button
              onClick={handleNextSetup}
              type="button"
              disabled={pin.length < 4 || loading}
              className="w-full py-3 rounded-xl bg-nexus-500 text-white text-sm font-bold shadow-lg shadow-nexus-500/15 hover:bg-nexus-400 transition-all active:scale-98 disabled:opacity-40"
            >
              Continue
            </button>
          )}

          {step === "confirm" && (
            <button
              onClick={handleConfirmSetup}
              type="button"
              disabled={confirmPin.length < 4 || loading}
              className="w-full py-3 rounded-xl bg-nexus-500 text-white text-sm font-bold shadow-lg shadow-nexus-500/15 hover:bg-nexus-400 transition-all active:scale-98 disabled:opacity-40"
            >
              {loading ? (
                <span className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin inline-block" />
              ) : (
                "Set security PIN"
              )}
            </button>
          )}

          {step === "verify" && (
            <button
              onClick={handleVerify}
              type="button"
              disabled={pin.length < 4 || loading}
              className="w-full py-3 rounded-xl bg-nexus-500 text-white text-sm font-bold shadow-lg shadow-nexus-500/15 hover:bg-nexus-400 transition-all active:scale-98 disabled:opacity-40"
            >
              {loading ? (
                <span className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin inline-block" />
              ) : (
                "Unlock App"
              )}
            </button>
          )}

          <button
            onClick={() => {
              logout();
            }}
            type="button"
            className="w-full text-xs text-red-400 hover:text-red-300 font-medium py-1.5 transition-colors"
          >
            Sign out of this session
          </button>
        </div>
      </div>
    </div>
  );
}
