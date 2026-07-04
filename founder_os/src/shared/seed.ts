import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Starting database seeding...');

  // Clear existing messages and emails
  await prisma.message.deleteMany({});
  await prisma.email.deleteMany({});
  await prisma.digest.deleteMany({});
  await prisma.task.deleteMany({});
  await prisma.founderNote.deleteMany({});

  console.log('🧹 Cleared existing database records.');

  const now = new Date();

  // 1. Seed WhatsApp Messages
  console.log('✍️ Seeding WhatsApp messages...');
  
  // Chat 1: Rahul (Investor)
  const chatRahulId = '918595563952@c.us';
  await prisma.message.createMany({
    data: [
      {
        chatId: chatRahulId,
        sender: 'Rahul (Investor)',
        body: 'Hey Sahil, hope you are doing well.',
        timestamp: new Date(now.getTime() - 20 * 60 * 1000), // 20 mins ago
      },
      {
        chatId: chatRahulId,
        sender: 'Rahul (Investor)',
        body: 'Wanted to follow up on the Q3 growth figures. Can we jump on a call tomorrow at 10 AM to discuss?',
        timestamp: new Date(now.getTime() - 19 * 60 * 1000), // 19 mins ago
      },
      {
        chatId: chatRahulId,
        sender: 'Rahul (Investor)',
        body: 'Also need the pitch deck updated with the latest revenue run-rate.',
        timestamp: new Date(now.getTime() - 18 * 60 * 1000), // 18 mins ago
      },
    ],
  });

  // Chat 2: operations-team@g.us (Group Chat)
  const chatOpsId = '120363023032@g.us';
  await prisma.message.createMany({
    data: [
      {
        chatId: chatOpsId,
        sender: 'Amit (Ops Manager)',
        body: 'Hi guys, we are facing an issue with the staging server deployment.',
        timestamp: new Date(now.getTime() - 15 * 60 * 1000),
      },
      {
        chatId: chatOpsId,
        sender: 'Neha (Tech Lead)',
        body: 'Yes, the database migrations are failing because of a locked connection. I need someone to check the database pool logs.',
        timestamp: new Date(now.getTime() - 14 * 60 * 1000),
      },
      {
        chatId: chatOpsId,
        sender: 'Amit (Ops Manager)',
        body: 'Okay, Sahil, can you please take a look or approve scaling the db resources by end of today?',
        timestamp: new Date(now.getTime() - 12 * 60 * 1000),
      },
    ],
  });

  // 2. Seed Emails
  console.log('📧 Seeding Emails...');
  await prisma.email.createMany({
    data: [
      {
        subject: 'URGENT: Stripe Account Verification Action Needed',
        sender: 'support@stripe.com',
        body: 'Hello Sahil, your account requires additional identity verification. Please upload the requested documents within 48 hours to avoid payout disruptions.',
        processed: false,
      },
      {
        subject: 'Partnership Proposal - TechCorp',
        sender: 'john.doe@techcorp.com',
        body: 'Hi Sahil, I am John from TechCorp. We love what you are building and would love to explore a distribution partnership. Are you free for a introductory call next Tuesday?',
        processed: false,
      },
    ],
  });

  console.log('✅ Database seeding finished successfully!');
}

main()
  .catch((e) => {
    console.error('❌ Seeding error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
