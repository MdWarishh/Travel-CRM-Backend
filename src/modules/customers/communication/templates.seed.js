// ══════════════════════════════════════════════════════════════════════
// SEED FILE — Default Communication Templates
// Run: node seed/communication-templates.seed.js
// ══════════════════════════════════════════════════════════════════════

import prisma from '../../../config/db.js';

const DEFAULT_TEMPLATES = [
  // ─── WHATSAPP TEMPLATES ───────────────────────────────────────────
  {
    name: 'Follow-up',
    type: 'WHATSAPP',
    body: `Hi {{name}} 👋, this is a friendly follow-up from our team.\n\nWe wanted to check if you had any questions about your upcoming trip to {{destination}}.\n\nFeel free to reach out anytime. We're here to help! 😊`,
    variables: ['name', 'destination'],
    isDefault: true,
  },
  {
    name: 'Offer / Promotion',
    type: 'WHATSAPP',
    body: `Hi {{name}} 🌟, we have an exclusive offer just for you!\n\n✈️ Destination: {{destination}}\n📅 Travel Dates: {{startDate}} – {{endDate}}\n💰 Special Price available for a limited time!\n\nReply to this message to know more. Don't miss out! 🎉`,
    variables: ['name', 'destination', 'startDate', 'endDate'],
    isDefault: true,
  },
  {
    name: 'Itinerary Sharing',
    type: 'WHATSAPP',
    body: `Hi {{name}}, your customized itinerary for *{{destination}}* is ready! 🗺️\n\n📅 Travel Dates: {{startDate}} – {{endDate}}\n\nPlease find your detailed itinerary attached. Let us know if you'd like any changes.\n\nLooking forward to making your trip memorable! ✈️`,
    variables: ['name', 'destination', 'startDate', 'endDate'],
    isDefault: true,
  },
  {
    name: 'Booking Confirmation',
    type: 'WHATSAPP',
    body: `Hi {{name}}, great news! 🎉 Your booking is *confirmed*!\n\n✈️ Destination: {{destination}}\n📅 Travel Dates: {{startDate}} – {{endDate}}\n\nYour booking details are attached. Please review and let us know if you have any questions.\n\nHave a wonderful trip! 🌍`,
    variables: ['name', 'destination', 'startDate', 'endDate'],
    isDefault: true,
  },
  {
    name: 'Payment Reminder',
    type: 'WHATSAPP',
    body: `Hi {{name}}, a gentle reminder that a payment is pending for your trip to {{destination}} 🌏\n\n📅 Travel Date: {{startDate}}\n\nKindly complete the payment at the earliest to confirm your booking. Let us know if you need any assistance. 🙏`,
    variables: ['name', 'destination', 'startDate'],
    isDefault: true,
  },
  {
    name: 'Custom Message',
    type: 'WHATSAPP',
    body: `Hi {{name}},\n\n`,
    variables: ['name'],
    isDefault: false,
  },

  // ─── EMAIL TEMPLATES ──────────────────────────────────────────────
  {
    name: 'Follow-up Email',
    type: 'EMAIL',
    subject: 'Following up on your trip enquiry — {{destination}}',
    body: `<p>Dear {{name}},</p>

<p>I hope this email finds you well!</p>

<p>I'm reaching out to follow up on your enquiry about a trip to <strong>{{destination}}</strong>. We would love to help you plan an unforgettable experience.</p>

<p>Please feel free to reply to this email or call us if you have any questions or would like to discuss your travel plans further.</p>

<p>We look forward to hearing from you!</p>

<p>Warm regards,<br>The Travel Team</p>`,
    variables: ['name', 'destination'],
    isDefault: true,
  },
  {
    name: 'Itinerary Email',
    type: 'EMAIL',
    subject: 'Your Customized Itinerary for {{destination}} ✈️',
    body: `<p>Dear {{name}},</p>

<p>Thank you for choosing us for your upcoming trip to <strong>{{destination}}</strong>!</p>

<p>Please find your customized itinerary attached to this email for the period <strong>{{startDate}}</strong> to <strong>{{endDate}}</strong>.</p>

<p>Do review it at your convenience. If you'd like any modifications — whether it's adding activities, changing hotels, or adjusting the schedule — please don't hesitate to let us know.</p>

<p>We're committed to making your trip truly special!</p>

<p>Warm regards,<br>The Travel Team</p>`,
    variables: ['name', 'destination', 'startDate', 'endDate'],
    isDefault: true,
  },
  {
    name: 'Booking Confirmation Email',
    type: 'EMAIL',
    subject: 'Booking Confirmed — {{destination}} | {{startDate}}',
    body: `<p>Dear {{name}},</p>

<p>We are delighted to confirm your booking! 🎉</p>

<p><strong>Trip Details:</strong></p>
<ul>
  <li><strong>Destination:</strong> {{destination}}</li>
  <li><strong>Travel Dates:</strong> {{startDate}} – {{endDate}}</li>
</ul>

<p>Your complete booking voucher is attached to this email. Please carry a copy (print or digital) during your travels.</p>

<p>If you have any questions before your trip, feel free to reach out. We wish you a wonderful journey!</p>

<p>Warm regards,<br>The Travel Team</p>`,
    variables: ['name', 'destination', 'startDate', 'endDate'],
    isDefault: true,
  },
];

async function seedTemplates() {
  console.log('🌱 Seeding default communication templates...');

  for (const template of DEFAULT_TEMPLATES) {
    await prisma.communicationTemplate.upsert({
      where: { name: template.name },  // requires @unique on name — adjust if needed
      update: template,
      create: template,
    });
    console.log(`  ✅ ${template.type}: "${template.name}"`);
  }

  console.log('\n✨ Done! Templates seeded successfully.');
  await prisma.$disconnect();
}

seedTemplates().catch((e) => {
  console.error(e);
  prisma.$disconnect();
  process.exit(1);
});