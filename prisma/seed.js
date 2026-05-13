import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  // Pehle check karo koi stage hai ya nahi
  const existing = await prisma.leadStage.count();
  if (existing > 0) {
    console.log('✅ Stages already seeded, skipping...');
    return;
  }

  await prisma.leadStage.createMany({
    data: [
      { title: 'New Leads',       color: '#0f7c6e', position: 0, isDefault: true  },
      { title: 'Itenary Sended',  color: '#4b3fa0', position: 1 },
      { title: 'Follow Ups',      color: '#b45309', position: 2 },
      { title: 'Package Creator', color: '#0369a1', position: 3 },
      { title: 'Negotiation',     color: '#7c3aed', position: 4 },
      { title: 'Documentation',   color: '#0891b2', position: 5 },
      { title: 'Payment',         color: '#059669', position: 6 },
      { title: 'During Travel',   color: '#d97706', position: 7 },
      { title: 'Closed',          color: '#16a34a', position: 8 },
      { title: 'Cancelled',       color: '#dc2626', position: 9 },
    ],
  });

  console.log('✅ Default lead stages seeded!');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());