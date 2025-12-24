const express = require('express');
const fs = require('fs');
const path = require('path');
const VoiceResponse = require('twilio').twiml.VoiceResponse;
const twilioClient = require('twilio')(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);
const { OpenAI } = require('openai');

const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

// ======================================================
// SELF-PING SYSTEM
// ======================================================
if (process.env.NODE_ENV !== 'production' || process.env.FREE_PLAN === 'true') {
  const PING_INTERVAL = 4 * 60 * 1000;
  console.log(`🔄 Self-ping system activated (every ${PING_INTERVAL/60000} minutes)`);
  
  const selfPing = async () => {
    try {
      const response = await fetch('https://altair-ivr-render-1.onrender.com/health');
      if (response.ok) {
        console.log('✅ Self-ping successful - Server kept awake');
      } else {
        console.log('⚠️ Self-ping failed with status:', response.status);
      }
    } catch (error) {
      console.log('❌ Self-ping error:', error.message);
    }
  };
  
  setInterval(selfPing, PING_INTERVAL);
  setTimeout(selfPing, 5000);
}

// ======================================================
// WORKING HOURS CHECK FUNCTIONS
// ======================================================

function isWithinBusinessHours() {
  try {
    const now = new Date();
    const pstTime = new Date(now.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }));
    
    const day = pstTime.getDay();
    const hour = pstTime.getHours();
    const minutes = pstTime.getMinutes();
    const currentTime = hour * 100 + minutes;
    
    const isWeekday = day >= 1 && day <= 5;
    const isWithinHours = currentTime >= 1000 && currentTime <= 1700;
    
    console.log(`⏰ Time check: Day ${day}, Time ${hour}:${minutes}, Weekday: ${isWeekday}, Within hours: ${isWithinHours}`);
    
    return isWeekday && isWithinHours;
    
  } catch (error) {
    console.error("Error checking business hours:", error);
    return true;
  }
}

function getTimeUntilOpen() {
  try {
    const now = new Date();
    const pstTime = new Date(now.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }));
    
    const day = pstTime.getDay();
    const hour = pstTime.getHours();
    const minutes = pstTime.getMinutes();
    
    let daysUntilOpen = 0;
    let openingHour = 10;
    
    if (day === 0) daysUntilOpen = 1;
    else if (day === 6) daysUntilOpen = 2;
    else if (day >= 1 && day <= 5) {
      if (hour < 10) daysUntilOpen = 0;
      else if (hour >= 17) {
        if (day === 5) daysUntilOpen = 3;
        else daysUntilOpen = 1;
      }
    }
    
    let message = "";
    if (daysUntilOpen === 0) {
      const hoursUntilOpen = 10 - hour;
      if (hoursUntilOpen > 0) {
        message = `We open today at ${openingHour} AM Pacific Time`;
      } else {
        message = `We're open now until 5 PM Pacific Time`;
      }
    } else if (daysUntilOpen === 1) {
      message = `We open tomorrow at ${openingHour} AM Pacific Time`;
    } else {
      message = `We open on Monday at ${openingHour} AM Pacific Time`;
    }
    
    return message;
    
  } catch (error) {
    console.error("Error calculating time until open:", error);
    return "We open tomorrow at 10 AM Pacific Time";
  }
}

function getBusinessStatus() {
  const isOpen = isWithinBusinessHours();
  const nextOpenTime = getTimeUntilOpen();
  
  return {
    isOpen,
    nextOpenTime,
    currentTime: new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }),
    hours: "Monday to Friday, 10 AM to 5 PM Pacific Time",
    location: "Portland, Oregon"
  };
}

// ======================================================
// JSON DATABASE & LOGGING С МГНОВЕННОЙ АРХИВАЦИЕЙ
// ======================================================

const LOGS_DIR = "./logs";
const CURRENT_LOGS_DIR = `${LOGS_DIR}/current`;
const DAILY_LOGS_DIR = `${LOGS_DIR}/daily`;

if (!fs.existsSync(LOGS_DIR)) fs.mkdirSync(LOGS_DIR);
if (!fs.existsSync(CURRENT_LOGS_DIR)) fs.mkdirSync(CURRENT_LOGS_DIR);
if (!fs.existsSync(DAILY_LOGS_DIR)) fs.mkdirSync(DAILY_LOGS_DIR);

const DB_PATH = `${CURRENT_LOGS_DIR}/appointments.json`;
const CALL_LOGS_PATH = `${CURRENT_LOGS_DIR}/call_logs.json`;
const AI_CONVERSATIONS_PATH = `${CURRENT_LOGS_DIR}/ai_conversations.json`;
const REMINDERS_LOG = `${CURRENT_LOGS_DIR}/reminders_log.json`;

// ======================================================
// ФУНКЦИИ МГНОВЕННОЙ АРХИВАЦИИ
// ======================================================

function getTodayDateString() {
  const now = new Date();
  return now.toISOString().split('T')[0];
}

function saveToDailyArchive(type, data) {
  try {
    const today = getTodayDateString();
    const archiveFile = `${DAILY_LOGS_DIR}/${type}-${today}.json`;
    
    let existingData = [];
    
    if (fs.existsSync(archiveFile)) {
      try {
        const fileData = fs.readFileSync(archiveFile, "utf8");
        if (fileData.trim() !== '') {
          existingData = JSON.parse(fileData);
        }
      } catch (e) {
        console.log(`⚠️ Creating new ${type} archive for ${today}`);
      }
    }
    
    if (Array.isArray(data)) {
      existingData.push(...data);
    } else {
      existingData.push(data);
    }
    
    if (existingData.length > 2000) {
      existingData = existingData.slice(-2000);
    }
    
    fs.writeFileSync(archiveFile, JSON.stringify(existingData, null, 2));
    
    console.log(`✅ Instant archive: ${type} saved for ${today} (${existingData.length} records)`);
    
    saveToCurrentLogs(type, data);
    
  } catch (error) {
    console.error(`❌ Instant archive error for ${type}:`, error);
  }
}

function saveToCurrentLogs(type, data) {
  try {
    let filePath, currentData = [];
    
    switch(type) {
      case 'calls': filePath = CALL_LOGS_PATH; break;
      case 'appointments': filePath = DB_PATH; break;
      case 'ai': filePath = AI_CONVERSATIONS_PATH; break;
      case 'reminders': filePath = REMINDERS_LOG; break;
      default: return;
    }
    
    if (fs.existsSync(filePath)) {
      try {
        const fileData = fs.readFileSync(filePath, "utf8");
        if (fileData.trim() !== '') {
          currentData = JSON.parse(fileData);
        }
      } catch (e) {
        console.log(`⚠️ Creating new ${type} current log`);
      }
    }
    
    if (Array.isArray(data)) {
      currentData.push(...data);
    } else {
      currentData.push(data);
    }
    
    if (currentData.length > 1000) {
      currentData = currentData.slice(-1000);
    }
    
    fs.writeFileSync(filePath, JSON.stringify(currentData, null, 2));
    
  } catch (error) {
    console.error(`❌ Error saving to current logs for ${type}:`, error);
  }
}

// ======================================================
// REMINDER SYSTEM
// ======================================================

function logReminder(phone, appointment, action) {
  try {
    const logEntry = {
      phone,
      appointment: {
        name: appointment.name,
        date: appointment.date,
        time: appointment.time
      },
      action,
      timestamp: new Date().toISOString(),
      time: new Date().toLocaleString('en-US', { 
        timeZone: 'America/Los_Angeles',
        hour12: true,
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      })
    };
    
    saveToDailyArchive('reminders', logEntry);
    console.log(`⏰ Reminder logged: ${phone} - ${action}`);
    
  } catch (error) {
    console.error("ERROR logging reminder:", error);
  }
}

function triggerTestReminder(phone) {
  console.log(`🔔 TEST REMINDER triggered for: ${phone}`);
  
  try {
    twilioClient.calls.create({
      twiml: `<Response>
        <Say voice="alice" language="en-US">
          Hello, this is Altair Partners calling to remind you about your TEST appointment. 
          This is a test reminder call. Please call us if you need to reschedule. 
          Thank you for choosing Altair Partners!
        </Say>
        <Hangup/>
      </Response>`,
      to: phone,
      from: process.env.TWILIO_PHONE_NUMBER
    });
    
    logReminder(phone, { name: "TEST", date: "Test Date", time: "Test Time" }, "TEST_REMINDER_SENT");
    
    console.log(`📞 Test reminder call initiated to: ${phone}`);
    
  } catch (error) {
    console.error("ERROR making test reminder call:", error);
  }
}

function sendReminderCall(phone, appointment) {
  console.log(`🔔 SENDING REMINDER to: ${phone} for appointment: ${appointment.date} at ${appointment.time}`);
  
  try {
    twilioClient.calls.create({
      twiml: `<Response>
        <Say voice="alice" language="en-US">
          Hello, this is Altair Partners calling to remind you about your appointment 
          scheduled for ${appointment.date} at ${appointment.time}. 
          Please call us if you need to reschedule. 
          Thank you for choosing Altair Partners!
        </Say>
        <Hangup/>
      </Response>`,
      to: phone,
      from: process.env.TWILIO_PHONE_NUMBER
    });
    
    logReminder(phone, appointment, "REMINDER_SENT");
    
    console.log(`✅ Reminder sent to ${phone}`);
    
  } catch (error) {
    console.error("ERROR sending reminder:", error);
  }
}

function checkAndSendReminders() {
  console.log("⏰ Checking for reminders to send...");
  
  try {
    const appointments = loadDB();
    const now = new Date();
    const today = new Date(now.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }));
    
    const todayYear = today.getFullYear();
    const todayMonth = today.getMonth();
    const todayDate = today.getDate();
    
    appointments.forEach(appointment => {
      try {
        const appointmentDate = new Date(appointment.date + ' ' + todayYear);
        
        if (isNaN(appointmentDate.getTime())) {
          console.log(`❌ Invalid date format for appointment: ${appointment.date}`);
          return;
        }
        
        const appointmentYear = appointmentDate.getFullYear();
        const appointmentMonth = appointmentDate.getMonth();
        const appointmentDay = appointmentDate.getDate();
        
        const tomorrow = new Date(today);
        tomorrow.setDate(today.getDate() + 1);
        
        const isTomorrow = appointmentYear === tomorrow.getFullYear() &&
                          appointmentMonth === tomorrow.getMonth() &&
                          appointmentDay === tomorrow.getDate();
        
        if (isTomorrow) {
          console.log(`📅 Appointment found for tomorrow: ${appointment.name} - ${appointment.date} at ${appointment.time}`);
          
          const currentHour = today.getHours();
          const currentMinute = today.getMinutes();
          
          if (currentHour === 14 && currentMinute >= 0 && currentMinute <= 5) {
            console.log(`✅ It's 2 PM PST - Sending reminder to: ${appointment.phone}`);
            sendReminderCall(appointment.phone, appointment);
          }
        }
        
      } catch (error) {
        console.error(`Error processing appointment for ${appointment.name}:`, error);
      }
    });
    
  } catch (error) {
    console.error("ERROR checking reminders:", error);
  }
}

function startReminderScheduler() {
  console.log("⏰ Reminder scheduler started");
  console.log("🔄 Will check every 5 minutes for appointments tomorrow at 2 PM PST");
  
  checkAndSendReminders();
  setInterval(checkAndSendReminders, 5 * 60 * 1000);
}

// ======================================================
// OPENAI SETUP
// ======================================================
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

const REP_CONTEXT = `
You work at Altair Partners - a creative agency in Portland.

BUSINESS INFO:
- Hours: Monday to Friday, 10 AM to 5 PM Pacific Time
- Location: Portland, Oregon
- Services: Creative design, branding, marketing campaigns, video production
- For appointments: Say "I'll transfer you to our booking system"

BEHAVIOR:
1. Keep answers VERY SHORT (max 10 words)
2. If question about appointments → say "I'll transfer you to our booking system"
3. If about hours/location/services → answer directly
4. If customer says goodbye → say "Goodbye" and end call
5. Sound human but be concise
`;

async function getRepResponse(question, phone) {
  try {
    console.log(`🤖 AI Question: ${question}`);
    
    const completion = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [
        {
          role: "system",
          content: `${REP_CONTEXT}\n\nRespond in 5-10 words maximum.`
        },
        {
          role: "user",
          content: question
        }
      ],
      max_tokens: 30,
      temperature: 0.3
    });
    
    const response = completion.choices[0].message.content;
    console.log(`🤖 AI Response: ${response}`);
    
    return response;
    
  } catch (error) {
    console.error("AI Error:", error);
    return "Let me transfer you to our booking system.";
  }
}

function isSeriousQuestion(question) {
  const lower = question.toLowerCase();
  const seriousKeywords = [
    'law', 'legal', 'attorney', 'lawyer', 'court', 'lawsuit', 'sue',
    'million', 'billion', '100k', '500k', 'investment', 'laws', 'contract',
    'legal action', 'attorney', 'litigation', 'judge', 'lawsuit', 'settlement'
  ];
  
  return seriousKeywords.some(keyword => lower.includes(keyword));
}

// ======================================================
// LOGGING FUNCTIONS
// ======================================================

function logCall(phone, action, details = {}) {
  try {
    const logEntry = {
      phone,
      action,
      details,
      timestamp: new Date().toISOString(),
      time: new Date().toLocaleString('en-US', { 
        timeZone: 'America/Los_Angeles',
        hour12: true,
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      }),
      callerInfo: {
        number: phone,
        time: new Date().toLocaleTimeString('en-US', { timeZone: 'America/Los_Angeles' }),
        date: new Date().toLocaleDateString('en-US', { timeZone: 'America/Los_Angeles' })
      }
    };
    
    saveToDailyArchive('calls', logEntry);
    console.log(`📝 Call logged: ${phone} - ${action}`);
    
  } catch (error) {
    console.error("ERROR logging call:", error);
  }
}

function logAIConversation(phone, question, response) {
  try {
    const conversationEntry = {
      phone,
      question,
      response,
      timestamp: new Date().toISOString(),
      time: new Date().toLocaleString('en-US', { 
        timeZone: 'America/Los_Angeles',
        hour12: true,
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      })
    };
    
    saveToDailyArchive('ai', conversationEntry);
    console.log(`🤖 AI conversation logged: ${phone}`);
    
  } catch (error) {
    console.error("ERROR logging AI conversation:", error);
  }
}

function loadDB() {
  try {
    if (!fs.existsSync(DB_PATH)) {
      fs.writeFileSync(DB_PATH, '[]');
      return [];
    }
    const data = fs.readFileSync(DB_PATH, "utf8");
    return JSON.parse(data || '[]');
  } catch (error) {
    console.error("ERROR loading database:", error);
    return [];
  }
}

function saveDB(data) {
  try {
    fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
  } catch (error) {
    console.error("ERROR saving database:", error);
  }
}

function findAppointment(phone) {
  const db = loadDB();
  const normalizedPhone = phone.replace(/\D/g, '');
  
  return db.find(a => {
    const normalizedApptPhone = a.phone.replace(/\D/g, '');
    return normalizedApptPhone === normalizedPhone;
  });
}

function addAppointment(name, phone, businessType, serviceType, date, time) {
  const db = loadDB();
  const normalizedPhone = phone.replace(/\D/g, '');
  
  const filteredDB = db.filter(a => {
    const normalizedApptPhone = a.phone.replace(/\D/g, '');
    return normalizedApptPhone !== normalizedPhone;
  });
  
  const appointment = { 
    name, 
    phone,
    businessType,
    serviceType,
    date, 
    time,
    created: new Date().toISOString(),
    timestamp: new Date().toLocaleString('en-US', { 
      timeZone: 'America/Los_Angeles',
      hour12: true,
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    })
  };
  
  filteredDB.push(appointment);
  saveDB(filteredDB);
  
  saveToDailyArchive('appointments', appointment);
  
  console.log(`✅ Appointment added: ${name} - ${date} at ${time}`);
  
  logCall(phone, 'APPOINTMENT_SCHEDULED', {
    name,
    businessType,
    serviceType,
    date,
    time
  });
  
  return appointment;
}

function getNextAvailableDate() {
  const today = new Date();
  const nextDate = new Date(today);
  nextDate.setDate(today.getDate() + 3);
  
  const options = { weekday: 'long', month: 'long', day: 'numeric' };
  return nextDate.toLocaleDateString('en-US', options);
}

// ======================================================
// TWILIO VOICE ROUTES (сохраняем компактно)
// ======================================================

app.post('/voice', (req, res) => {
  const twiml = new VoiceResponse();
  const phone = req.body.From;
  
  console.log("📞 Main menu - Caller:", phone);
  logCall(phone, 'CALL_RECEIVED', { caller: phone });
  
  const gather = twiml.gather({
    numDigits: 1,
    action: '/handle-key',
    method: 'POST',
    timeout: 10
  });

  gather.say(
    "Thank you for choosing Altair Partners. This call may be monitored for quality assurance. " +
    "Press 1 to schedule an appointment. " +
    "Press 2 to speak with a representative. " +
    "Press 3 to request a callback. " +
    "Press 4 for partnership opportunities. " +
    "Press 7 to talk with a creative director.",
    { voice: 'alice', language: 'en-US' }
  );

  twiml.say("Please select an option.", { voice: 'alice', language: 'en-US' });
  twiml.redirect('/voice');

  res.type('text/xml').send(twiml.toString());
});

app.post('/handle-key', (req, res) => {
  const twiml = new VoiceResponse();
  const digit = req.body.Digits;
  const phone = req.body.From;

  console.log(`🔘 Menu option ${digit} - Phone: ${phone}`);
  logCall(phone, `MENU_OPTION_${digit}`);

  if (!digit) {
    twiml.say("Invalid input. Please try again.", { voice: 'alice', language: 'en-US' });
    twiml.redirect('/voice');
    return res.type('text/xml').send(twiml.toString());
  }

  if (digit === '1') {
    console.log("📅 Option 1 - Schedule appointment");
    const appt = findAppointment(phone);

    if (appt) {
      const gather = twiml.gather({
        numDigits: 1,
        action: `/appointment-manage?phone=${encodeURIComponent(phone)}`,
        method: 'POST',
        timeout: 10
      });

      gather.say(
        `I see you have an appointment scheduled on ${appt.date} at ${appt.time}. ` +
        "Press 1 to cancel this appointment. Press 2 to reschedule.",
        { voice: 'alice', language: 'en-US' }
      );

      twiml.say("No selection made. Returning to main menu.", { voice: 'alice', language: 'en-US' });
      twiml.redirect('/voice');

    } else {
      twiml.say("I don't see you in our appointment database. Let me ask you a few questions to schedule an appointment.", 
        { voice: 'alice', language: 'en-US' });
      twiml.redirect(`/get-name?phone=${encodeURIComponent(phone)}`);
    }
  }

  else if (digit === '2') {
    console.log("👤 Option 2 - Representative");
    
    if (isWithinBusinessHours()) {
      twiml.redirect('/connect-representative');
    } else {
      const nextOpenTime = getTimeUntilOpen();
      const gather = twiml.gather({
        numDigits: 1,
        action: '/closed-hours-options',
        method: 'POST',
        timeout: 10
      });

      gather.say(
        `I'm sorry, but we are currently closed. ${nextOpenTime}. ` +
        "To request a callback, press 1. To leave a voice message, press 2. " +
        "To return to the main menu, press 9.",
        { voice: 'alice', language: 'en-US' }
      );

      twiml.say("No selection made. Goodbye.", { voice: 'alice', language: 'en-US' });
      twiml.hangup();
    }
  }

  else if (digit === '3') {
    console.log("📞 Option 3 - Callback request");
    twiml.redirect('/callback-request');
  }

  else if (digit === '4') {
    console.log("🤝 Option 4 - Partnership");
    twiml.redirect('/partnership');
  }

  else if (digit === '7') {
    console.log("🎨 Option 7 - Creative Director");
    
    if (isWithinBusinessHours()) {
      twiml.redirect('/creative-director');
    } else {
      const nextOpenTime = getTimeUntilOpen();
      const gather = twiml.gather({
        numDigits: 1,
        action: '/closed-hours-options',
        method: 'POST',
        timeout: 10
      });

      gather.say(
        `I'm sorry, but we are currently closed. ${nextOpenTime}. ` +
        "To request a callback, press 1. To leave a voice message, press 2. " +
        "To return to the main menu, press 9.",
        { voice: 'alice', language: 'en-US' }
      );

      twiml.say("No selection made. Goodbye.", { voice: 'alice', language: 'en-US' });
      twiml.hangup();
    }
  }

  else {
    twiml.say("Invalid option. Please try again.", { voice: 'alice', language: 'en-US' });
    twiml.redirect('/voice');
  }

  res.type('text/xml').send(twiml.toString());
});

app.post('/transfer-to-appointment', (req, res) => {
  const twiml = new VoiceResponse();
  const phone = req.body.From;
  
  console.log(`📅 Transferring to appointment flow for: ${phone}`);
  logCall(phone, 'APPOINTMENT_FLOW_STARTED');
  
  const appt = findAppointment(phone);

  if (appt) {
    const gather = twiml.gather({
      numDigits: 1,
      action: `/appointment-manage?phone=${encodeURIComponent(phone)}`,
      method: 'POST',
      timeout: 10
    });

    gather.say(
      `I see you have an appointment scheduled on ${appt.date} at ${appt.time}. ` +
      "Press 1 to cancel this appointment. Press 2 to reschedule.",
      { voice: 'alice', language: 'en-US' }
    );

    twiml.say("No selection made. Returning to main menu.", { voice: 'alice', language: 'en-US' });
    twiml.redirect('/voice');

  } else {
    twiml.say("I don't see you in our appointment database. Let me ask you a few questions to schedule an appointment.", 
      { voice: 'alice', language: 'en-US' });
    twiml.redirect(`/get-name?phone=${encodeURIComponent(phone)}`);
  }
  
  res.type('text/xml').send(twiml.toString());
});

app.post('/closed-hours-options', (req, res) => {
  const twiml = new VoiceResponse();
  const digit = req.body.Digits;
  const phone = req.body.From;

  console.log(`🔘 Closed hours option ${digit} - Phone: ${phone}`);
  logCall(phone, `CLOSED_HOURS_OPTION_${digit}`);

  if (!digit) {
    twiml.say("No selection made. Goodbye.", { voice: 'alice', language: 'en-US' });
    twiml.hangup();
    return res.type('text/xml').send(twiml.toString());
  }

  if (digit === '1') {
    console.log("📞 Callback request during closed hours");
    
    twiml.say(
      "Your callback request has been submitted. We'll call you back during our next business hours. " +
      "Thank you for calling Altair Partners. Goodbye.",
      { voice: 'alice', language: 'en-US' }
    );
    
    try {
      twilioClient.messages.create({
        body: `📞 AFTER-HOURS Callback requested from ${phone} (Closed hours)`,
        from: process.env.TWILIO_PHONE_NUMBER,
        to: process.env.MY_PERSONAL_NUMBER
      });
      console.log(`📱 After-hours callback notification sent to admin`);
    } catch (err) {
      console.log("ERROR sending admin notification:", err);
    }
    
    logCall(phone, 'AFTER_HOURS_CALLBACK_REQUESTED');
    twiml.hangup();
  }

  else if (digit === '2') {
    console.log("🎤 Voice message during closed hours");
    
    const gather = twiml.gather({
      input: 'speech',
      action: '/record-voice-message',
      method: 'POST',
      speechTimeout: 10,
      timeout: 30,
      speechModel: 'phone_call',
      enhanced: true
    });
    
    gather.say(
      "Please leave your voice message after the beep. When you are finished, simply hang up or press the pound key.",
      { voice: 'alice', language: 'en-US' }
    );
    
    twiml.say("I didn't hear your message. Let's try again.", { voice: 'alice', language: 'en-US' });
    twiml.redirect('/closed-hours-options');
  }

  else if (digit === '9') {
    twiml.say("Returning to main menu.", { voice: 'alice', language: 'en-US' });
    twiml.redirect('/voice');
  }

  else {
    twiml.say("Invalid option. Goodbye.", { voice: 'alice', language: 'en-US' });
    twiml.hangup();
  }

  res.type('text/xml').send(twiml.toString());
});

app.post('/record-voice-message', (req, res) => {
  const twiml = new VoiceResponse();
  const message = req.body.SpeechResult || '';
  const phone = req.body.From;

  console.log(`🎤 Voice message recorded from: ${phone}`);
  
  if (message && message.trim() !== '') {
    try {
      twilioClient.messages.create({
        body: `🎤 AFTER-HOURS VOICE MESSAGE from ${phone}:\n\n"${message.substring(0, 300)}"`,
        from: process.env.TWILIO_PHONE_NUMBER,
        to: process.env.MY_PERSONAL_NUMBER
      });
      console.log(`📱 Voice message notification sent to admin`);
    } catch (err) {
      console.log("ERROR sending voice message notification:", err);
    }
    
    logCall(phone, 'VOICE_MESSAGE_RECORDED', {
      messageLength: message.length,
      preview: message.substring(0, 100)
    });
    
    twiml.say(
      "Thank you for your message. We will get back to you during our next business hours. Goodbye.",
      { voice: 'alice', language: 'en-US' }
    );
  } else {
    twiml.say(
      "I didn't hear your message. Please try again or call back during business hours. Goodbye.",
      { voice: 'alice', language: 'en-US' }
    );
  }
  
  twiml.hangup();
  res.type('text/xml').send(twiml.toString());
});

app.post('/connect-representative', (req, res) => {
  const twiml = new VoiceResponse();
  const phone = req.body.From;
  
  console.log("👤 Representative - asking for reason");
  
  if (!isWithinBusinessHours()) {
    const nextOpenTime = getTimeUntilOpen();
    twiml.say(
      `I'm sorry, but we are currently closed. ${nextOpenTime}. ` +
      "Please call back during business hours. Goodbye.",
      { voice: 'alice', language: 'en-US' }
    );
    twiml.hangup();
    return res.type('text/xml').send(twiml.toString());
  }
  
  logCall(phone, 'REPRESENTATIVE_SELECTED');

  const gather = twiml.gather({
    input: 'speech',
    action: '/confirm-reason',
    method: 'POST',
    speechTimeout: 5,
    timeout: 10,
    speechModel: 'phone_call',
    enhanced: true
  });
  
  gather.say(
    "Before I connect you with a representative, please tell me the reason for your call.",
    { voice: 'alice', language: 'en-US' }
  );
  
  twiml.say("I didn't hear your reason. Let's try again.", { voice: 'alice', language: 'en-US' });
  twiml.redirect('/connect-representative');
  
  res.type('text/xml').send(twiml.toString());
});

app.post('/confirm-reason', (req, res) => {
  const twiml = new VoiceResponse();
  const reason = req.body.SpeechResult || '';
  const phone = req.body.From;
  
  console.log(`❓ Call reason: ${reason}`);
  
  if (!reason || reason.trim() === '') {
    twiml.say("I didn't hear your reason. Let's try again.", { voice: 'alice', language: 'en-US' });
    twiml.redirect('/connect-representative');
    return res.type('text/xml').send(twiml.toString());
  }
  
  const gather = twiml.gather({
    input: 'speech dtmf',
    action: `/start-rings?reason=${encodeURIComponent(reason)}`,
    method: 'POST',
    speechTimeout: 3,
    timeout: 10
  });
  
  gather.say(`You are calling about: ${reason}. Is this correct? Say yes or no.`, 
    { voice: 'alice', language: 'en-US' });
  
  twiml.say("No response received. Let's start over.", { voice: 'alice', language: 'en-US' });
  twiml.redirect('/connect-representative');
  
  res.type('text/xml').send(twiml.toString());
});

app.post('/start-rings', (req, res) => {
  const twiml = new VoiceResponse();
  const response = req.body.SpeechResult || req.body.Digits || '';
  const reason = req.query.reason;
  const phone = req.body.From;
  
  console.log(`✅ Reason confirmed: ${reason} - Response: ${response}`);
  
  const lowerResponse = response.toLowerCase();
  
  if (lowerResponse.includes('no') || lowerResponse === '2') {
    twiml.say("Let's try again. Please tell me the reason for your call.", 
      { voice: 'alice', language: 'en-US' });
    twiml.redirect('/connect-representative');
    return res.type('text/xml').send(twiml.toString());
  }
  
  twiml.say("Okay, wait while I transfer you. Please hold.", 
    { voice: 'alice', language: 'en-US' });
  
  for (let i = 0; i < 3; i++) {
    twiml.play({ digits: 'w' });
    twiml.play({ digits: '1' });
    twiml.pause({ length: 1 });
  }
  
  twiml.say(
    "The wait time is greater than average, so I will help you with that. ",
    { voice: 'alice', language: 'en-US' }
  );
  
  const gather = twiml.gather({
    input: 'speech',
    action: '/process-rep-question',
    method: 'POST',
    speechTimeout: 2,
    timeout: 8,
    speechModel: 'phone_call',
    enhanced: true
  });
  
  gather.say("What would you like to know?", { voice: 'alice', language: 'en-US' });
  
  twiml.say("I didn't hear your question. Let me transfer you back to the main menu.");
  twiml.redirect('/voice');
  
  res.type('text/xml').send(twiml.toString());
});

app.post('/process-rep-question', async (req, res) => {
  const twiml = new VoiceResponse();
  const question = req.body.SpeechResult || '';
  const phone = req.body.From;
  
  console.log(`🤖 Processing question: ${question}`);
  
  if (!question || question.trim() === '') {
    twiml.say("I didn't hear your question. Let's try again.", { voice: 'alice', language: 'en-US' });
    twiml.redirect('/process-rep-question');
    return res.type('text/xml').send(twiml.toString());
  }
  
  const aiResponse = await getRepResponse(question, phone);
  logAIConversation(phone, question, aiResponse);
  
  twiml.say(aiResponse, { voice: 'alice', language: 'en-US' });
  
  const lowerQuestion = question.toLowerCase();
  
  if (lowerQuestion.includes('appointment') || 
      lowerQuestion.includes('book') || 
      lowerQuestion.includes('schedule') ||
      lowerQuestion.includes('meeting') ||
      lowerQuestion.includes('appoint')) {
    
    twiml.pause({ length: 0.5 });
    twiml.say("Transferring you to our booking system now.", { voice: 'alice', language: 'en-US' });
    twiml.redirect('/transfer-to-appointment');
    return res.type('text/xml').send(twiml.toString());
  }
  
  if (lowerQuestion.includes('bye') || 
      lowerQuestion.includes('thank you') || 
      lowerQuestion.includes('thanks') ||
      lowerQuestion.includes('goodbye') ||
      lowerQuestion.includes('that\'s all')) {
    
    twiml.say("Thank you for calling Altair Partners. Goodbye!", { voice: 'alice', language: 'en-US' });
    twiml.hangup();
    return res.type('text/xml').send(twiml.toString());
  }
  
  const gather = twiml.gather({
    input: 'speech',
    action: '/process-rep-question',
    method: 'POST',
    speechTimeout: 2,
    timeout: 8
  });
  
  gather.say("What else can I help you with?", { voice: 'alice', language: 'en-US' });
  
  twiml.say("Or press any key to return to main menu.");
  twiml.redirect('/voice');
  
  res.type('text/xml').send(twiml.toString());
});

app.post('/creative-director', (req, res) => {
  const twiml = new VoiceResponse();
  const phone = req.body.From;
  
  console.log("🎨 Creative Director - asking for details");
  
  if (!isWithinBusinessHours()) {
    const nextOpenTime = getTimeUntilOpen();
    twiml.say(
      `I'm sorry, but we are currently closed. ${nextOpenTime}. ` +
      "Please call back during business hours. Goodbye.",
      { voice: 'alice', language: 'en-US' }
    );
    twiml.hangup();
    return res.type('text/xml').send(twiml.toString());
  }
  
  logCall(phone, 'CREATIVE_DIRECTOR_SELECTED');

  const gather = twiml.gather({
    input: 'speech',
    action: '/check-creative-question',
    method: 'POST',
    speechTimeout: 5,
    timeout: 15,
    speechModel: 'phone_call',
    enhanced: true
  });
  
  gather.say(
    "What exactly are you calling about? Maybe I can help you with that.",
    { voice: 'alice', language: 'en-US' }
  );
  
  twiml.say("I didn't hear your question. Let's try again.", { voice: 'alice', language: 'en-US' });
  twiml.redirect('/creative-director');
  
  res.type('text/xml').send(twiml.toString());
});

app.post('/check-creative-question', (req, res) => {
  const twiml = new VoiceResponse();
  const question = req.body.SpeechResult || '';
  const phone = req.body.From;
  
  console.log(`🎨 Creative Director question: ${question}`);
  
  if (!question || question.trim() === '') {
    twiml.say("I didn't hear your question. Let's try again.", { voice: 'alice', language: 'en-US' });
    twiml.redirect('/creative-director');
    return res.type('text/xml').send(twiml.toString());
  }
  
  if (isSeriousQuestion(question)) {
    console.log(`🚨 SERIOUS QUESTION detected: ${question}`);
    
    logCall(phone, 'SERIOUS_QUESTION_DETECTED', {
      question,
      category: 'legal/money'
    });
    
    try {
      twilioClient.calls.create({
        url: 'http://demo.twilio.com/docs/voice.xml',
        to: '+15035442571',
        from: process.env.TWILIO_PHONE_NUMBER
      });
      console.log(`📞 Calling creative director about serious matter: ${question}`);
    } catch (err) {
      console.log("ERROR calling director:", err);
    }
    
    twiml.say(
      "I understand this is important. Our creative director has been notified and will review your inquiry shortly. " +
      "Would you like to schedule an appointment to discuss this further?",
      { voice: 'alice', language: 'en-US' }
    );
    
    const gather = twiml.gather({
      input: 'speech dtmf',
      action: '/creative-appointment-check',
      method: 'POST',
      speechTimeout: 3,
      timeout: 8
    });
    
    gather.say("Say yes or no.", { voice: 'alice', language: 'en-US' });
    
    twiml.say("Returning to main menu.");
    twiml.redirect('/voice');
    
  } else {
    twiml.say(
      "Perfect! You talked about that. Would you like to schedule an appointment with us?",
      { voice: 'alice', language: 'en-US' }
    );
    
    const gather = twiml.gather({
      input: 'speech dtmf',
      action: '/creative-appointment-check',
      method: 'POST',
      speechTimeout: 3,
      timeout: 8
    });
    
    gather.say("Say yes or no.", { voice: 'alice', language: 'en-US' });
    
    twiml.say("Returning to main menu.");
    twiml.redirect('/voice');
  }
  
  res.type('text/xml').send(twiml.toString());
});

app.post('/creative-appointment-check', (req, res) => {
  const twiml = new VoiceResponse();
  const response = req.body.SpeechResult || req.body.Digits || '';
  const lowerResponse = response.toLowerCase();
  
  if (lowerResponse.includes('yes') || lowerResponse === '1') {
    twiml.say("Great! Transferring you to our booking system.", { voice: 'alice', language: 'en-US' });
    twiml.redirect('/transfer-to-appointment');
  } else {
    twiml.say("Okay. Returning to main menu.", { voice: 'alice', language: 'en-US' });
    twiml.redirect('/voice');
  }
  
  res.type('text/xml').send(twiml.toString());
});

// Appointment flow (сокращенно для экономии места)
app.post('/get-name', (req, res) => {
  const twiml = new VoiceResponse();
  const phone = req.query.phone || req.body.From;
  
  console.log(`📝 Getting name for: ${phone}`);
  logCall(phone, 'APPOINTMENT_FLOW_STARTED');

  const gather = twiml.gather({
    input: 'speech',
    action: `/verify-name?phone=${encodeURIComponent(phone)}`,
    method: 'POST',
    speechTimeout: 3,
    timeout: 10,
    speechModel: 'phone_call',
    enhanced: true
  });
  
  gather.say("First question: What is your full name?", { voice: 'alice', language: 'en-US' });
  
  twiml.say("I didn't hear your name. Please try again.", { voice: 'alice', language: 'en-US' });
  twiml.redirect(`/get-name?phone=${encodeURIComponent(phone)}`);
  
  res.type('text/xml').send(twiml.toString());
});

app.post('/verify-name', (req, res) => {
  const twiml = new VoiceResponse();
  const name = req.body.SpeechResult || '';
  const phone = req.query.phone || req.body.From;
  
  console.log(`📝 Name received: ${name} for ${phone}`);
  
  if (!name || name.trim() === '') {
    twiml.say("Sorry, I didn't catch your name. Let's try again.", { voice: 'alice', language: 'en-US' });
    twiml.redirect(`/get-name?phone=${encodeURIComponent(phone)}`);
    return res.type('text/xml').send(twiml.toString());
  }
  
  const gather = twiml.gather({
    input: 'speech dtmf',
    action: `/get-business-type?phone=${encodeURIComponent(phone)}&name=${encodeURIComponent(name)}`,
    method: 'POST',
    speechTimeout: 3,
    timeout: 10
  });
  
  gather.say(`I heard: ${name}. Is this correct? Say yes or no.`, { voice: 'alice', language: 'en-US' });
  
  twiml.say("No response received. Let's try again.", { voice: 'alice', language: 'en-US' });
  twiml.redirect(`/get-name?phone=${encodeURIComponent(phone)}`);
  
  res.type('text/xml').send(twiml.toString());
});

app.post('/get-business-type', (req, res) => {
  const twiml = new VoiceResponse();
  const response = req.body.SpeechResult || req.body.Digits || '';
  const phone = req.query.phone || req.body.From;
  const name = decodeURIComponent(req.query.name || '');
  
  console.log(`📝 Name verification: ${response} for ${name}`);
  
  const lowerResponse = response.toLowerCase();
  
  if (lowerResponse.includes('no') || lowerResponse === '2') {
    twiml.say("Let's try again. What is your full name?", { voice: 'alice', language: 'en-US' });
    twiml.redirect(`/get-name?phone=${encodeURIComponent(phone)}`);
    return res.type('text/xml').send(twiml.toString());
  }
  
  const gather = twiml.gather({
    input: 'speech',
    action: `/verify-business-type?phone=${encodeURIComponent(phone)}&name=${encodeURIComponent(name)}`,
    method: 'POST',
    speechTimeout: 3,
    timeout: 10
  });
  
  gather.say(`Thanks ${name}. Second question: What type of business do you have?`, 
    { voice: 'alice', language: 'en-US' });
  
  twiml.say("I didn't hear your business type. Please try again.", { voice: 'alice', language: 'en-US' });
  twiml.redirect(`/get-business-type?phone=${encodeURIComponent(phone)}&name=${encodeURIComponent(name)}`);
  
  res.type('text/xml').send(twiml.toString());
});

app.post('/verify-business-type', (req, res) => {
  const twiml = new VoiceResponse();
  const businessType = req.body.SpeechResult || '';
  const phone = req.query.phone || req.body.From;
  const name = decodeURIComponent(req.query.name || '');
  
  console.log(`🏢 Business type: ${businessType} for ${name}`);
  
  if (!businessType || businessType.trim() === '') {
    twiml.say("Sorry, I didn't catch your business type. Let's try again.", { voice: 'alice', language: 'en-US' });
    twiml.redirect(`/get-business-type?phone=${encodeURIComponent(phone)}&name=${encodeURIComponent(name)}`);
    return res.type('text/xml').send(twiml.toString());
  }
  
  const gather = twiml.gather({
    input: 'speech dtmf',
    action: `/get-service-type?phone=${encodeURIComponent(phone)}&name=${encodeURIComponent(name)}&businessType=${encodeURIComponent(businessType)}`,
    method: 'POST',
    speechTimeout: 3,
    timeout: 10
  });
  
  gather.say(`I heard: ${businessType}. Is this correct? Say yes or no.`, { voice: 'alice', language: 'en-US' });
  
  twiml.say("No response received. Let's try again.", { voice: 'alice', language: 'en-US' });
  twiml.redirect(`/get-business-type?phone=${encodeURIComponent(phone)}&name=${encodeURIComponent(name)}`);
  
  res.type('text/xml').send(twiml.toString());
});

app.post('/get-service-type', (req, res) => {
  const twiml = new VoiceResponse();
  const response = req.body.SpeechResult || req.body.Digits || '';
  const phone = req.query.phone || req.body.From;
  const name = decodeURIComponent(req.query.name || '');
  const businessType = decodeURIComponent(req.query.businessType || '');
  
  console.log(`🏢 Business verification: ${response} for ${businessType}`);
  
  const lowerResponse = response.toLowerCase();
  
  if (lowerResponse.includes('no') || lowerResponse === '2') {
    twiml.say("Let's try again. What type of business do you have?", { voice: 'alice', language: 'en-US' });
    twiml.redirect(`/get-business-type?phone=${encodeURIComponent(phone)}&name=${encodeURIComponent(name)}`);
    return res.type('text/xml').send(twiml.toString());
  }
  
  const gather = twiml.gather({
    input: 'speech',
    action: `/verify-service-type?phone=${encodeURIComponent(phone)}&name=${encodeURIComponent(name)}&businessType=${encodeURIComponent(businessType)}`,
    method: 'POST',
    speechTimeout: 3,
    timeout: 10
  });
  
  gather.say("Third question: What type of service are you looking for?", 
    { voice: 'alice', language: 'en-US' });
  
  twiml.say("I didn't hear your service type. Please try again.", { voice: 'alice', language: 'en-US' });
  twiml.redirect(`/get-service-type?phone=${encodeURIComponent(phone)}&name=${encodeURIComponent(name)}&businessType=${encodeURIComponent(businessType)}`);
  
  res.type('text/xml').send(twiml.toString());
});

app.post('/verify-service-type', (req, res) => {
  const twiml = new VoiceResponse();
  const serviceType = req.body.SpeechResult || '';
  const phone = req.query.phone || req.body.From;
  const name = decodeURIComponent(req.query.name || '');
  const businessType = decodeURIComponent(req.query.businessType || '');
  
  console.log(`🔧 Service type: ${serviceType} for ${name}`);
  
  if (!serviceType || serviceType.trim() === '') {
    twiml.say("Sorry, I didn't catch your service type. Let's try again.", { voice: 'alice', language: 'en-US' });
    twiml.redirect(`/get-service-type?phone=${encodeURIComponent(phone)}&name=${encodeURIComponent(name)}&businessType=${encodeURIComponent(businessType)}`);
    return res.type('text/xml').send(twiml.toString());
  }
  
  const gather = twiml.gather({
    input: 'speech dtmf',
    action: `/schedule-date?phone=${encodeURIComponent(phone)}&name=${encodeURIComponent(name)}&businessType=${encodeURIComponent(businessType)}&serviceType=${encodeURIComponent(serviceType)}`,
    method: 'POST',
    speechTimeout: 3,
    timeout: 10
  });
  
  gather.say(`I heard: ${serviceType}. Is this correct? Say yes or no.`, { voice: 'alice', language: 'en-US' });
  
  twiml.say("No response received. Let's try again.", { voice: 'alice', language: 'en-US' });
  twiml.redirect(`/get-service-type?phone=${encodeURIComponent(phone)}&name=${encodeURIComponent(name)}&businessType=${encodeURIComponent(businessType)}`);
  
  res.type('text/xml').send(twiml.toString());
});

app.post('/schedule-date', (req, res) => {
  const twiml = new VoiceResponse();
  const response = req.body.SpeechResult || req.body.Digits || '';
  const phone = req.query.phone || req.body.From;
  const name = decodeURIComponent(req.query.name || '');
  const businessType = decodeURIComponent(req.query.businessType || '');
  const serviceType = decodeURIComponent(req.query.serviceType || '');
  
  console.log(`🔧 Service verification: ${response} for ${serviceType}`);
  
  const lowerResponse = response.toLowerCase();
  
  if (lowerResponse.includes('no') || lowerResponse === '2') {
    twiml.say("Let's try again. What type of service are you looking for?", { voice: 'alice', language: 'en-US' });
    twiml.redirect(`/get-service-type?phone=${encodeURIComponent(phone)}&name=${encodeURIComponent(name)}&businessType=${encodeURIComponent(businessType)}`);
    return res.type('text/xml').send(twiml.toString());
  }
  
  const nextDate = getNextAvailableDate();
  
  const gather = twiml.gather({
    input: 'speech',
    action: `/schedule-time?phone=${encodeURIComponent(phone)}&name=${encodeURIComponent(name)}&businessType=${encodeURIComponent(businessType)}&serviceType=${encodeURIComponent(serviceType)}&date=${encodeURIComponent(nextDate)}`,
    method: 'POST',
    speechTimeout: 3,
    timeout: 10
  });
  
  gather.say(
    `Perfect. The next available date is ${nextDate}. ` +
    "What time works for you on that day? Please say the time including AM or PM.",
    { voice: 'alice', language: 'en-US' }
  );
  
  twiml.say("I didn't hear a time. Please try again.", { voice: 'alice', language: 'en-US' });
  twiml.redirect(`/schedule-date?phone=${encodeURIComponent(phone)}&name=${encodeURIComponent(name)}&businessType=${encodeURIComponent(businessType)}&serviceType=${encodeURIComponent(serviceType)}`);
  
  res.type('text/xml').send(twiml.toString());
});

app.post('/schedule-time', (req, res) => {
  const twiml = new VoiceResponse();
  const time = req.body.SpeechResult || '';
  const phone = req.query.phone || req.body.From;
  const name = decodeURIComponent(req.query.name || '');
  const businessType = decodeURIComponent(req.query.businessType || '');
  const serviceType = decodeURIComponent(req.query.serviceType || '');
  const date = decodeURIComponent(req.query.date || '');
  
  console.log(`⏰ Time received: ${time} for ${date}`);
  
  if (!time || time.trim() === '') {
    twiml.say("Sorry, I didn't catch the time. Let's try again.", { voice: 'alice', language: 'en-US' });
    twiml.redirect(`/schedule-date?phone=${encodeURIComponent(phone)}&name=${encodeURIComponent(name)}&businessType=${encodeURIComponent(businessType)}&serviceType=${encodeURIComponent(serviceType)}`);
    return res.type('text/xml').send(twiml.toString());
  }
  
  let cleanedTime = time.trim()
    .replace(/NPM/gi, 'PM')
    .replace(/MPM/gi, 'PM')
    .replace(/AMM/gi, 'AM')
    .replace(/B ?M/gi, 'PM')
    .replace(/A ?M/gi, 'AM')
    .replace(/P ?M/gi, 'PM')
    .replace(/\s+/g, ' ')
    .trim();
  
  if (!cleanedTime.toLowerCase().includes('pacific') && !cleanedTime.toLowerCase().includes('pt')) {
    cleanedTime = `${cleanedTime} Pacific Time`;
  }
  
  const existingAppt = findAppointment(phone);
  if (existingAppt) {
    twiml.say(
      "I see you already have an existing appointment. Please cancel it first before scheduling a new one. " +
      "Returning to main menu.",
      { voice: 'alice', language: 'en-US' }
    );
    twiml.redirect('/voice');
    return res.type('text/xml').send(twiml.toString());
  }
  
  const appointmentSaved = addAppointment(name, phone, businessType, serviceType, date, cleanedTime);
  
  if (appointmentSaved) {
    try {
      twilioClient.messages.create({
        body: `✅ Thank you for your appointment with Altair Partners!\n\n` +
              `Your appointment: ${date} at ${cleanedTime}\n` +
              `Name: ${name}\n` +
              `Business: ${businessType}\n` +
              `Service: ${serviceType}\n\n` +
              `For further communication with our creative director, please reply with your email address.`,
        from: process.env.TWILIO_PHONE_NUMBER,
        to: phone
      });
      console.log(`📱 SMS sent to client ${phone}`);
    } catch (err) {
      console.log("ERROR sending SMS to client:", err);
    }
    
    try {
      twilioClient.messages.create({
        body: `📅 NEW APPOINTMENT\n` +
              `Name: ${name}\n` +
              `Phone: ${phone}\n` +
              `Date: ${date} at ${cleanedTime}\n` +
              `Business: ${businessType}\n` +
              `Service: ${serviceType}\n` +
              `⏰ Reminder: Will call ONE DAY BEFORE at 2 PM Pacific Time`,
        from: process.env.TWILIO_PHONE_NUMBER,
        to: process.env.MY_PERSONAL_NUMBER
      });
      console.log(`📱 Notification sent to admin`);
    } catch (err) {
      console.log("ERROR sending admin notification:", err);
    }
  }
  
  twiml.say(
    `Excellent! Your appointment has been scheduled for ${date} at ${cleanedTime}. ` +
    "You will receive an SMS shortly. Please check your messages and reply with your email address " +
    "for further communication with our creative director. We will also call you ONE DAY BEFORE " +
    "your appointment at 2 PM Pacific Time as a reminder. Thank you for choosing Altair Partners!",
    { voice: 'alice', language: 'en-US' }
  );
  twiml.hangup();
  
  res.type('text/xml').send(twiml.toString());
});

app.post('/callback-request', (req, res) => {
  const twiml = new VoiceResponse();
  const phone = req.body.From;
  
  console.log(`📞 Callback request from: ${phone}`);
  logCall(phone, 'CALLBACK_REQUESTED');

  twiml.say(
    "Your callback request has been submitted. We'll call you back as soon as possible. " +
    "Thank you for choosing Altair Partners. Goodbye.",
    { voice: 'alice', language: 'en-US' }
  );
  
  twilioClient.messages.create({
    body: `📞 Callback requested from ${phone}`,
    from: process.env.TWILIO_PHONE_NUMBER,
    to: process.env.MY_PERSONAL_NUMBER
  });
  
  twiml.hangup();
  res.type('text/xml').send(twiml.toString());
});

app.post('/partnership', (req, res) => {
  const twiml = new VoiceResponse();
  const phone = req.body.From;
  
  console.log("🤝 Partnership inquiry");
  logCall(phone, 'PARTNERSHIP_INQUIRY');

  twiml.say(
    "Thank you for your interest in partnership opportunities. " +
    "Please email us at partners@altairpartners.com for more information. " +
    "Thank you for choosing Altair Partners. Goodbye.",
    { voice: 'alice', language: 'en-US' }
  );
  twiml.hangup();
  res.type('text/xml').send(twiml.toString());
});

app.post('/appointment-manage', (req, res) => {
  const twiml = new VoiceResponse();
  const digit = req.body.Digits;
  const phone = req.query.phone;

  console.log(`❌ Managing appointment for: ${phone}`);
  logCall(phone, `APPOINTMENT_MANAGE_${digit}`);

  if (!digit) {
    twiml.say("No selection made. Returning to main menu.", { voice: 'alice', language: 'en-US' });
    twiml.redirect('/voice');
    return res.type('text/xml').send(twiml.toString());
  }

  if (digit === '1') {
    let db = loadDB();
    const normalizedPhone = phone.replace(/\D/g, '');
    const initialLength = db.length;
    
    db = db.filter(a => {
      const normalizedApptPhone = a.phone.replace(/\D/g, '');
      return normalizedApptPhone !== normalizedPhone;
    });
    
    if (db.length < initialLength) {
      saveDB(db);
      console.log(`❌ Appointment cancelled for ${phone}`);
      logCall(phone, 'APPOINTMENT_CANCELLED');
      twiml.say("Your appointment has been cancelled. Goodbye.", { voice: 'alice', language: 'en-US' });
      twiml.hangup();
    } else {
      twiml.say("No appointment found to cancel. Returning to main menu.", { voice: 'alice', language: 'en-US' });
      twiml.redirect('/voice');
    }
  }

  else if (digit === '2') {
    let db = loadDB();
    const normalizedPhone = phone.replace(/\D/g, '');
    
    db = db.filter(a => {
      const normalizedApptPhone = a.phone.replace(/\D/g, '');
      return normalizedApptPhone !== normalizedPhone;
    });
    
    saveDB(db);
    console.log(`🔄 Rescheduling for: ${phone}`);
    logCall(phone, 'APPOINTMENT_RESCHEDULE_STARTED');
    twiml.say("Let's reschedule your appointment.", { voice: 'alice', language: 'en-US' });
    twiml.redirect(`/get-name?phone=${encodeURIComponent(phone)}`);
  }

  else {
    twiml.say("Invalid option. Returning to main menu.", { voice: 'alice', language: 'en-US' });
    twiml.redirect('/voice');
  }

  res.type('text/xml').send(twiml.toString());
});

app.post('/test-reminder', (req, res) => {
  const phone = req.body.phone || req.query.phone;
  
  if (!phone) {
    return res.status(400).json({ error: "Phone number required" });
  }
  
  console.log(`🔔 Manual test trigger for phone: ${phone}`);
  triggerTestReminder(phone);
  
  res.json({ 
    status: 'test_triggered', 
    phone, 
    message: 'Test reminder call initiated' 
  });
});

app.get('/business-status', (req, res) => {
  const businessStatus = getBusinessStatus();
  
  res.json({
    isOpen: businessStatus.isOpen,
    currentTime: businessStatus.currentTime,
    nextOpenTime: businessStatus.nextOpenTime,
    businessHours: businessStatus.hours,
    location: businessStatus.location,
    message: businessStatus.isOpen ? 
      "We are currently open!" : 
      `We are currently closed. ${businessStatus.nextOpenTime}`
  });
});

// ======================================================
// КРАСИВЫЙ HTML ИНТЕРФЕЙС ДЛЯ АРХИВОВ
// ======================================================

app.get('/archive-viewer', (req, res) => {
  try {
    const files = fs.readdirSync(DAILY_LOGS_DIR);
    
    const dates = {};
    files.forEach(file => {
      if (file.includes('calls-') || file.includes('appointments-') || file.includes('ai-') || file.includes('reminders-')) {
        const date = file.split('-').slice(1, 4).join('-').replace('.json', '');
        const type = file.split('-')[0];
        
        if (!dates[date]) {
          dates[date] = {
            calls: false,
            appointments: false,
            ai: false,
            reminders: false,
            files: []
          };
        }
        
        if (type === 'calls') dates[date].calls = true;
        if (type === 'appointments') dates[date].appointments = true;
        if (type === 'ai') dates[date].ai = true;
        if (type === 'reminders') dates[date].reminders = true;
        
        dates[date].files.push(file);
      }
    });
    
    const sortedDates = Object.keys(dates).sort().reverse();
    const today = new Date().toISOString().split('T')[0];
    
    let html = `
    <!DOCTYPE html>
    <html>
    <head>
      <title>📊 Altair Partners - Daily Archives</title>
      <style>
        body { 
          font-family: 'Arial', sans-serif; 
          padding: 20px; 
          max-width: 1200px; 
          margin: 0 auto; 
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          min-height: 100vh;
        }
        .container {
          background: white;
          border-radius: 15px;
          padding: 30px;
          box-shadow: 0 10px 30px rgba(0,0,0,0.2);
          margin-top: 20px;
        }
        .header {
          text-align: center;
          margin-bottom: 30px;
          padding-bottom: 20px;
          border-bottom: 2px solid #eee;
        }
        .header h1 {
          color: #333;
          margin-bottom: 10px;
        }
        .header p {
          color: #666;
          font-size: 16px;
        }
        .date-card {
          background: #fff;
          border-radius: 10px;
          padding: 20px;
          margin-bottom: 15px;
          box-shadow: 0 3px 10px rgba(0,0,0,0.1);
          border-left: 5px solid #667eea;
          transition: all 0.3s ease;
        }
        .date-card:hover {
          transform: translateY(-3px);
          box-shadow: 0 5px 15px rgba(0,0,0,0.2);
        }
        .today {
          border-left: 5px solid #28a745;
          background: #f8fff9;
          border: 2px solid #28a745;
        }
        .date-title {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 15px;
        }
        .date-title h3 {
          margin: 0;
          color: #333;
        }
        .today-badge {
          background: #28a745;
          color: white;
          padding: 5px 10px;
          border-radius: 20px;
          font-size: 12px;
          font-weight: bold;
        }
        .logs-badges {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          margin-bottom: 15px;
        }
        .badge {
          padding: 6px 12px;
          border-radius: 20px;
          font-size: 12px;
          font-weight: bold;
          display: inline-flex;
          align-items: center;
          gap: 5px;
        }
        .calls { background: #007bff; color: white; }
        .appointments { background: #28a745; color: white; }
        .ai { background: #ffc107; color: black; }
        .reminders { background: #dc3545; color: white; }
        .actions {
          display: flex;
          gap: 10px;
          flex-wrap: wrap;
        }
        .btn {
          padding: 8px 16px;
          border-radius: 5px;
          text-decoration: none;
          font-weight: bold;
          transition: all 0.3s;
          border: none;
          cursor: pointer;
          font-size: 14px;
          display: inline-flex;
          align-items: center;
          gap: 5px;
        }
        .btn-view { background: #6c757d; color: white; }
        .btn-download { background: #17a2b8; color: white; }
        .btn-details { background: #6610f2; color: white; }
        .btn:hover {
          opacity: 0.9;
          transform: translateY(-2px);
        }
        .empty-state {
          text-align: center;
          padding: 50px;
          background: #f8f9fa;
          border-radius: 10px;
          margin: 20px 0;
        }
        .call-now {
          background: linear-gradient(135deg, #28a745 0%, #20c997 100%);
          color: white;
          padding: 20px;
          border-radius: 10px;
          text-align: center;
          margin: 30px 0;
          box-shadow: 0 5px 15px rgba(40, 167, 69, 0.3);
        }
        .call-now h3 {
          margin-top: 0;
          font-size: 24px;
        }
        .phone-number {
          font-size: 28px;
          font-weight: bold;
          margin: 15px 0;
          background: rgba(255,255,255,0.2);
          padding: 10px;
          border-radius: 5px;
          display: inline-block;
        }
        .stats {
          display: flex;
          justify-content: space-around;
          background: #f8f9fa;
          padding: 15px;
          border-radius: 10px;
          margin-bottom: 20px;
        }
        .stat-item {
          text-align: center;
        }
        .stat-number {
          font-size: 24px;
          font-weight: bold;
          color: #667eea;
        }
        .stat-label {
          font-size: 14px;
          color: #666;
        }
        @media (max-width: 768px) {
          .container { padding: 15px; }
          .actions { flex-direction: column; }
          .btn { width: 100%; text-align: center; }
        }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
                   <h1>📊 Altair Partners - Daily Archives</h1>
          <p>Все звонки сохраняются автоматически. Последнее обновление: ${new Date().toLocaleString()}</p>
        </div>
        
        <div class="stats">
          <div class="stat-item">
            <div class="stat-number">${sortedDates.length}</div>
            <div class="stat-label">Дней в архиве</div>
          </div>
          <div class="stat-item">
            <div class="stat-number">${dates[today] ? Object.values(dates[today]).filter(Boolean).length : 0}</div>
            <div class="stat-label">Файлов сегодня</div>
          </div>
          <div class="stat-item">
            <div class="stat-number">${Object.keys(dates).reduce((acc, date) => acc + dates[date].files.length, 0)}</div>
            <div class="stat-label">Всего файлов</div>
          </div>
        </div>`;
    
    if (sortedDates.length === 0) {
      html += `
      <div class="empty-state">
        <h2>📭 Архивы пусты</h2>
        <p>Пока нет сохраненных данных. Сделайте первый звонок!</p>
        <div class="call-now">
          <h3>📞 Позвоните сейчас чтобы создать архив!</h3>
          <div class="phone-number">+1 (503) 444-8881</div>
          <p>После звонка данные появятся здесь автоматически!</p>
          <p style="margin-top: 20px; font-size: 14px;">
            <strong>Как тестировать:</strong><br>
            1. Позвоните на номер выше<br>
            2. Выберите любую опцию (1, 2, 3, 4 или 7)<br>
            3. Обновите эту страницу через 10 секунд<br>
            4. Данные появятся в архиве!
          </p>
        </div>
      </div>`;
    } else {
      html += `<h2 style="color: #333; margin-bottom: 20px;">📅 Доступные архивы (${sortedDates.length} дней):</h2>`;
      
      sortedDates.forEach(date => {
        const isToday = date === today;
        const formattedDate = new Date(date + 'T00:00:00').toLocaleDateString('en-US', {
          weekday: 'long',
          year: 'numeric',
          month: 'long',
          day: 'numeric'
        });
        
        html += `
        <div class="date-card ${isToday ? 'today' : ''}">
          <div class="date-title">
            <h3>${formattedDate}</h3>
            ${isToday ? '<span class="today-badge">СЕГОДНЯ</span>' : ''}
          </div>
          <div class="logs-badges">
            ${dates[date].calls ? '<span class="badge calls">📞 Звонки</span>' : ''}
            ${dates[date].appointments ? '<span class="badge appointments">📅 Записи</span>' : ''}
            ${dates[date].ai ? '<span class="badge ai">🤖 AI разговоры</span>' : ''}
            ${dates[date].reminders ? '<span class="badge reminders">⏰ Напоминания</span>' : ''}
          </div>
          <div class="actions">
            ${dates[date].calls ? `
            <a href="/archive-details/${date}/calls" class="btn btn-details">
              👁️ Просмотреть звонки
            </a>
            <a href="/daily-archives/${date}/calls/download" class="btn btn-download">
              💾 Скачать звонки
            </a>` : ''}
            
            ${dates[date].appointments ? `
            <a href="/archive-details/${date}/appointments" class="btn btn-details">
              👁️ Просмотреть записи
            </a>` : ''}
            
            ${dates[date].ai ? `
            <a href="/archive-details/${date}/ai" class="btn btn-details">
              👁️ Просмотреть AI
            </a>` : ''}
          </div>
        </div>`;
      });
      
      if (!dates[today]) {
        html += `
        <div class="call-now">
          <h3>📞 Нет данных за сегодня (${today})</h3>
          <p>Позвоните сейчас чтобы создать архив за сегодня!</p>
          <div class="phone-number">+1 (503) 444-8881</div>
          <p style="margin-top: 10px; font-size: 14px;">
            <strong>Тестовый звонок:</strong><br>
            • Нажмите 1 → Записаться на встречу<br>
            • Нажмите 2 → Поговорить с представителем<br>
            • Нажмите 7 → Креативный директор<br>
            • Данные сохранятся автоматически!
          </p>
        </div>`;
      }
    }
    
    html += `
      <div style="margin-top: 30px; padding: 20px; background: #f8f9fa; border-radius: 10px;">
        <h3 style="color: #333; margin-top: 0;">ℹ️ Как пользоваться архивом:</h3>
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 15px; margin-top: 15px;">
          <div style="background: white; padding: 15px; border-radius: 8px; border-left: 4px solid #007bff;">
            <strong>1. 📞 Сделайте звонок</strong>
            <p style="margin: 5px 0 0 0; color: #666; font-size: 14px;">Позвоните на +1 (503) 444-8881</p>
          </div>
          <div style="background: white; padding: 15px; border-radius: 8px; border-left: 4px solid #28a745;">
            <strong>2. 🎯 Выберите опцию</strong>
            <p style="margin: 5px 0 0 0; color: #666; font-size: 14px;">Любая опция (1,2,3,4,7) создаст запись</p>
          </div>
          <div style="background: white; padding: 15px; border-radius: 8px; border-left: 4px solid #ffc107;">
            <strong>3. 🔄 Обновите страницу</strong>
            <p style="margin: 5px 0 0 0; color: #666; font-size: 14px;">Через 10 секунд после звонка</p>
          </div>
          <div style="background: white; padding: 15px; border-radius: 8px; border-left: 4px solid #dc3545;">
            <strong>4. 📊 Просмотрите данные</strong>
            <p style="margin: 5px 0 0 0; color: #666; font-size: 14px;">Нажмите "Просмотреть" на нужной дате</p>
          </div>
        </div>
      </div>
      
      <div style="margin-top: 20px; text-align: center; padding-top: 20px; border-top: 1px solid #eee;">
        <a href="/" style="color: #667eea; text-decoration: none; font-weight: bold;">← Вернуться на главную</a>
        <span style="margin: 0 10px; color: #ccc;">|</span>
        <a href="/debug" style="color: #667eea; text-decoration: none;">Debug информация</a>
      </div>
    </div>
  </body>
</html>`;
    
    res.send(html);
    
  } catch (error) {
    console.error("ERROR loading archive viewer:", error);
    res.status(500).send(`
      <html>
        <body style="font-family: Arial; padding: 20px;">
          <h1>❌ Ошибка загрузки архива</h1>
          <p>${error.message}</p>
          <a href="/" style="color: blue;">Вернуться на главную</a>
        </body>
      </html>
    `);
  }
});

// КРАСИВЫЙ ДЕТАЛЬНЫЙ ПРОСМОТР АРХИВА
app.get('/archive-details/:date/:type', (req, res) => {
  const { date, type } = req.params;
  
  try {
    const filePath = `${DAILY_LOGS_DIR}/${type}-${date}.json`;
    
    if (!fs.existsSync(filePath)) {
      return res.send(`
        <html>
          <body style="font-family: Arial; padding: 20px;">
            <h1>📭 Файл не найден</h1>
            <p>Архив ${type} за ${date} не существует.</p>
            <p><a href="/archive-viewer">← Вернуться к архивам</a></p>
          </body>
        </html>
      `);
    }
    
    const data = fs.readFileSync(filePath, "utf8");
    const logs = JSON.parse(data || '[]');
    
    const typeNames = {
      'calls': '📞 Звонки',
      'appointments': '📅 Записи на встречи',
      'ai': '🤖 AI разговоры',
      'reminders': '⏰ Напоминания'
    };
    
    const typeName = typeNames[type] || type;
    
    let html = `
    <!DOCTYPE html>
    <html>
    <head>
      <title>${typeName} - ${date}</title>
      <style>
        body { 
          font-family: 'Arial', sans-serif; 
          padding: 20px; 
          max-width: 1400px; 
          margin: 0 auto; 
          background: #f5f5f5;
        }
        .header {
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          color: white;
          padding: 25px;
          border-radius: 10px;
          margin-bottom: 20px;
        }
        .back-btn {
          display: inline-block;
          background: rgba(255,255,255,0.2);
          color: white;
          padding: 8px 15px;
          border-radius: 5px;
          text-decoration: none;
          margin-bottom: 15px;
          font-weight: bold;
        }
        .back-btn:hover {
          background: rgba(255,255,255,0.3);
        }
        .stats {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
          gap: 15px;
          margin-bottom: 30px;
        }
        .stat-card {
          background: white;
          padding: 20px;
          border-radius: 10px;
          text-align: center;
          box-shadow: 0 3px 10px rgba(0,0,0,0.1);
        }
        .stat-number {
          font-size: 32px;
          font-weight: bold;
          color: #667eea;
          margin-bottom: 5px;
        }
        .stat-label {
          color: #666;
          font-size: 14px;
        }
        .log-table {
          width: 100%;
          background: white;
          border-radius: 10px;
          overflow: hidden;
          box-shadow: 0 3px 10px rgba(0,0,0,0.1);
          margin-bottom: 20px;
        }
        .log-table th {
          background: #f8f9fa;
          padding: 15px;
          text-align: left;
          font-weight: bold;
          color: #333;
          border-bottom: 2px solid #dee2e6;
        }
        .log-table td {
          padding: 15px;
          border-bottom: 1px solid #eee;
          vertical-align: top;
        }
        .log-table tr:hover {
          background: #f8f9fa;
        }
        .phone-cell {
          font-family: monospace;
          font-weight: bold;
          color: #007bff;
        }
        .action-cell {
          padding: 3px 8px;
          border-radius: 3px;
          font-size: 12px;
          font-weight: bold;
        }
        .CALL_RECEIVED { background: #28a745; color: white; }
        .APPOINTMENT_SCHEDULED { background: #17a2b8; color: white; }
        .REPRESENTATIVE_SELECTED { background: #ffc107; color: black; }
        .default-action { background: #6c757d; color: white; }
        .pagination {
          display: flex;
          justify-content: center;
          gap: 10px;
          margin-top: 20px;
        }
        .page-btn {
          padding: 8px 15px;
          background: #667eea;
          color: white;
          border: none;
          border-radius: 5px;
          cursor: pointer;
          text-decoration: none;
          display: inline-block;
        }
        .page-btn:hover {
          background: #5a67d8;
        }
        .search-box {
          margin-bottom: 20px;
          padding: 15px;
          background: white;
          border-radius: 10px;
          box-shadow: 0 3px 10px rgba(0,0,0,0.1);
        }
        .search-input {
          width: 100%;
          padding: 12px;
          border: 2px solid #dee2e6;
          border-radius: 5px;
          font-size: 16px;
          margin-bottom: 10px;
        }
        .search-input:focus {
          outline: none;
          border-color: #667eea;
        }
        .export-btn {
          display: inline-block;
          background: #28a745;
          color: white;
          padding: 10px 20px;
          border-radius: 5px;
          text-decoration: none;
          font-weight: bold;
          margin-top: 10px;
        }
        .export-btn:hover {
          background: #218838;
        }
        @media (max-width: 768px) {
          .log-table { font-size: 14px; }
          .log-table th, .log-table td { padding: 10px; }
          .stats { grid-template-columns: 1fr; }
        }
      </style>
    </head>
    <body>
      <div class="header">
        <a href="/archive-viewer" class="back-btn">← Назад к архивам</a>
        <h1>${typeName}</h1>
        <p>Дата: ${date} | Всего записей: ${logs.length}</p>
      </div>
      
      <div class="stats">
        <div class="stat-card">
          <div class="stat-number">${logs.length}</div>
          <div class="stat-label">Всего записей</div>
        </div>
        
        ${type === 'calls' ? `
        <div class="stat-card">
          <div class="stat-number">${new Set(logs.map(l => l.phone)).size}</div>
          <div class="stat-label">Уникальных номеров</div>
        </div>
        ` : ''}
        
        ${type === 'appointments' ? `
        <div class="stat-card">
          <div class="stat-number">${new Set(logs.map(l => l.name)).size}</div>
          <div class="stat-label">Уникальных клиентов</div>
        </div>
        ` : ''}
        
        <div class="stat-card">
          <div class="stat-number">${logs.length > 0 ? new Date(logs[logs.length-1].timestamp).toLocaleTimeString() : 'Нет'}</div>
          <div class="stat-label">Последняя запись</div>
        </div>
      </div>
      
      <div class="search-box">
        <input type="text" class="search-input" placeholder="🔍 Поиск по номеру телефона, имени или действию..." 
               onkeyup="filterTable()" id="searchInput">
        <div style="font-size: 14px; color: #666; margin-top: 5px;">
          Найдено записей: <span id="recordCount">${logs.length}</span>
        </div>
        <a href="/daily-archives/${date}/${type}/download" class="export-btn">💾 Скачать JSON файл</a>
      </div>`;
    
    if (logs.length === 0) {
      html += `
      <div style="text-align: center; padding: 50px; background: white; border-radius: 10px;">
        <h3>📭 Нет данных</h3>
        <p>В этом архиве пока нет записей.</p>
      </div>`;
    } else {
      html += `
      <div class="log-table">
        <table style="width: 100%; border-collapse: collapse;">
          <thead>
            <tr>
              ${type === 'calls' ? `
              <th>Телефон</th>
              <th>Действие</th>
              <th>Время (PST)</th>
              <th>Детали</th>
              ` : ''}
              
              ${type === 'appointments' ? `
              <th>Имя</th>
              <th>Телефон</th>
              <th>Тип бизнеса</th>
              <th>Услуга</th>
              <th>Дата встречи</th>
              <th>Время</th>
              ` : ''}
              
              ${type === 'ai' ? `
              <th>Телефон</th>
              <th>Вопрос</th>
              <th>Ответ AI</th>
              <th>Время</th>
              ` : ''}
              
              ${type === 'reminders' ? `
              <th>Телефон</th>
              <th>Действие</th>
              <th>Имя клиента</th>
              <th>Дата встречи</th>
              <th>Время встречи</th>
              ` : ''}
            </tr>
          </thead>
          <tbody id="logTableBody">`;
      
      // Показываем только первые 50 записей для производительности
      const displayLogs = logs.slice(0, 50);
      
      displayLogs.forEach((log, index) => {
        if (type === 'calls') {
          const actionClass = log.action ? `action-cell ${log.action}` : 'action-cell default-action';
          html += `
          <tr>
            <td class="phone-cell">${log.phone || 'N/A'}</td>
            <td><span class="${actionClass}">${log.action || 'N/A'}</span></td>
            <td>${log.time || log.timestamp || 'N/A'}</td>
            <td>
              ${log.details ? `
              <div style="font-size: 12px; color: #666;">
                ${log.details.name ? `<strong>Имя:</strong> ${log.details.name}<br>` : ''}
                ${log.details.businessType ? `<strong>Бизнес:</strong> ${log.details.businessType}<br>` : ''}
                ${log.details.serviceType ? `<strong>Услуга:</strong> ${log.details.serviceType}<br>` : ''}
                ${log.details.date ? `<strong>Дата:</strong> ${log.details.date}<br>` : ''}
              </div>
              ` : 'N/A'}
            </td>
          </tr>`;
        }
        
        else if (type === 'appointments') {
          html += `
          <tr>
            <td><strong>${log.name || 'N/A'}</strong></td>
            <td class="phone-cell">${log.phone || 'N/A'}</td>
            <td>${log.businessType || 'N/A'}</td>
            <td>${log.serviceType || 'N/A'}</td>
            <td>${log.date || 'N/A'}</td>
            <td>${log.time || 'N/A'}</td>
          </tr>`;
        }
        
        else if (type === 'ai') {
          html += `
          <tr>
            <td class="phone-cell">${log.phone || 'N/A'}</td>
            <td><strong>${log.question ? log.question.substring(0, 50) + (log.question.length > 50 ? '...' : '') : 'N/A'}</strong></td>
            <td>${log.response ? log.response.substring(0, 70) + (log.response.length > 70 ? '...' : '') : 'N/A'}</td>
            <td>${log.time || 'N/A'}</td>
          </tr>`;
        }
        
        else if (type === 'reminders') {
          html += `
          <tr>
            <td class="phone-cell">${log.phone || 'N/A'}</td>
            <td><span class="action-cell ${log.action || 'default-action'}">${log.action || 'N/A'}</span></td>
            <td>${log.appointment?.name || 'N/A'}</td>
            <td>${log.appointment?.date || 'N/A'}</td>
            <td>${log.appointment?.time || 'N/A'}</td>
          </tr>`;
        }
      });
      
      html += `
          </tbody>
        </table>
      </div>`;
      
      if (logs.length > 50) {
        html += `
        <div style="text-align: center; padding: 15px; background: white; border-radius: 10px; margin-top: 10px;">
          <p>Показано 50 из ${logs.length} записей</p>
          <a href="/daily-archives/${date}/${type}/download" class="export-btn">
            💾 Скачать полные данные (${logs.length} записей)
          </a>
        </div>`;
      }
    }
    
    html += `
      <script>
        function filterTable() {
          const input = document.getElementById('searchInput');
          const filter = input.value.toLowerCase();
          const rows = document.querySelectorAll('#logTableBody tr');
          let visibleCount = 0;
          
          rows.forEach(row => {
            const text = row.textContent.toLowerCase();
            if (text.includes(filter)) {
              row.style.display = '';
              visibleCount++;
            } else {
              row.style.display = 'none';
            }
          });
          
          document.getElementById('recordCount').textContent = visibleCount;
        }
        
        // Автоматически фильтруем если есть параметр поиска в URL
        const urlParams = new URLSearchParams(window.location.search);
        const searchQuery = urlParams.get('search');
        if (searchQuery) {
          document.getElementById('searchInput').value = searchQuery;
          filterTable();
        }
      </script>
      
      <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #eee; text-align: center;">
        <a href="/archive-viewer" class="page-btn">← Назад к архивам</a>
        <a href="/" style="margin-left: 10px;" class="page-btn">🏠 На главную</a>
      </div>
    </body>
  </html>`;
    }
    
    res.send(html);
    
  } catch (error) {
    console.error(`ERROR loading archive details for ${type} on ${date}:`, error);
    res.status(500).send(`
      <html>
        <body style="font-family: Arial; padding: 20px;">
          <h1>❌ Ошибка загрузки архива</h1>
          <p>${error.message}</p>
          <a href="/archive-viewer">← Вернуться к архивам</a>
        </body>
      </html>
    `);
  }
});

// ОБНОВЛЯЕМ ГЛАВНУЮ СТРАНИЦУ
app.get('/', (req, res) => {
  const businessStatus = getBusinessStatus();
  const today = new Date().toISOString().split('T')[0];
  
  let archiveStats = { totalDates: 0, hasToday: false };
  try {
    if (fs.existsSync(DAILY_LOGS_DIR)) {
      const files = fs.readdirSync(DAILY_LOGS_DIR);
      const dates = new Set();
      files.forEach(file => {
        if (file.includes('-')) {
          const date = file.split('-').slice(1, 4).join('-').replace('.json', '');
          dates.add(date);
          if (date === today) archiveStats.hasToday = true;
        }
      });
      archiveStats.totalDates = dates.size;
    }
  } catch (error) {
    console.error("ERROR loading archive stats:", error);
  }
  
  res.send(`
    <html>
      <head>
        <title>Altair Partners IVR Server</title>
        <style>
          body { 
            font-family: 'Arial', sans-serif; 
            padding: 20px; 
            max-width: 1200px; 
            margin: 0 auto; 
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
          }
          .container {
            background: white;
            border-radius: 15px;
            padding: 30px;
            box-shadow: 0 10px 30px rgba(0,0,0,0.2);
          }
          .status {
            padding: 20px;
            border-radius: 10px;
            margin: 20px 0;
            border: 2px solid transparent;
          }
          .open { 
            background: linear-gradient(135deg, #d4edda 0%, #c3e6cb 100%);
            border-color: #28a745;
            color: #155724;
          }
          .closed { 
            background: linear-gradient(135deg, #f8d7da 0%, #f5c6cb 100%);
            border-color: #dc3545;
            color: #721c24;
          }
          .status-icon {
            font-size: 24px;
            margin-right: 10px;
          }
          .dashboard {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
            gap: 20px;
            margin: 30px 0;
          }
          .card {
            background: white;
            border-radius: 10px;
            padding: 25px;
            box-shadow: 0 5px 15px rgba(0,0,0,0.1);
            border-top: 5px solid #667eea;
            transition: all 0.3s;
          }
          .card:hover {
            transform: translateY(-5px);
            box-shadow: 0 10px 20px rgba(0,0,0,0.15);
          }
          .card h3 {
            margin-top: 0;
            color: #333;
            display: flex;
            align-items: center;
            gap: 10px;
          }
          .card-icon {
            font-size: 24px;
          }
          .btn {
            display: inline-block;
            padding: 12px 25px;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            text-decoration: none;
            border-radius: 8px;
            font-weight: bold;
            margin-top: 15px;
            transition: all 0.3s;
            border: none;
            cursor: pointer;
          }
          .btn:hover {
            transform: translateY(-2px);
            box-shadow: 0 5px 15px rgba(102, 126, 234, 0.4);
          }
          .btn-secondary {
            background: #6c757d;
          }
          .btn-success {
            background: #28a745;
          }
          .btn-danger {
            background: #dc3545;
          }
          .stats-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
            gap: 15px;
            margin: 20px 0;
          }
          .stat-box {
            background: #f8f9fa;
            padding: 15px;
            border-radius: 8px;
            text-align: center;
          }
          .stat-number {
            font-size: 28px;
            font-weight: bold;
            color: #667eea;
          }
          .stat-label {
            font-size: 14px;
            color: #666;
            margin-top: 5px;
          }
          .call-box {
            background: linear-gradient(135deg, #28a745 0%, #20c997 100%);
            color: white;
            padding: 25px;
            border-radius: 10px;
            text-align: center;
            margin: 30px 0;
            box-shadow: 0 5px 15px rgba(40, 167, 69, 0.3);
          }
          .phone-number {
            font-size: 36px;
            font-weight: bold;
            margin: 15px 0;
            letter-spacing: 2px;
          }
          .menu-options {
            background: #f8f9fa;
            padding: 20px;
            border-radius: 10px;
            margin: 20px 0;
          }
          .menu-item {
            display: flex;
            align-items: center;
            padding: 12px;
            border-bottom: 1px solid #dee2e6;
          }
          .menu-item:last-child {
            border-bottom: none;
          }
          .menu-key {
            background: #667eea;
            color: white;
            width: 30px;
            height: 30px;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            font-weight: bold;
            margin-right: 15px;
          }
          @media (max-width: 768px) {
            .container { padding: 15px; }
            .phone-number { font-size: 28px; }
            .dashboard { grid-template-columns: 1fr; }
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div style="text-align: center; margin-bottom: 30px;">
            <h1 style="color: #333; margin-bottom: 10px;">✅ Altair Partners IVR Server</h1>
            <p style="color: #666;">Professional Phone System with AI Assistant</p>
          </div>
          
          <div class="status ${businessStatus.isOpen ? 'open' : 'closed'}">
            <div style="display: flex; align-items: center; justify-content: space-between;">
              <div>
                <h2 style="margin: 0; display: flex; align-items: center;">
                  <span class="status-icon">${businessStatus.isOpen ? '🟢' : '🔴'}</span>
                  Status: ${businessStatus.isOpen ? 'OPEN' : 'CLOSED'}
                </h2>
                <p style="margin: 10px 0 0 0;">
                  <strong>Current Time (PST):</strong> ${businessStatus.currentTime}<br>
                  <strong>Business Hours:</strong> ${businessStatus.hours}<br>
                  <strong>Location:</strong> ${businessStatus.location}
                </p>
              </div>
              <div style="font-size: 18px; font-weight: bold;">
                ${businessStatus.isOpen ? '✅ Currently open' : '⏰ ' + businessStatus.nextOpenTime}
              </div>
            </div>
          </div>
          
          <div class="call-box">
            <h2 style="margin-top: 0; color: white;">📞 Test the System Now!</h2>
            <div class="phone-number">+1 (503) 444-8881</div>
            <p>Call this number to test the IVR system</p>
            <div style="display: flex; gap: 10px; justify-content: center; margin-top: 15px;">
              <a href="tel:+15034448881" class="btn">📱 Call Now</a>
              <a href="/test-reminder?phone=+15034448881" class="btn btn-secondary">🔔 Test Reminder</a>
            </div>
          </div>
          
          <div class="stats-grid">
            <div class="stat-box">
              <div class="stat-number">${archiveStats.totalDates}</div>
              <div class="stat-label">Days in Archive</div>
            </div>
            <div class="stat-box">
              <div class="stat-number">${archiveStats.hasToday ? '✅' : '📭'}</div>
              <div class="stat-label">Today's Data</div>
            </div>
            <div class="stat-box">
              <div class="stat-number">24/7</div>
              <div class="stat-label">System Uptime</div>
            </div>
            <div class="stat-box">
              <div class="stat-number">🤖 AI</div>
              <div class="stat-label">Assistant Ready</div>
            </div>
          </div>
          
          <div class="dashboard">
            <div class="card">
              <h3><span class="card-icon">📊</span> Archive Viewer</h3>
              <p>View all call logs, appointments, AI conversations, and reminders by date.</p>
              <a href="/archive-viewer" class="btn">📁 Open Archive Viewer</a>
            </div>
            
            <div class="card">
              <h3><span class="card-icon">🔧</span> System Debug</h3>
              <p>Check system status, view current logs, and monitor performance.</p>
              <a href="/debug" class="btn btn-secondary">⚙️ Open Debug Panel</a>
            </div>
            
            <div class="card">
              <h3><span class="card-icon">📞</span> Call Logs</h3>
              <p>View real-time call logs and caller information.</p>
              <a href="/logs" class="btn">📝 View Call Logs</a>
            </div>
            
            <div class="card">
              <h3><span class="card-icon">📅</span> Appointments</h3>
              <p>Manage scheduled appointments and view booking history.</p>
              <a href="/appointments" class="btn">📋 View Appointments</a>
            </div>
          </div>
          
          <div class="menu-options">
            <h3 style="color: #333; margin-top: 0;">🎯 IVR Menu Options:</h3>
            <div class="menu-item">
              <div class="menu-key">1</div>
              <div>
                <strong>Schedule Appointment</strong>
                <div style="font-size: 14px; color: #666;">Book a meeting with our team</div>
              </div>
            </div>
            <div class="menu-item">
              <div class="menu-key">2</div>
              <div>
                <strong>Speak with Representative</strong>
                <div style="font-size: 14px; color: #666;">AI-powered quick assistant</div>
              </div>
            </div>
            <div class="menu-item">
              <div class="menu-key">3</div>
              <div>
                <strong>Request Callback</strong>
                <div style="font-size: 14px; color: #666;">We'll call you back</div>
              </div>
            </div>
            <div class="menu-item">
              <div class="menu-key">4</div>
              <div>
                <strong>Partnership Opportunities</strong>
                <div style="font-size: 14px; color: #666;">Business collaborations</div>
              </div>
            </div>
            <div class="menu-item">
              <div class="menu-key">7</div>
              <div>
                <strong>Creative Director</strong>
                <div style="font-size: 14px; color: #666;">Talk to our creative team</div>
              </div>
            </div>
          </div>
          
          <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #eee; text-align: center;">
            <p style="color: #666; margin-bottom: 15px;">
              <strong>System Features:</strong> 
              🤖 AI Assistant • 📦 Instant Archive • ⏰ Smart Reminders • 📱 SMS Notifications
            </p>
            <div style="display: flex; gap: 10px; justify-content: center; flex-wrap: wrap;">
              <a href="/business-status" class="btn btn-secondary">🏢 Business Status</a>
              <a href="/conversations" class="btn btn-secondary">🤖 AI Conversations</a>
              <a href="/reminders" class="btn btn-secondary">⏰ Reminder Logs</a>
              <a href="/health" class="btn btn-success">❤️ Health Check</a>
            </div>
          </div>
        </div>
      </body>
    </html>
  `);
});

// ОСТАЛЬНЫЕ ENDPOINTS (кратко для экономии места)
app.get('/health', (req, res) => {
  res.status(200).send('✅ IVR Server is running');
});

app.get('/debug', (req, res) => {
  const appointments = loadDB();
  const businessStatus = getBusinessStatus();
  
  res.json({
    status: 'running',
    businessStatus,
    appointments: { total: appointments.length },
    systemInfo: {
      archiveMode: 'INSTANT',
      serverTime: new Date().toISOString(),
      uptime: process.uptime()
    }
  });
});

app.get('/logs', (req, res) => {
  try {
    let callLogs = [];
    if (fs.existsSync(CALL_LOGS_PATH)) {
      const logsData = fs.readFileSync(CALL_LOGS_PATH, "utf8");
      callLogs = JSON.parse(logsData || '[]');
    }
    
    res.json({
      total: callLogs.length,
      logs: callLogs.reverse(),
      note: "This is current logs. Daily archives at /archive-viewer"
    });
  } catch (error) {
    res.status(500).json({ error: "Failed to load logs" });
  }
});

app.get('/appointments', (req, res) => {
  const appointments = loadDB();
  res.json({
    total: appointments.length,
    appointments: appointments.reverse()
  });
});

app.get('/conversations', (req, res) => {
  try {
    let aiConversations = [];
    if (fs.existsSync(AI_CONVERSATIONS_PATH)) {
      const convData = fs.readFileSync(AI_CONVERSATIONS_PATH, "utf8");
      aiConversations = JSON.parse(convData || '[]');
    }
    
    res.json({
      total: aiConversations.length,
      conversations: aiConversations.reverse()
    });
  } catch (error) {
    res.status(500).json({ error: "Failed to load conversations" });
  }
});

app.get('/reminders', (req, res) => {
  try {
    let reminderLogs = [];
    if (fs.existsSync(REMINDERS_LOG)) {
      const remData = fs.readFileSync(REMINDERS_LOG, "utf8");
      reminderLogs = JSON.parse(remData || '[]');
    }
    
    res.json({
      total: reminderLogs.length,
      reminders: reminderLogs.reverse()
    });
  } catch (error) {
    res.status(500).json({ error: "Failed to load reminders" });
  }
});

// ОБНОВЛЯЕМ ДРУГИЕ ENDPOINTS ДЛЯ КРАСИВОГО ИНТЕРФЕЙСА
app.get('/daily-archives', (req, res) => {
  res.redirect('/archive-viewer');
});

// ======================================================
// START SERVER
// ======================================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  const businessStatus = getBusinessStatus();
  const serverUrl = process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`;
  
  console.log(`🚀 Altair Partners IVR Server running on port ${PORT}`);
  console.log(`⏰ Business Status: ${businessStatus.isOpen ? 'OPEN' : 'CLOSED'}`);
  console.log(`🕐 Current Time (PST): ${businessStatus.currentTime}`);
  console.log(`🌐 Server URL: ${serverUrl}`);
  console.log(`✅ Health check: ${serverUrl}/health`);
  console.log(`📊 Archive Viewer: ${serverUrl}/archive-viewer`);
  console.log(`🔧 Debug Panel: ${serverUrl}/debug`);
  console.log(`📞 Test Number: +1 (503) 444-8881`);
  console.log(`📦 INSTANT ARCHIVE SYSTEM: Все данные сохраняются сразу!`);
  console.log(`🤖 AI Assistant: Ready (fast mode)`);
  console.log(`⏰ Reminder System: Active (checks every 5 minutes)`);
  console.log(`💾 Self-ping: ${process.env.FREE_PLAN === 'true' ? 'Active' : 'Inactive'}`);
  
  startReminderScheduler();
  console.log(`✅ SYSTEM READY - Все звонки будут сохраняться в красивый архив!`);
});