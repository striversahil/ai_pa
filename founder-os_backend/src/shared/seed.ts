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
  
  // Chat 1: Sanjay Singhal (Rajdhani Roller Flour Mills)
  const chatSanjayId = '919811044521@c.us';
  await prisma.message.createMany({
    data: [
      {
        chatId: chatSanjayId,
        sender: 'Sanjay Singhal',
        body: 'Hi Sahil, we need to order 12,000 sieve cleaners and 8,000 cotton pads for the Narela mill upgrade.',
        timestamp: new Date(now.getTime() - 20 * 60 * 1000), // 20 mins ago
      },
      {
        chatId: chatSanjayId,
        sender: 'Sanjay Singhal',
        body: 'Can you please send over the quotation? Also, do you have FDA or food-grade certification reports for the sieve cleaners?',
        timestamp: new Date(now.getTime() - 19 * 60 * 1000), // 19 mins ago
      },
      {
        chatId: chatSanjayId,
        sender: 'Sanjay Singhal',
        body: 'Our CFO needs to approve the certificate before we release the advance payment.',
        timestamp: new Date(now.getTime() - 18 * 60 * 1000), // 18 mins ago
      },
    ],
  });

  // Chat 2: Vikram Rathore (Adani Wilmar)
  const chatVikramId = '918511299014@c.us';
  await prisma.message.createMany({
    data: [
      {
        chatId: chatVikramId,
        sender: 'Vikram Rathore',
        body: 'Hi Sahil, do you have conveying belts that can handle up to 120°C for roasted seeds?',
        timestamp: new Date(now.getTime() - 15 * 60 * 1000),
      },
      {
        chatId: chatVikramId,
        sender: 'Vikram Rathore',
        body: 'We are also looking for high-density nylon elevator buckets (450 units) for seed grain transport.',
        timestamp: new Date(now.getTime() - 14 * 60 * 1000),
      },
      {
        chatId: chatVikramId,
        sender: 'Vikram Rathore',
        body: 'Please send over the spec sheets and comparison tables.',
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
    throw e;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
