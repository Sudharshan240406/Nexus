import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { requestOtp, verifyOtp } from "../services/api";
import { useAuthStore } from "../stores/authStore";

type Step = "phone" | "otp";

export default function LoginPage() {
  const [step, setStep] = useState<Step>("phone");
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState("");
  const [devOtp, setDevOtp] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const setAuth = useAuthStore((s) => s.setAuth);
  const navigate = useNavigate();

  const handleRequestOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!phone.trim()) return;

    setLoading(true);
    setError("");

    try {
      const res = await requestOtp({ phone: phone.trim() });
      setDevOtp(res.otp_dev_only); // auto-fill in dev
      setStep("otp");
    } catch (err: any) {
      setError(err.message || "Failed to send OTP");
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!otp.trim()) return;

    setLoading(true);
    setError("");

    try {
      const res = await verifyOtp({ phone: phone.trim(), otp: otp.trim() });
      setAuth(res.access_token, res.user_id);
      navigate("/", { replace: true });
    } catch (err: any) {
      setError(err.message || "Invalid OTP");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4 bg-dark-950 relative overflow-hidden">
      {/* Background effects */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/4 -left-32 w-96 h-96 bg-nexus-500/8 rounded-full blur-3xl" />
        <div className="absolute bottom-1/4 -right-32 w-96 h-96 bg-nexus-600/6 rounded-full blur-3xl" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-nexus-500/[0.02] rounded-full blur-3xl" />
      </div>

      <div className="w-full max-w-sm relative z-10 animate-fade-in">
        {/* Logo & Title */}
        <div className="text-center mb-10">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-nexus-400 to-nexus-600 shadow-2xl shadow-nexus-500/30 mb-5">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
          </div>
          <h1 className="text-3xl font-bold text-gradient mb-2">Nexus</h1>
          <p className="text-dark-200 text-sm">Sign in with your phone number</p>
        </div>

        {/* Card */}
        <div className="glass-strong rounded-3xl p-6 md:p-8">
          {step === "phone" ? (
            <form onSubmit={handleRequestOtp} className="space-y-5">
              <div>
                <label className="block text-xs font-medium text-dark-200 mb-2 ml-1">
                  Phone Number
                </label>
                <input
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+91-9999999901"
                  autoFocus
                  className="
                    w-full bg-dark-800/60 text-dark-50 placeholder-dark-400
                    px-4 py-3 rounded-xl border border-white/[0.06]
                    focus:outline-none focus:border-nexus-500/40 focus:ring-2 focus:ring-nexus-500/10
                    text-sm transition-all
                  "
                />
              </div>

              {error && (
                <p className="text-red-400 text-xs bg-red-500/10 px-3 py-2 rounded-lg">
                  {error}
                </p>
              )}

              <button
                type="submit"
                disabled={loading || !phone.trim()}
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
                {loading ? (
                  <span className="flex items-center justify-center gap-2">
                    <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Sending…
                  </span>
                ) : (
                  "Request OTP"
                )}
              </button>
            </form>
          ) : (
            <form onSubmit={handleVerifyOtp} className="space-y-5">
              <div>
                <label className="block text-xs font-medium text-dark-200 mb-2 ml-1">
                  Enter OTP sent to {phone}
                </label>
                <input
                  type="text"
                  value={otp}
                  onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  placeholder="000000"
                  maxLength={6}
                  autoFocus
                  className="
                    w-full bg-dark-800/60 text-dark-50 placeholder-dark-400
                    px-4 py-3 rounded-xl border border-white/[0.06]
                    focus:outline-none focus:border-nexus-500/40 focus:ring-2 focus:ring-nexus-500/10
                    text-sm tracking-[0.4em] text-center font-mono text-lg
                    transition-all
                  "
                />
              </div>

              {/* Dev OTP hint */}
              {devOtp && (
                <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2">
                  <p className="text-amber-300 text-xs">
                    🔑 Dev OTP: <span className="font-mono font-bold tracking-wider">{devOtp}</span>
                  </p>
                </div>
              )}

              {error && (
                <p className="text-red-400 text-xs bg-red-500/10 px-3 py-2 rounded-lg">
                  {error}
                </p>
              )}

              <button
                type="submit"
                disabled={loading || otp.length < 6}
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
                {loading ? (
                  <span className="flex items-center justify-center gap-2">
                    <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Verifying…
                  </span>
                ) : (
                  "Verify & Sign In"
                )}
              </button>

              <button
                type="button"
                onClick={() => {
                  setStep("phone");
                  setOtp("");
                  setError("");
                }}
                className="w-full text-xs text-dark-300 hover:text-dark-100 transition-colors"
              >
                ← Change phone number
              </button>
            </form>
          )}
        </div>

        {/* Footer */}
        <p className="text-center text-[11px] text-dark-400 mt-6">
          Powered by <span className="text-nexus-500 font-medium">Qudra Minds</span>
        </p>
      </div>
    </div>
  );
}
