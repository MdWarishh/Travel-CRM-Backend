import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding database...\n');

  // ─── 1. Create Admin User ───────────────────────────────────────────────────
  const adminPassword = await bcrypt.hash('Admin@123', 12);

  const admin = await prisma.user.upsert({
    where: { email: 'admin@travelcrm.com' },
    update: {},
    create: {
      name: 'Super Admin',
      email: 'admin@travelcrm.com',
      password: adminPassword,
      role: 'ADMIN',
      status: 'ACTIVE',
      phone: '+91-9999999999',
      department: 'Management',
    },
  });
  console.log('✅ Admin created:', admin.email);

  // ─── 2. Create Manager User ─────────────────────────────────────────────────
  const managerPassword = await bcrypt.hash('Manager@123', 12);

  const manager = await prisma.user.upsert({
    where: { email: 'manager@travelcrm.com' },
    update: {},
    create: {
      name: 'Sales Manager',
      email: 'manager@travelcrm.com',
      password: managerPassword,
      role: 'MANAGER',
      status: 'ACTIVE',
      phone: '+91-9888888888',
      department: 'Sales',
    },
  });
  console.log('✅ Manager created:', manager.email);

  // ─── 3. Create Agent User ───────────────────────────────────────────────────
  const agentPassword = await bcrypt.hash('Agent@123', 12);

  const agent = await prisma.user.upsert({
    where: { email: 'agent@travelcrm.com' },
    update: {},
    create: {
      name: 'Travel Agent',
      email: 'agent@travelcrm.com',
      password: agentPassword,
      role: 'AGENT',
      status: 'ACTIVE',
      phone: '+91-9777777777',
      department: 'Operations',
    },
  });
  console.log('✅ Agent created:', agent.email);

  // ─── 4. Create Default Lead Stages ─────────────────────────────────────────
  const stages = [
    { title: 'New Lead', color: '#6366f1', position: 0, isDefault: true },
    { title: 'Contacted', color: '#f59e0b', position: 1 },
    { title: 'Qualified', color: '#3b82f6', position: 2 },
    { title: 'Proposal Sent', color: '#8b5cf6', position: 3 },
    { title: 'Negotiation', color: '#ec4899', position: 4 },
    { title: 'Won', color: '#10b981', position: 5 },
    { title: 'Lost', color: '#ef4444', position: 6 },
  ];

  for (const stage of stages) {
    await prisma.leadStage.upsert({
      where: { title: stage.title },
      update: {},
      create: stage,
    });
  }
  console.log('✅ Lead stages created');

  console.log('\n🎉 Seeding complete!\n');
  console.log('─────────────────────────────────────────');
  console.log('🔑 LOGIN CREDENTIALS');
  console.log('─────────────────────────────────────────');
  console.log('Admin   → admin@travelcrm.com   / Admin@123');
  console.log('Manager → manager@travelcrm.com / Manager@123');
  console.log('Agent   → agent@travelcrm.com   / Agent@123');
  console.log('─────────────────────────────────────────\n');
}

main()
  .catch((e) => {
    console.error('❌ Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });