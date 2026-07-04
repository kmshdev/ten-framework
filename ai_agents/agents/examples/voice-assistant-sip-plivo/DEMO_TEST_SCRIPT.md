# SuperYou Voice Agent — Demo Test Script

**You are: Rahul Verma** (customer id 20, Mumbai) — phone `+91 70114 57245` (updated in D1).
The agent identifies you by caller ID, so call **from this number** (or receive the outbound call on it).

## Your persona's data (seeded in D1)

| | Order #SY10004 (delivered) | Order #SY10121 (STUCK — the WISMO case) |
|---|---|---|
| Placed | 20 Jun 2026 | 4 Jun 2026 |
| Total | ₹2,345 | ₹2,083 |
| Items | Chocolate & Cold Coffee Sachets ×1, Protein Wafers Variety ×2, Creatine Orange Kick ×2 | Cheese Protein Wafer (10-pack) ×2, 20g Mega Protein Wafer 6×2 ×1 |
| Courier | Delhivery, AWB DE3987248494 | DTDC, AWB DT2553854176 |
| Status | Delivered 23 Jun ("received by customer, Mumbai") | **in_transit**, last seen "Departed Bhiwandi sorting hub" 7 Jun, **ETA was 10 Jun — overdue** |

## Test sequence (one call, ~5 min)

### Beat 1 — WISMO (primary pilot use case)
- Say: **"Where is my order?"**
- ✅ Expect: agent already knows your number, finds BOTH orders without asking, tells you #SY10121 is in transit via DTDC, last checkpoint Bhiwandi, and acknowledges it's past the estimated delivery date.
- Follow-up: **"Which order is the delayed one? What was in it?"** → should read back the wafer items.

### Beat 2 — Hindi / Hinglish
- Say: **"Mera order kahan hai? Hindi mein batao."**
- ✅ Expect: agent switches to Hindi/Hinglish and repeats tracking info naturally.

### Beat 3 — Post-delivery issue triage (secondary pilot use case)
- Say: **"In my delivered order, the creatine flavour is wrong — I ordered Orange Kick but got something else."**
- ✅ Expect: agent references order #SY10004's actual line items, apologizes, and offers claim initiation / escalation per the wrong-item playbook.

### Beat 4 — Brand knowledge base (Vectorize)
- Ask: **"Is your protein gluten free? I have a wheat allergy."**
- ✅ Expect: allergen answer from the real superyou.in FAQ (bio-fermented yeast protein, allergen-free list).
- Ask: **"How much protein is in the wafers?"**

### Beat 5 — Memory (mem0)
- Say: **"By the way, I'm training for a marathon and prefer chocolate flavours."**
- (This should be extracted as a preference — verify later in mem0 dashboard.)

### Beat 6 — Barge-in
- While the agent is mid-sentence, interrupt loudly with a new question.
- ✅ Expect: agent stops talking almost immediately (clearAudio fix) and answers the new question.

### Beat 7 — Human escalation
- Say: **"This is not helping. I want to talk to a real person."**
- ✅ Expect (demo mode, no HUMAN_AGENT_NUMBER set): agent registers the escalation and promises a human callback within 15 minutes.

### After hanging up
1. Open the ops console: https://superyou-voice-agent.gateway-worker-ai.workers.dev → **Transcripts** tab → your call should appear with tool-call chips.
2. Check mem0 dashboard → entity `+917011457245` → marathon/chocolate preference + wrong-flavour issue should be extracted.

### Call 2 — the money shot (personalization)
Call again from the same number and just say **"Hi"**.
- ✅ Expect: agent greets you as Rahul, may reference the delayed order or your chocolate preference unprompted. This is the continual-learning demo beat for the client.
