import { describe, expect, test } from "vitest";
import { parseToolMessage } from "./CallTape";

// Tool transcript entries are written by the backend as
// f"{name}({json.dumps(args)})" - see
// ../../tenapp/ten_packages/extension/main_python/extension.py.
// This is an unversioned string contract with no shared type; these tests
// pin the exact shape this parser must keep accepting.
describe("parseToolMessage", () => {
  test("parses a simple call with string/number args", () => {
    const result = parseToolMessage(
      'get_order_status({"order_number": "SY10042", "limit": 3})',
    );
    expect(result).not.toBeNull();
    expect(result?.fn).toBe("get_order_status");
    expect(result?.args).toEqual({ order_number: "SY10042", limit: 3 });
    expect(result?.argsLabel).toContain("order_number: SY10042");
  });

  test("parses a call with no arguments", () => {
    const result = parseToolMessage("transfer_to_human({})");
    expect(result).not.toBeNull();
    expect(result?.fn).toBe("transfer_to_human");
    expect(result?.args).toEqual({});
  });

  test("falls back to a raw args label when JSON parsing fails", () => {
    const result = parseToolMessage("search_superyou_kb({not valid json})");
    expect(result).not.toBeNull();
    expect(result?.fn).toBe("search_superyou_kb");
    expect(result?.args).toEqual({});
    expect(result?.argsLabel).toContain("not valid json");
  });

  test("returns null for plain conversational content (not a tool call)", () => {
    expect(parseToolMessage("Where is my order?")).toBeNull();
    expect(parseToolMessage("")).toBeNull();
  });

  test("handles Devanagari and unicode characters inside args", () => {
    const result = parseToolMessage(
      'recall_customer_memory({"query": "\u0906\u0926\u0947\u0936"})',
    );
    expect(result).not.toBeNull();
    expect(result?.args.query).toBe("\u0906\u0926\u0947\u0936");
  });
});
