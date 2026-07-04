"use client";

import { BookOpen, MessageSquare, Package, Phone } from "lucide-react";
import { useState } from "react";
import KnowledgeBaseTab from "@/components/KnowledgeBaseTab";
import LiveCallsTab from "@/components/LiveCallsTab";
import OrderLookupTab from "@/components/OrderLookupTab";
import TranscriptsTab from "@/components/TranscriptsTab";

type TabId = "live" | "transcripts" | "orders" | "kb";

const TABS: { id: TabId; label: string; icon: React.ElementType }[] = [
  { id: "live", label: "Live Calls", icon: Phone },
  { id: "transcripts", label: "Transcripts", icon: MessageSquare },
  { id: "orders", label: "Order Lookup", icon: Package },
  { id: "kb", label: "Knowledge Base", icon: BookOpen },
];

export default function Home() {
  const [activeTab, setActiveTab] = useState<TabId>("live");

  return (
    <div className="space-y-6">
      {/* Tab navigation */}
      <nav
        className="flex gap-1 overflow-x-auto rounded-2xl border border-gray-100 bg-white p-1.5 shadow-sm"
        aria-label="Console sections"
      >
        {TABS.map(({ id, label, icon: Icon }) => {
          const isActive = id === activeTab;
          return (
            <button
              key={id}
              onClick={() => setActiveTab(id)}
              aria-current={isActive ? "page" : undefined}
              className={`flex flex-shrink-0 items-center gap-2 rounded-xl px-4 py-2 font-medium text-sm transition-colors ${
                isActive
                  ? "bg-orange-500 text-white shadow-sm shadow-orange-500/25"
                  : "text-gray-600 hover:bg-orange-50 hover:text-orange-700"
              }`}
            >
              <Icon className="h-4 w-4" />
              {label}
            </button>
          );
        })}
      </nav>

      {/* Active tab content (transcripts stays mounted only while active,
          so its polling stops when the operator navigates away) */}
      {activeTab === "live" && <LiveCallsTab />}
      {activeTab === "transcripts" && <TranscriptsTab />}
      {activeTab === "orders" && <OrderLookupTab />}
      {activeTab === "kb" && <KnowledgeBaseTab />}
    </div>
  );
}
