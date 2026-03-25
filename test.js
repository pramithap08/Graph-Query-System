const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function main() {
  const orders = await prisma.salesOrder.count();
  const deliveries = await prisma.delivery.count();
  const invoices = await prisma.invoice.count();
  const journalEntries = await prisma.journalEntry.count();

  console.log("Orders:", orders);
  console.log("Deliveries:", deliveries);
  console.log("Invoices:", invoices);
  console.log("Journal Entries:", journalEntries);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());