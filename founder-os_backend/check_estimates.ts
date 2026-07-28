import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const total = await prisma.estimate.count();
  const sentCount = await prisma.estimate.count({ where: { status: 'sent' } });
  const withClass = await prisma.estimate.count({
    where: {
      status: 'sent',
      classification: { isNot: null }
    }
  });
  const withoutClass = await prisma.estimate.count({
    where: {
      status: 'sent',
      classification: null
    }
  });
  console.log('Total Estimates (any status):', total);
  console.log('Sent Estimates:', sentCount);
  console.log('Sent Estimates WITH classification:', withClass);
  console.log('Sent Estimates WITHOUT classification:', withoutClass);
}

main().catch(console.error).finally(() => prisma.$disconnect());
