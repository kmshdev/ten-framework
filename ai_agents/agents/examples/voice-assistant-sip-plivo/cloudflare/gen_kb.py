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
            # The FAQ page still contains a stale blanket free-shipping answer.
            # Prefer the newer dedicated shipping policy for operational facts.
            if question == "Does SuperYou offer free shipping?":
                body = (
                    "The current official shipping policy charges Rs. 50 on orders "
                    "below Rs. 500. Any applicable shipping charge is shown at checkout."
                )
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


def strip_html(html, limit=1400):
    text = re.sub(r"<[^>]+>", " ", html or "")
    return re.sub(r"\s+", " ", text).strip()[:limit]


def product_chunks(products_path: str):
    catalogue = json.load(open(products_path))["products"]
    chunks = []
    for p in catalogue:
        variants = []
        for variant in p.get("variants", []):
            label = variant.get("title") or "Default"
            price = variant.get("price", "unknown")
            availability = (
                "in stock" if variant.get("available", True) else "out of stock"
            )
            variants.append(f"{label}: Rs. {price} ({availability})")
        desc = strip_html(p.get("body_html", ""))
        tags = p.get("tags", [])
        tag_text = ", ".join(tags) if isinstance(tags, list) else str(tags or "")
        chunks.append(
            {
                "id": f"product-{p['id']}",
                "source": f"superyou.in/products/{p.get('handle', '')}",
                "section": p.get("product_type") or "Product",
                "title": p["title"],
                "text": (
                    f"Product: {p['title']}. "
                    f"Variants and current listed prices: {'; '.join(variants)}. "
                    f"Tags: {tag_text}. Description: {desc}"
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
            "A: Shipping availability and charges are shown at checkout. The current "
            "official policy levies a Rs. 50 shipping fee on orders below Rs. 500. Once "
            "an order ships, SuperYou sends tracking details for real-time monitoring. "
            "Delivery timing can be affected by stock, traffic, weather, carrier-network "
            "issues, and other events outside SuperYou's control."
        ),
    },
    {
        "id": "policy-wrong-missing",
        "source": "superyou.in support policy",
        "section": "Order issues",
        "title": "Wrong, missing or damaged items",
        "text": (
            "Q: What if my order arrives with a wrong, missing or damaged item?\n"
            "A: Online purchases generally cannot be returned. For a defective, "
            "transit-damaged, or expired product, SuperYou offers a free replacement when "
            "the customer provides proof of purchase and photographs. The customer must "
            "email hypedesk@superyou.in within 48 hours of receipt. Requests after 48 "
            "hours, third-party claims, and returns based only on disliking the product "
            "are not accepted."
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


CURATED_CHUNKS = [
    {
        "id": "brand-purpose-founders",
        "source": "superyou.in/pages/about",
        "section": "Brand and company",
        "title": "Who founded SuperYou and what is its purpose?",
        "text": (
            "SuperYou is an Indian protein-food and protein-snacks brand co-founded by "
            "Ranveer Singh and Nikunj Biyani. The founders describe the mission as making "
            "protein fun, tasty, accessible, and part of everyday food rather than treating "
            "protein only as a supplement. SuperYou says it created India's first protein "
            "wafer, with 10 grams of protein in flavours including Chocolate, Peanut Butter, "
            "Cheese, Coffee, and Strawberry Creme."
        ),
    },
    {
        "id": "brand-launch-history",
        "source": "https://www.flypup.co/post/how-superyou-built-a-100-cr-protein-snacking-empire",
        "section": "Brand and company",
        "title": "When was SuperYou launched and how old is it?",
        "text": (
            "Public company profiles report that Ranveer Singh and Nikunj Biyani launched "
            "SuperYou in November 2024. As of July 2026, the consumer brand is approximately "
            "one year and eight months old. This launch date comes from a secondary public "
            "profile; SuperYou's official About page confirms the two co-founders but does "
            "not state the launch month."
        ),
    },
    {
        "id": "support-contact-hours",
        "source": "superyou.in/pages/contact and superyou.in/policies/refund-policy",
        "section": "Customer support",
        "title": "How to contact SuperYou support",
        "text": (
            "For order-related questions, replacements, refunds, or dissatisfaction, email "
            "hypedesk@superyou.in. The official refund policy says customer care operates "
            "Monday through Saturday, 10 AM to 6 PM IST, and normally responds to email "
            "within 24 hours. Marketing and collaboration inquiries go to "
            "marketing@superyou.in."
        ),
    },
    {
        "id": "policy-cancellation-refund",
        "source": "superyou.in/policies/refund-policy",
        "section": "Cancellations and refunds",
        "title": "Can an order be cancelled or refunded?",
        "text": (
            "Once an order is successfully placed and processed, it cannot normally be "
            "cancelled or refunded. Sale-period orders are also not eligible for cancellation "
            "or refund. Refunds may be considered when the shipping location is unserviceable "
            "or delivery is unreasonably delayed. After SuperYou confirms a refund in writing, "
            "it is processed within seven working days to the original payment method; the "
            "bank may then take another five to seven working days to reflect it."
        ),
    },
    {
        "id": "policy-replacement-evidence",
        "source": "superyou.in/policies/refund-policy",
        "section": "Replacements",
        "title": "Replacement eligibility and evidence",
        "text": (
            "A defective, transit-damaged, or expired product is eligible for a free "
            "replacement if sufficient proof of purchase and photographs are provided. Email "
            "the evidence to hypedesk@superyou.in within 48 hours of receiving the order. "
            "SuperYou does not accept requests after that window, third-party claims, or a "
            "return solely because the customer dislikes the delivered product."
        ),
    },
    {
        "id": "shipping-cod-details",
        "source": "superyou.in/policies/shipping-policy",
        "section": "Shipping and COD",
        "title": "Shipping charges, tracking, delays, and cash on delivery",
        "text": (
            "The official shipping policy currently charges Rs. 50 shipping on orders below "
            "Rs. 500; applicable charges appear at checkout and listed prices include GST. "
            "Tracking details are sent after dispatch. Delivery can be delayed by stock, "
            "traffic, weather, air-network or carrier issues. For cash on delivery, customers "
            "should keep the exact amount because delivery partners may not carry change."
        ),
    },
    {
        "id": "rewards-program-overview",
        "source": "superyou.in/pages/rewards",
        "section": "Rewards",
        "title": "How SuperYou Coins work",
        "text": (
            "SuperYou's rewards page describes a loyalty program where customers join, earn "
            "SuperYou Coins through listed activities, and redeem those coins for available "
            "rewards. Available earning actions, coin values, and redemption offers can change, "
            "so customers should check the live Rewards page and their account for current terms."
        ),
    },
    {
        "id": "referral-program-process",
        "source": "superyou.in/pages/superyou-refer-and-earn",
        "section": "Referrals",
        "title": "How Refer and Earn works",
        "text": (
            "Share the unique referral link through WhatsApp, SMS, or email. A referral only "
            "qualifies when it meets the stated minimum-order requirement, is delivered "
            "successfully, and is not cancelled, returned, or marked RTO. Eligible cashback is "
            "normally processed within 48 hours after delivery and sent through WhatsApp, SMS, "
            "or email. Redemption links are single-use and may expire as stated in the message."
        ),
    },
    {
        "id": "quality-testing-process",
        "source": "superyou.in/blogs/the-protein-zone/behind-the-scenes-quality-and-safety-at-superyou",
        "section": "Quality and safety",
        "title": "How SuperYou tests protein wafers",
        "text": (
            "SuperYou describes checks across raw materials, packaging, batter, center cream, "
            "wafer weight, cooling and temperature control, metal detection, nutritional "
            "testing, chemical analysis, and microbiological testing. Its official article "
            "states that every batch is screened for bacteria and pathogens including "
            "Salmonella and E. coli under FSSAI guidelines, and only passing batches leave the factory."
        ),
    },
    {
        "id": "lab-reports-access",
        "source": "superyou.in/pages/lab-reports",
        "section": "Quality and safety",
        "title": "Where can customers find SuperYou lab reports?",
        "text": (
            "SuperYou publishes batch and product lab-report documents on the Lab Reports page "
            "at superyou.in/pages/lab-reports. Customers looking for a certificate or report "
            "for a particular product or batch should use that page and match the document name "
            "to the package or contact hypedesk@superyou.in for help."
        ),
    },
    {
        "id": "protein-comparison-quality",
        "source": "superyou.in/blogs/the-protein-zone/fermented-yeast-protein-vs-whey-protein-vs-plant-protein-the-ultimate-protein-comparison",
        "section": "Protein comparison",
        "title": "Fermented yeast protein compared with whey and plant protein",
        "text": (
            "SuperYou's comparison article says fermented yeast protein is made by fermenting "
            "Saccharomyces cerevisiae. It describes it as vegan, dairy-free, containing all nine "
            "essential amino acids, and having a PDCAAS score of 1.0, comparable with whey. The "
            "article reports a broader profile of eighteen amino acids, approximately 18.62% "
            "BCAAs and close to 8% leucine. These are brand-published nutrition claims, not "
            "personal medical advice."
        ),
    },
    {
        "id": "medical-advice-boundary",
        "source": "SuperYou support guidance",
        "section": "Health guidance",
        "title": "Medical, allergy, pregnancy, and health-condition questions",
        "text": (
            "Support may explain ingredients, nutrition labels, allergen statements, and "
            "brand-published product facts, but must not diagnose conditions or prescribe a "
            "diet or supplement. For pregnancy, medication interactions, allergies, kidney or "
            "liver conditions, digestive disorders, or other health concerns, advise the caller "
            "to consult a qualified doctor or registered dietitian before use."
        ),
    },
]


def main():
    faq_path, products_path = sys.argv[1], sys.argv[2]
    chunks = (
        parse_faq(faq_path)
        + POLICY_CHUNKS
        + CURATED_CHUNKS
        + product_chunks(products_path)
    )
    json.dump({"chunks": chunks}, sys.stdout, indent=1, ensure_ascii=False)


if __name__ == "__main__":
    main()
