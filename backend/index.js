require("dotenv").config();

const express = require("express");
const cors = require("cors");
const { PrismaClient } = require("@prisma/client");
const Groq = require("groq-sdk");

const prisma = new PrismaClient();
const app = express();

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY,
});

app.use(cors({ origin: "*" }));
app.use(express.json());

/**
 * FULL GRAPH
 */
app.get("/graph", async (req, res) => {
  try {
    const orders = await prisma.salesOrder.findMany();
    const deliveries = await prisma.deliveryItem.findMany();
    const invoices = await prisma.invoiceItem.findMany();
    const journals = await prisma.journalEntry.findMany();

    res.json({ orders, deliveries, invoices, journals });
  } catch {
    res.status(500).json({ error: "Error fetching data" });
  }
});

/**
 * 🔥 CHAT (FINAL PRODUCTION VERSION)
 */
app.post("/chat", async (req, res) => {
  const { message } = req.body;

  if (!message) {
    return res.status(400).json({ error: "Message required" });
  }

  try {
    let intent = null;
    let contextData = {};

    const msg = message.toLowerCase();

    // =============================
    // ❌ DOMAIN RESTRICTION
    // =============================
    const allowedKeywords = [
      "order",
      "delivery",
      "invoice",
      "journal",
      "product",
      "billed",
      "flow",
      "trace",
      "top",
      "broken",
      "missing",
      "incomplete"
    ];

    const isRelevant =
      allowedKeywords.some((word) => msg.includes(word)) ||
      /^[JDO]-\d+/i.test(message);

    if (!isRelevant) {
      return res.json({
        response:
          "This system is designed to answer questions related to the provided dataset only.",
      });
    }

    // =============================
    // ✅ SMART INTENT DETECTION
    // =============================
    if (/^J-\d+/i.test(message)) {
      intent = "TRACE_JOURNAL";

    } else if (/^D-\d+/i.test(message)) {
      intent = "TRACE_DELIVERY";

    } else if (/^O-\d+/i.test(message)) {
      intent = "TRACE_ORDER";

    } else if (/broken|missing|not billed|no journal|incomplete/i.test(msg)) {
      intent = "BROKEN_FLOWS";

    } else if (/journal/.test(msg)) {
      intent = "TRACE_JOURNAL";

    } else if (/delivery/.test(msg)) {
      intent = "TRACE_DELIVERY";

    } else if (/order/.test(msg)) {
      intent = "TRACE_ORDER";

    } else if (/top|most billed|highest/.test(msg)) {
      intent = "TOP_PRODUCTS";

    } else {
      intent = "SUMMARY";
    }

    // Extract numeric ID
    const id = message.replace(/[^\d]/g, "");

    // =============================
    // 🔹 TRACE ORDER
    // =============================
    if (intent === "TRACE_ORDER" && id) {
      const order = await prisma.salesOrder.findUnique({
        where: { id },
      });

      if (order) {
        const deliveries = await prisma.deliveryItem.findMany({
          where: { salesOrderReference: id },
        });

        const invoices = await prisma.invoiceItem.findMany({
          where: {
            deliveryReference: {
              in: deliveries.map((d) => d.deliveryId),
            },
          },
        });

        const journals = await prisma.journalEntry.findMany({
          where: {
            invoiceReference: {
              in: invoices.map((i) => i.billingDocumentId),
            },
          },
        });

        contextData = { order, deliveries, invoices, journals };
      }
    }

    // =============================
    // 🔹 TRACE DELIVERY
    // =============================
    if (intent === "TRACE_DELIVERY" && id) {
      const delivery = await prisma.deliveryItem.findFirst({
        where: { deliveryId: id },
      });

      if (delivery) {
        const order = await prisma.salesOrder.findUnique({
          where: { id: delivery.salesOrderReference },
        });

        const invoices = await prisma.invoiceItem.findMany({
          where: { deliveryReference: id },
        });

        const journals = await prisma.journalEntry.findMany({
          where: {
            invoiceReference: {
              in: invoices.map((i) => i.billingDocumentId),
            },
          },
        });

        contextData = { delivery, order, invoices, journals };
      }
    }

    // =============================
    // 🔥 TRACE JOURNAL
    // =============================
    if (intent === "TRACE_JOURNAL" && id) {
      const journal = await prisma.journalEntry.findFirst({
        where: { id: id },
      });

      if (journal) {
        const invoices = await prisma.invoiceItem.findMany({
          where: { billingDocumentId: journal.invoiceReference },
        });

        const deliveries = await prisma.deliveryItem.findMany({
          where: {
            deliveryId: {
              in: invoices.map((i) => i.deliveryReference),
            },
          },
        });

        const orders = await prisma.salesOrder.findMany({
          where: {
            id: {
              in: deliveries.map((d) => d.salesOrderReference),
            },
          },
        });

        contextData = { journal, invoices, deliveries, orders };
      }
    }

    // =============================
    // 🔥 BROKEN FLOWS (ADDED)
    // =============================
    if (intent === "BROKEN_FLOWS") {
      const orders = await prisma.salesOrder.findMany({ take: 500 });
      const deliveries = await prisma.deliveryItem.findMany();
      const invoices = await prisma.invoiceItem.findMany();
      const journals = await prisma.journalEntry.findMany();

      const billed = new Set(invoices.map((i) => i.deliveryReference));
      const journaled = new Set(journals.map((j) => j.invoiceReference));

      const brokenFlows = [];

      orders.forEach((o) => {
        const dels = deliveries.filter(
          (d) => d.salesOrderReference === o.id
        );

        const invs = invoices.filter((i) =>
          dels.some((d) => d.deliveryId === i.deliveryReference)
        );

        const hasDelivery = dels.length > 0;
        const hasInvoice = invs.length > 0;
        const hasJournal = invs.some((i) =>
          journaled.has(i.billingDocumentId)
        );

        if (!hasDelivery) {
          brokenFlows.push({ orderId: o.id, issue: "No delivery" });

        } else if (!hasInvoice) {
          brokenFlows.push({ orderId: o.id, issue: "Delivered but not billed" });

        } else if (!hasJournal) {
          brokenFlows.push({ orderId: o.id, issue: "Billed but no journal" });
        }
      });

      contextData.brokenFlows = brokenFlows.slice(0, 50);
    }

    // =============================
    // TOP PRODUCTS
    // =============================
    if (intent === "TOP_PRODUCTS") {
      const data = await prisma.invoiceItem.findMany();

      const map = {};
      data.forEach((item) => {
        const product =
          item.material ||
          item.productId ||
          item.description ||
          item.billingDocumentId;

        map[product] = (map[product] || 0) + 1;
      });

      contextData.topProducts = Object.entries(map)
        .map(([product, count]) => ({ product, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10);
    }

    // =============================
    // SUMMARY
    // =============================
    if (intent === "SUMMARY") {
      contextData.summary = {
        orders: await prisma.salesOrder.count(),
        deliveries: await prisma.deliveryItem.count(),
        invoices: await prisma.invoiceItem.count(),
        journals: await prisma.journalEntry.count(),
      };
    }

    // =============================
    // ❌ NO DATA CASE
    // =============================
    if (!contextData || Object.keys(contextData).length === 0) {
      return res.json({ response: "No data found" });
    }

    // =============================
    // 🤖 GROQ RESPONSE
    // =============================
    const completion = await groq.chat.completions.create({
      model: "llama-3.1-8b-instant",
      messages: [
        {
          role: "system",
          content: `
You are a strict data analyst.

Rules:
- ONLY use provided data
- DO NOT guess or assume
- If data is empty → say "No data found"
- Explain clearly using relationships:
  Order → Delivery → Invoice → Journal
`,
        },
        {
          role: "user",
          content: `Question: ${message}

Data:
${JSON.stringify(contextData, null, 2)}`,
        },
      ],
    });

    const text = completion.choices[0].message.content;

    res.json({ response: text, intent });

  } catch (error) {
    console.error(error);
    res.status(500).json({ response: "Error generating response" });
  }
});

/**
 * HEALTH
 */
app.get("/", (req, res) => {
  res.send("Graph API running");
});

app.listen(3000, () => {
  console.log("Server running at http://localhost:3000");
});