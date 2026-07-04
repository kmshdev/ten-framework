"use client";

import { AlertCircle, PhoneIncoming, PhoneOutgoing } from "lucide-react";
import { useEffect, useState } from "react";
import CallStatus from "@/components/CallStatus";
import InboundCallModal from "@/components/InboundCallModal";
import OutboundCallForm from "@/components/OutboundCallForm";
import { type CallResponse, type ServerConfig, twilioAPI } from "@/app/api";

export default function LiveCallsTab() {
  const [activeCall, setActiveCall] = useState<CallResponse | null>(null);
  const [isOutboundLoading, setIsOutboundLoading] = useState(false);
  const [isInboundModalOpen, setIsInboundModalOpen] = useState(false);
  const [inboundFromNumber, setInboundFromNumber] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [serverConfig, setServerConfig] = useState<ServerConfig | null>(null);
  const [isConfigLoading, setIsConfigLoading] = useState(true);

  const fromNumber = serverConfig?.twilio_from_number || "+1234567890";

  useEffect(() => {
    let cancelled = false;

    const loadConfig = async () => {
      try {
        setIsConfigLoading(true);
        const config = await twilioAPI.getConfig();
        if (!cancelled) setServerConfig(config);
      } catch {
        // Fall back to defaults if config loading fails.
        if (!cancelled) {
          setServerConfig({
            twilio_from_number: "+1234567890",
            server_port: 8000,
            tenapp_port: 8080,
            tenapp_url: "",
            public_server_url: "",
            use_https: false,
            use_wss: false,
            media_stream_enabled: false,
            media_ws_url: "",
            webhook_enabled: false,
            webhook_url: "",
          });
        }
      } finally {
        if (!cancelled) setIsConfigLoading(false);
      }
    };

    loadConfig();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleOutboundCall = async (phoneNumber: string, message: string) => {
    try {
      setIsOutboundLoading(true);
      setError(null);
      const response = await twilioAPI.createCall({
        phone_number: phoneNumber,
        message,
      });
      setActiveCall(response);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to create outbound call"
      );
    } finally {
      setIsOutboundLoading(false);
    }
  };

  const handleHangUp = async () => {
    if (!activeCall) return;
    try {
      setIsOutboundLoading(true);
      setError(null);
      await twilioAPI.deleteCall(activeCall.call_sid);
      setActiveCall(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to hang up call");
    } finally {
      setIsOutboundLoading(false);
    }
  };

  return (
    <div className="space-y-8">
      {error && (
        <div className="flex items-start gap-3 rounded-2xl border border-red-200 bg-red-50 p-4">
          <AlertCircle className="mt-0.5 h-5 w-5 flex-shrink-0 text-red-500" />
          <div>
            <h3 className="font-medium text-red-800 text-sm">Call error</h3>
            <p className="mt-1 text-red-700 text-sm">{error}</p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
        <div className="space-y-4">
          <div className="flex items-center">
            <PhoneOutgoing className="mr-3 h-5 w-5 text-orange-500" />
            <h2 className="font-semibold text-gray-900 text-xl">
              Outbound Calls
            </h2>
          </div>
          <OutboundCallForm
            onCall={handleOutboundCall}
            onHangUp={handleHangUp}
            isLoading={isOutboundLoading}
            activeCall={activeCall}
          />
        </div>

        <div className="space-y-4">
          <div className="flex items-center">
            <PhoneIncoming className="mr-3 h-5 w-5 text-green-600" />
            <h2 className="font-semibold text-gray-900 text-xl">
              Inbound Calls
            </h2>
          </div>

          <div className="card">
            <p className="mb-4 text-gray-600 text-sm">
              Customers can call the support line directly — the AI agent picks
              up automatically. Use the button below to simulate an incoming
              call notification.
            </p>
            <button
              onClick={() => {
                setInboundFromNumber(fromNumber);
                setIsInboundModalOpen(true);
              }}
              disabled={isConfigLoading}
              className="btn-success flex w-full items-center justify-center disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isConfigLoading ? (
                <>
                  <div className="mr-2 h-4 w-4 animate-spin rounded-full border-white border-b-2" />
                  Loading...
                </>
              ) : (
                <>
                  <PhoneIncoming className="mr-2 h-5 w-5" />
                  Simulate Inbound Call
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      {activeCall && (
        <CallStatus
          callSid={activeCall.call_sid}
          onCallEnd={() => setActiveCall(null)}
        />
      )}

      <InboundCallModal
        isOpen={isInboundModalOpen}
        onClose={() => setIsInboundModalOpen(false)}
        fromNumber={inboundFromNumber}
      />
    </div>
  );
}
