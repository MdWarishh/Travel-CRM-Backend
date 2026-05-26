import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding Admin...\n');

  const hashedPassword = await bcrypt.hash('Admin@123', 12);

  const admin = await prisma.user.upsert({
    where: { email: 'admin@travelcrm.com' },
    update: {},
    create: {
      name: 'Super Admin',
      email: 'admin@travelcrm.com',
      password: hashedPassword,
      role: 'ADMIN',
      status: 'ACTIVE',
      phone: '+91-9999999999',
      department: 'Management',
    },
  });

  console.log('✅ Admin created:', admin.email);

  console.log('\n🔑 LOGIN');
  console.log('Admin → admin@travelcrm.com / Admin@123\n');
}

main()
  .catch((e) => {
    console.error('❌ Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });