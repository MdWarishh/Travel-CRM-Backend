// /**
//  * ══════════════════════════════════════════════════════════════════
//  *  GOOGLE APPS SCRIPT — Auto-send Google Form responses to CRM
//  * ══════════════════════════════════════════════════════════════════
//  *
//  *  SETUP STEPS:
//  *  1. Open your Google Form → Extensions → Apps Script
//  *  2. Paste this entire file, replacing any existing code
//  *  3. Set your values in the CONFIG section below
//  *  4. Click Save (Ctrl+S)
//  *  5. Run → setupTrigger  (only once — sets up the auto-trigger)
//  *  6. Grant permissions when prompted
//  *  7. Done! Every form submit will now create a lead in your CRM.
//  * ══════════════════════════════════════════════════════════════════
//  */

// // ─── CONFIG — change these ─────────────────────────────────────────────────
// const CONFIG = {
//   webhookUrl:    'https://yourdomain.com/api/leads/webhook/google-form',
//   webhookSecret: 'your-secret-token-here', // must match WEBHOOK_SECRET in .env

//   // Map your Google Form question titles to CRM field names.
//   // Key   = exact question title in your Google Form
//   // Value = CRM field name
//   fieldMap: {
//     'Full Name':           'name',
//     'Phone Number':        'phone',
//     'Email Address':       'email',
//     'Destination':         'destination',
//     'Travel Date':         'travelDate',
//     'Number of Travelers': 'numberOfTravelers',
//     'Estimated Budget':    'estimatedBudget',
//     'Message':             'notes',
//   },
// };
// // ──────────────────────────────────────────────────────────────────────────

// /**
//  * Called automatically on every form submission.
//  * Do NOT rename this function.
//  */
// function onFormSubmit(e) {
//   try {
//     const payload = {};

//     // Map form responses using CONFIG.fieldMap
//     const responses = e.namedValues; // { "Question Title": ["Answer"] }
//     for (const [questionTitle, crmField] of Object.entries(CONFIG.fieldMap)) {
//       const val = responses[questionTitle];
//       if (val && val[0] && val[0].trim() !== '') {
//         payload[crmField] = val[0].trim();
//       }
//     }

//     // Send to CRM webhook
//     const options = {
//       method:      'post',
//       contentType: 'application/json',
//       payload:     JSON.stringify(payload),
//       headers:     { 'x-webhook-secret': CONFIG.webhookSecret },
//       muteHttpExceptions: true, // don't throw on 4xx/5xx — log instead
//     };

//     const response = UrlFetchApp.fetch(CONFIG.webhookUrl, options);
//     const status   = response.getResponseCode();

//     if (status === 201) {
//       Logger.log('✅ Lead created successfully: ' + response.getContentText());
//     } else {
//       Logger.log('❌ Webhook error ' + status + ': ' + response.getContentText());
//     }
//   } catch (err) {
//     Logger.log('❌ Script error: ' + err.message);
//   }
// }

// /**
//  * Run this function ONCE manually to register the form-submit trigger.
//  * After running, it sets up onFormSubmit to fire automatically forever.
//  */
// function setupTrigger() {
//   // Delete any existing triggers to avoid duplicates
//   const triggers = ScriptApp.getProjectTriggers();
//   for (const t of triggers) {
//     if (t.getHandlerFunction() === 'onFormSubmit') {
//       ScriptApp.deleteTrigger(t);
//     }
//   }

//   // Create a new form-submit trigger
//   ScriptApp.newTrigger('onFormSubmit')
//     .forForm(FormApp.getActiveForm())
//     .onFormSubmit()
//     .create();

//   Logger.log('✅ Trigger set up successfully! Every form submission will now create a lead.');
// }

// /**
//  * Optional: test the webhook manually without submitting the form.
//  * Fill in testPayload below and run this function.
//  */
// function testWebhook() {
//   const testPayload = {
//     name:              'Test User',
//     phone:             '+919876543210',
//     email:             'test@example.com',
//     destination:       'Goa',
//     travelDate:        '2025-12-01',
//     numberOfTravelers: '4',
//     estimatedBudget:   '50000',
//     notes:             'Test submission from Apps Script',
//   };

//   const options = {
//     method:      'post',
//     contentType: 'application/json',
//     payload:     JSON.stringify(testPayload),
//     headers:     { 'x-webhook-secret': CONFIG.webhookSecret },
//     muteHttpExceptions: true,
//   };

//   const response = UrlFetchApp.fetch(CONFIG.webhookUrl, options);
//   Logger.log('Status: ' + response.getResponseCode());
//   Logger.log('Response: ' + response.getContentText());
// }