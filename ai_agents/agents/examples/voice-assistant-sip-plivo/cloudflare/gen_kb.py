#!/usr/bin/env python3
"""Generate kb_seed.json for the SuperYou brand knowledge base.

Parses the scraped superyou.in FAQ page (firecrawl markdown) plus the Shopify
catalogue into embedding-ready chunks. The Worker's /demo/kb/seed route embeds
these with Workers AI (@cf/baai/bge-m3) and upserts them into Vectorize.

Usage:
  python3 gen_kb.py ../../../../.firecrawl/superyou-faqs.md \
      ../../../../.firecrawl/superyou-products.json > kb_seed.json
"""

import json
import re
import sys


def normalize_heading(line: str) -> str:
    # The scraped page letter-spaces headings: "P    r    o    d    u    c    t"
    text = line.lstrip("#").strip()
    if "    " in text:
        # collapse letter-spacing: split on 4+ spaces -> letters, 8+ -> words
        words = re.split(r" {6,}", text)
        text = " ".join("".join(w.split()) for w in words)
    return re.sub(r"\s+", " ", text).strip()


def parse_faq(md_path: str):
    lines = open(md_path).read().splitlines()
    # FAQ content lives between the "Frequently asked questions" heading and
    # the "Refer & Earn" section.
    start = end = None
    for i, line in enumerate(lines):
        if line.startswith("#") and "requentl" in normalize_heading(line).lower().replace(" ", ""):
            start = i + 1
        h = normalize_heading(line) if line.startswith("#") else ""
        if start and i > start and h.lower().startswith("refer"):
            end = i
            break
    if start is None:
        raise SystemExit("FAQ heading not found")
    lines = lines[start : end or len(lines)]

    chunks = []
    section = "General"
    question = None
    answer: list[str] = []

    def flush():
        nonlocal question, answer
        if question and answer:
            body = "\n".join(answer).strip()
            body = re.sub(r"\n{3,}", "\n\n", body)
            if len(body) > 40:
                chunks.append(
                    {
                        "id": f"faq-{len(chunks)+1}",
                        "source": "superyou.in/pages/faqs",
                        "section": section,
                        "title": question,
                        "text": f"Q: {question}\nA: {body}",
                    }
                )
        question, answer = None, []

    for line in lines:
        stripped = line.strip()
        if stripped.startswith("## "):
            flush()
            section = normalize_heading(stripped)
            continue
        if stripped.startswith("#"):
            continue
        # A short line ending in "?" that isn't inside an answer list = new question
        if (
            stripped.endswith("?")
            and not stripped.startswith(("-", "*", ">"))
            and "**" not in stripped
            and len(stripped) < 160
        ):
            flush()
            question = stripped
            continue
        if question is not None and stripped:
            answer.append(stripped)
    flush()
    return chunks


def strip_html(html):
    text = re.sub(r"<[^>]+>", " ", html or "")
    return re.sub(r"\s+", " ", text).strip()[:500]


def product_chunks(products_path: str):
    catalogue = json.load(open(products_path))["products"]
    chunks = []
    for p in catalogue:
        v = p["variants"][0]
        desc = strip_html(p.get("body_html", ""))
        chunks.append(
            {
                "id": f"product-{p['id']}",
                "source": "superyou.in catalogue",
                "section": p.get("product_type") or "Product",
                "title": p["title"],
                "text": (
                    f"Product: {p['title']}. Price: Rs. {v['price']}. "
                    f"Availability: {'in stock' if v.get('available', True) else 'out of stock'}. "
                    f"{desc}"
                ),
            }
        )
    return chunks


POLICY_CHUNKS = [
    {
        "id": "policy-shipping",
        "source": "superyou.in support policy",
        "section": "Shipping",
        "title": "Shipping and delivery",
        "text": (
            "Q: How long does delivery take and is shipping free?\n"
            "A: SuperYou offers free shipping on all orders across India. Orders are "
            "dispatched from the Bhiwandi fulfillment center and typically deliver in "
            "2-6 working days depending on the delivery city. Once dispatched, customers "
            "receive tracking details by email, WhatsApp and SMS, and can also track via "
            "the 'My Account' section on superyou.in."
        ),
    },
    {
        "id": "policy-wrong-missing",
        "source": "superyou.in support policy",
        "section": "Order issues",
        "title": "Wrong, missing or damaged items",
        "text": (
            "Q: What if my order arrives with a wrong, missing or damaged item?\n"
            "A: If an order arrives with a wrong flavour, a missing item, or damaged "
            "packaging, SuperYou support will register a claim with the order number and "
            "photos where applicable, and arrange a replacement or refund. Opened or "
            "consumed products cannot be returned, but genuine fulfilment errors are "
            "resolved with a replacement at no extra cost."
        ),
    },
    {
        "id": "policy-cod",
        "source": "superyou.in support policy",
        "section": "Payments",
        "title": "Payment methods",
        "text": (
            "Q: What payment methods are accepted?\n"
            "A: SuperYou accepts Credit Card, Debit Card, Cash On Delivery (COD), "
            "Internet Banking, PayTM, Google Pay and other UPI apps."
        ),
    },
]


def main():
    faq_path, products_path = sys.argv[1], sys.argv[2]
    chunks = parse_faq(faq_path) + POLICY_CHUNKS + product_chunks(products_path)
    json.dump({"chunks": chunks}, sys.stdout, indent=1, ensure_ascii=False)


if __name__ == "__main__":
    main()
