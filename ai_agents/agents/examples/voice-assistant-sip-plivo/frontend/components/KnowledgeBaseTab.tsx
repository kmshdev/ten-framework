"use client";

import { BookOpen, Search } from "lucide-react";
import { useRef, useState } from "react";
import { demoAPI, type KbQueryResponse } from "@/app/demoApi";

function scorePercent(score: number): number {
  // Scores are expected in 0..1; clamp defensively.
  return Math.round(Math.min(Math.max(score, 0), 1) * 100);
}

export default function KnowledgeBaseTab() {
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<KbQueryResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = query.trim();
    if (!trimmed) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setIsLoading(true);
    setError(null);

    try {
      const data = await demoAPI.queryKb(trimmed, controller.signal);
      setResult(data);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      setResult(null);
      setError(
        err instanceof Error ? err.message : "Knowledge base query failed"
      );
    } finally {
      if (abortRef.current === controller) setIsLoading(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="card">
        <h2 className="mb-1 font-semibold text-gray-900 text-lg">
          Knowledge Base
        </h2>
        <p className="mb-4 text-gray-500 text-sm">
          Query the same knowledge base the voice agent uses to answer product
          and policy questions.
        </p>
        <form onSubmit={handleSubmit} className="flex gap-3">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="e.g. What is your return policy?"
            className="input-field"
            aria-label="Knowledge base query"
          />
          <button
            type="submit"
            disabled={!query.trim() || isLoading}
            className="btn-primary flex flex-shrink-0 items-center disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isLoading ? (
              <div className="mr-2 h-4 w-4 animate-spin rounded-full border-white border-b-2" />
            ) : (
              <Search className="mr-2 h-4 w-4" />
            )}
            Search
          </button>
        </form>
      </div>

      {error && (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-red-700 text-sm">
          {error}
        </div>
      )}

      {isLoading && (
        <div className="space-y-4">
          {[0, 1].map((i) => (
            <div key={i} className="card">
              <div className="space-y-3">
                <div className="h-4 w-1/4 animate-pulse rounded bg-gray-100" />
                <div className="h-5 w-2/3 animate-pulse rounded bg-gray-100" />
                <div className="h-14 animate-pulse rounded-xl bg-gray-100" />
              </div>
            </div>
          ))}
        </div>
      )}

      {!isLoading && result && result.results.length === 0 && (
        <div className="card flex flex-col items-center gap-2 py-10 text-center text-gray-400">
          <BookOpen className="h-8 w-8" />
          <p className="text-sm">
            No results for “{result.query}”. Try different keywords.
          </p>
        </div>
      )}

      {!isLoading && result && result.results.length > 0 && (
        <div className="space-y-4">
          <p className="text-gray-400 text-xs">
            {result.results.length} result
            {result.results.length === 1 ? "" : "s"} for “{result.query}”
          </p>
          {result.results.map((item, index) => {
            const percent = scorePercent(item.score);
            return (
              <div key={`${item.title}-${index}`} className="card">
                <div className="mb-2 flex items-center justify-between gap-3">
                  <span className="rounded-full bg-orange-100 px-2.5 py-0.5 font-medium text-orange-700 text-xs">
                    {item.section}
                  </span>
                  <div className="flex items-center gap-2">
                    <div className="h-1.5 w-24 overflow-hidden rounded-full bg-gray-100">
                      <div
                        className="h-full rounded-full bg-orange-500"
                        style={{ width: `${percent}%` }}
                      />
                    </div>
                    <span className="w-9 text-right font-mono text-[11px] text-gray-400">
                      {percent}%
                    </span>
                  </div>
                </div>
                <h3 className="font-semibold text-gray-900">{item.title}</h3>
                <p className="mt-1.5 whitespace-pre-wrap text-gray-600 text-sm leading-relaxed">
                  {item.text}
                </p>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
