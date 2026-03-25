const fs = require("fs");
const readline = require("readline");
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

// Helper to read JSONL files
async function loadJSONL(filePath, handler) {
    const rl = readline.createInterface({
        input: fs.createReadStream(filePath),
        crlfDelay: Infinity,
    });

    for await (const line of rl) {
        if (!line.trim()) continue;
        const data = JSON.parse(line);
        await handler(data);
    }
}

async function main() {
    console.log("🚀 Seeding started...");

    // 1. SALES ORDER HEADERS
    await loadJSONL(
        "data/sales_order_headers/part-20251119-133429-440.jsonl",
        async (row) => {
            // Customer FIRST
            await prisma.customer.upsert({
                where: { id: row.soldToParty },
                update: {},
                create: { id: row.soldToParty },
            });

            // Then Sales Order
            await prisma.salesOrder.upsert({
                where: { id: row.salesOrder },
                update: {},
                create: {
                    id: row.salesOrder,
                    customerId: row.soldToParty,
                },
            });
        }
    );

    console.log("✅ Sales Orders loaded");

    // 2. SALES ORDER ITEMS
    await loadJSONL(
        "data/sales_order_items/part-20251119-133429-452.jsonl",
        async (row) => {
            await prisma.salesOrderItem.upsert({
                where: { id: `${row.salesOrder}-${row.salesOrderItem}` },
                update: {},
                create: {
                    id: `${row.salesOrder}-${row.salesOrderItem}`,
                    salesOrderId: row.salesOrder,
                    material: row.material,
                },
            });
        }
    );

    console.log("✅ Sales Order Items loaded");

    // 3. DELIVERY HEADERS
    await loadJSONL(
        "data/outbound_delivery_headers/part-20251119-133431-414.jsonl",
        async (row) => {
            await prisma.delivery.upsert({
                where: { id: row.deliveryDocument },
                update: {},
                create: {
                    id: row.deliveryDocument,
                },
            });
        }
    );

    console.log("✅ Deliveries loaded");

    // 4. DELIVERY ITEMS
    await loadJSONL(
        "data/outbound_delivery_items/part-20251119-133431-439.jsonl",
        async (row) => {
            await prisma.deliveryItem.upsert({
                where: {
                    id: `${row.deliveryDocument}-${row.deliveryDocumentItem}`,
                },
                update: {},
                create: {
                    id: `${row.deliveryDocument}-${row.deliveryDocumentItem}`,
                    deliveryId: row.deliveryDocument,
                    salesOrderReference: row.referenceSdDocument,
                },
            });
        }
    );

    console.log("✅ Delivery Items loaded");

    // 5. INVOICE HEADERS
    await loadJSONL(
        "data/billing_document_headers/part-20251119-133433-228.jsonl",
        async (row) => {
            // Customer FIRST
            await prisma.customer.upsert({
                where: { id: row.soldToParty },
                update: {},
                create: { id: row.soldToParty },
            });

            await prisma.invoice.upsert({
                where: { id: row.billingDocument },
                update: {},
                create: {
                    id: row.billingDocument,
                    customerId: row.soldToParty,
                    accountingDocument: row.accountingDocument,
                },
            });
        }
    );

    console.log("Invoices loaded");

    // 6. INVOICE ITEMS
    await loadJSONL(
        "data/billing_document_items/part-20251119-133432-233.jsonl",
        async (row) => {
            await prisma.invoiceItem.upsert({
                where: {
                    id: `${row.billingDocument}-${row.billingDocumentItem}`,
                },
                update: {},
                create: {
                    id: `${row.billingDocument}-${row.billingDocumentItem}`,
                    billingDocumentId: row.billingDocument,
                    deliveryReference: row.referenceSdDocument,
                },
            });
        }
    );

    console.log("Invoice Items loaded");

    // 7. JOURNAL ENTRIES
    const journalDir = "data/journal_entry_items_accounts_receivable";
    if (!fs.existsSync(journalDir)) {
        console.error("Folder not found:", journalDir);
        return;
    }
    const files = fs.readdirSync(journalDir);
    for (const file of files) {
        await loadJSONL(`${journalDir}/${file}`, async (row) => {
            await prisma.journalEntry.upsert({
                where: { id: row.accountingDocument },
                update: {},
                create: {
                    id: row.accountingDocument,
                    invoiceReference: row.referenceDocument,
                    customerId: row.customer,
                },
            });
        });
    }
    console.log("Journal Entries loaded");
    console.log("ALL DATA LOADED SUCCESSFULLY!");
}

main()
    .catch((e) => {
        console.error("Error:", e);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });