"use client";

import { useState } from "react";

interface FactResponse {
  fact: string;
  cached: boolean;
  cachedAt: string;
  expiresInSeconds?: number;
  fallback?: boolean;
  generating?: boolean;
}

export default function MovieFact({ movie }: { movie: string }) {
  const [data, setData] = useState<FactResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function generateFact() {
    setLoading(true);
    setError("");

    const res = await fetch("/api/fact", { method: "POST" });
    const json = await res.json();

    if (res.ok) {
      setData(json);
    } else {
      setError(json.error || "Something went wrong.");
    }
    setLoading(false);
  }

  return (
    <div className="space-y-3">
      <p className="text-slate-400 text-sm uppercase tracking-widest">
        Fun Fact
      </p>

      {data && (
        <div className="space-y-2">
          <p className="text-slate-200 leading-relaxed">{data.fact}</p>
          <div className="flex items-center gap-2 text-xs">
            {data.cached ? (
              <span className="bg-slate-800 text-slate-400 px-2 py-0.5 rounded-full">
                ⚡ Cached
                {data.expiresInSeconds
                  ? ` · refreshes in ${data.expiresInSeconds}s`
                  : ""}
              </span>
            ) : (
              <span className="bg-blue-950 text-blue-400 px-2 py-0.5 rounded-full">
                ✨ Fresh
              </span>
            )}
            {data.fallback && (
              <span className="bg-yellow-950 text-yellow-400 px-2 py-0.5 rounded-full">
                ⚠ OpenAI unavailable, showing last fact
              </span>
            )}
          </div>
        </div>
      )}

      {error && <p className="text-red-400 text-sm">{error}</p>}

      <button
        onClick={generateFact}
        disabled={loading}
        className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-semibold py-2.5 rounded-lg transition"
      >
        {loading
          ? "Generating..."
          : data
          ? "Generate Another Fact"
          : `Generate a Fact about ${movie}`}
      </button>
    </div>
  );
}