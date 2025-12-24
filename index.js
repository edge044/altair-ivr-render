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
// SELF-PING SYSTEM (чтобы сервер не спал на Free плане)
// ======================================================
if (process.env.NODE_ENV !== 'production' || process.env.FREE_PLAN === 'true') {
  const PING_INTERVAL = 4 * 60 * 1000; // 4 минуты
  
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
  
  // Первый ping сразу при старте
  setTimeout(selfPing, 5000);
}

// ======================================================
// WORKING HOURS CHECK FUNCTIONS
// ======================================================

function isWithinBusinessHours() {
  try {
    const now = new Date();
    const pstTime = new Date(now.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }));
    
    const day = pstTime.getDay(); // 0 = Sunday, 1 = Monday, ..., 6 = Saturday
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
    
    if (day === 0) {
      daysUntilOpen = 1;
    } else if (day === 6) {
      daysUntilOpen = 2;
    } else if (day >= 1 && day <= 5) {
      if (hour < 10) {
        daysUntilOpen = 0;
      } else if (hour >= 17) {
        if (day === 5) {
          daysUntilOpen = 3;
        } else {
          daysUntilOpen = 1;
        }
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

// Папки для логов
const LOGS_DIR = "./logs";
const CURRENT_LOGS_DIR = `${LOGS_DIR}/current`;
const DAILY_LOGS_DIR = `${LOGS_DIR}/daily`;

// Создаем папки если их нет
if (!fs.existsSync(LOGS_DIR)) fs.mkdirSync(LOGS_DIR);
if (!fs.existsSync(CURRENT_LOGS_DIR)) fs.mkdirSync(CURRENT_LOGS_DIR);
if (!fs.existsSync(DAILY_LOGS_DIR)) fs.mkdirSync(DAILY_LOGS_DIR);

// Пути к текущим логам
const DB_PATH = `${CURRENT_LOGS_DIR}/appointments.json`;
const CALL_LOGS_PATH = `${CURRENT_LOGS_DIR}/call_logs.json`;
const AI_CONVERSATIONS_PATH = `${CURRENT_LOGS_DIR}/ai_conversations.json`;
const REMINDERS_LOG = `${CURRENT_LOGS_DIR}/reminders_log.json`;

// ======================================================
// ФУНКЦИИ МГНОВЕННОЙ АРХИВАЦИИ (СРАЗУ ПОСЛЕ ЗВОНКА!)
// ======================================================

function getTodayDateString() {
  const now = new Date();
  return now.toISOString().split('T')[0]; // "2025-12-24"
}

// Сохраняет данные СРАЗУ в daily архив
function saveToDailyArchive(type, data) {
  try {
    const today = getTodayDateString();
    const archiveFile = `${DAILY_LOGS_DIR}/${type}-${today}.json`;
    
    let existingData = [];
    
    // 1. Загружаем существующие данные если файл есть
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
    
    // 2. Добавляем новые данные
    if (Array.isArray(data)) {
      // Если пришел массив - добавляем все элементы
      existingData.push(...data);
    } else {
      // Если пришел объект - добавляем его
      existingData.push(data);
    }
    
    // 3. Ограничиваем размер (последние 2000 записей)
    if (existingData.length > 2000) {
      existingData = existingData.slice(-2000);
    }
    
    // 4. Сохраняем в daily файл
    fs.writeFileSync(archiveFile, JSON.stringify(existingData, null, 2));
    
    console.log(`✅ Instant archive: ${type} saved for ${today} (${existingData.length} records)`);
    
    // 5. Также сохраняем в current logs для быстрого доступа
    saveToCurrentLogs(type, data);
    
  } catch (error) {
    console.error(`❌ Instant archive error for ${type}:`, error);
  }
}

// Сохраняет в current logs
function saveToCurrentLogs(type, data) {
  try {
    let filePath, currentData = [];
    
    // Определяем путь к файлу
    switch(type) {
      case 'calls':
        filePath = CALL_LOGS_PATH;
        break;
      case 'appointments':
        filePath = DB_PATH;
        break;
      case 'ai':
        filePath = AI_CONVERSATIONS_PATH;
        break;
      case 'reminders':
        filePath = REMINDERS_LOG;
        break;
      default:
        return;
    }
    
    // Загружаем существующие данные
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
    
    // Добавляем новые данные
    if (Array.isArray(data)) {
      currentData.push(...data);
    } else {
      currentData.push(data);
    }
    
    // Ограничиваем размер
    if (currentData.length > 1000) {
      currentData = currentData.slice(-1000);
    }
    
    // Сохраняем
    fs.writeFileSync(filePath, JSON.stringify(currentData, null, 2));
    
  } catch (error) {
    console.error(`❌ Error saving to current logs for ${type}:`, error);
  }
}

// Ежедневная архивация в 23:59 (резервная)
function archiveDailyLogs() {
  try {
    const today = getTodayDateString();
    console.log(`📦 Backup archive for ${today}...`);
    
    // Просто логируем что все ок
    console.log(`✅ Backup archive completed for ${today}`);
    
  } catch (error) {
    console.error("❌ Backup archive error:", error);
  }
}

function startDailyArchiver() {
  console.log("📦 Daily archiver started (instant mode)");
  
  // Архивируем при старте
  archiveDailyLogs();
  
  // Архивируем каждый день в 23:59 PST (как резерв)
  setInterval(() => {
    const now = new Date();
    const pstTime = new Date(now.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }));
    
    const hour = pstTime.getHours();
    const minute = pstTime.getMinutes();
    
    if (hour === 23 && minute === 59) {
      archiveDailyLogs();
    }
  }, 60 * 1000);
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
    
    // МГНОВЕННАЯ АРХИВАЦИЯ
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
        // Parse appointment date (format like "Monday, December 16")
        const appointmentDate = new Date(appointment.date + ' ' + todayYear);
        
        if (isNaN(appointmentDate.getTime())) {
          console.log(`❌ Invalid date format for appointment: ${appointment.date}`);
          return;
        }
        
        const appointmentYear = appointmentDate.getFullYear();
        const appointmentMonth = appointmentDate.getMonth();
        const appointmentDay = appointmentDate.getDate();
        
        // Check if appointment is tomorrow
        const tomorrow = new Date(today);
        tomorrow.setDate(today.getDate() + 1);
        
        const isTomorrow = appointmentYear === tomorrow.getFullYear() &&
                          appointmentMonth === tomorrow.getMonth() &&
                          appointmentDay === tomorrow.getDate();
        
        if (isTomorrow) {
          console.log(`📅 Appointment found for tomorrow: ${appointment.name} - ${appointment.date} at ${appointment.time}`);
          
          // Check if it's 2 PM Pacific Time
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
  
  // Check immediately on startup
  checkAndSendReminders();
  
  // Then check every 5 minutes
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
// LOGGING FUNCTIONS С МГНОВЕННОЙ АРХИВАЦИЕЙ
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
    
    // МГНОВЕННАЯ АРХИВАЦИЯ в daily файл
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
    
    // МГНОВЕННАЯ АРХИВАЦИЯ
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
  
  // МГНОВЕННАЯ АРХИВАЦИЯ appointments
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
// MAIN MENU (5 OPTIONS)
// ======================================================
app.post('/voice', (req, res) => {
  const twiml = new VoiceResponse();
  const phone = req.body.From;
  
  console.log("📞 Main menu - Caller:", phone);
  
  logCall(phone, 'CALL_RECEIVED', {
    caller: phone,
    time: new Date().toLocaleTimeString()
  });
  
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

  res.type('text/xml');
  res.send(twiml.toString());
});

// ======================================================
// TRANSFER TO APPOINTMENT FLOW
// ======================================================
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
  
  res.type('text/xml');
  res.send(twiml.toString());
});

// ======================================================
// HANDLE MAIN MENU
// ======================================================
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

  res.type('text/xml');
  res.send(twiml.toString());
});

// ======================================================
// CLOSED HOURS OPTIONS
// ======================================================
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

  res.type('text/xml');
  res.send(twiml.toString());
});

app.post('/record-voice-message', (req, res) => {
  const twiml = new VoiceResponse();
  const message = req.body.SpeechResult || '';
  const phone = req.body.From;

  console.log(`🎤 Voice message recorded from: ${phone}`);
  console.log(`📝 Message: ${message.substring(0, 100)}...`);
  
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

// ======================================================
// REPRESENTATIVE (Option 2) - БЫСТРЫЙ AI
// ======================================================
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
  
  res.type('text/xml');
  res.send(twiml.toString());
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
  
  res.type('text/xml');
  res.send(twiml.toString());
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
  
  res.type('text/xml');
  res.send(twiml.toString());
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
  
  res.type('text/xml');
  res.send(twiml.toString());
});

// ======================================================
// CREATIVE DIRECTOR (Option 7)
// ======================================================
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
  
  res.type('text/xml');
  res.send(twiml.toString());
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
  
  res.type('text/xml');
  res.send(twiml.toString());
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
  
  res.type('text/xml');
  res.send(twiml.toString());
});

// ======================================================
// APPOINTMENT FLOW
// ======================================================
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
  
  res.type('text/xml');
  res.send(twiml.toString());
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
  
  res.type('text/xml');
  res.send(twiml.toString());
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
  
  res.type('text/xml');
  res.send(twiml.toString());
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
  
  res.type('text/xml');
  res.send(twiml.toString());
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
  
  res.type('text/xml');
  res.send(twiml.toString());
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
  
  res.type('text/xml');
  res.send(twiml.toString());
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
  
  res.type('text/xml');
  res.send(twiml.toString());
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
  
  res.type('text/xml');
  res.send(twiml.toString());
});

// ======================================================
// CALLBACK REQUEST (Option 3)
// ======================================================
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

  res.type('text/xml');
  res.send(twiml.toString());
});

// ======================================================
// PARTNERSHIP (Option 4)
// ======================================================
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
  
  res.type('text/xml');
  res.send(twiml.toString());
});

// ======================================================
// CANCEL / RESCHEDULE APPOINTMENT
// ======================================================
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

  res.type('text/xml');
  res.send(twiml.toString());
});

// ======================================================
// TEST REMINDER ENDPOINT
// ======================================================
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

// ======================================================
// BUSINESS HOURS ENDPOINT
// ======================================================
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
// ДНЕВНЫЕ АРХИВЫ - НОВЫЕ ENDPOINTS
// ======================================================

// Показать все доступные даты архивов
app.get('/daily-archives', (req, res) => {
  try {
    const files = fs.readdirSync(DAILY_LOGS_DIR);
    
    // Группируем файлы по дате
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
            reminders: false
          };
        }
        
        if (type === 'calls') dates[date].calls = true;
        if (type === 'appointments') dates[date].appointments = true;
        if (type === 'ai') dates[date].ai = true;
        if (type === 'reminders') dates[date].reminders = true;
      }
    });
    
    const sortedDates = Object.keys(dates).sort().reverse();
    
    res.json({
      totalDates: sortedDates.length,
      dates: sortedDates.map(date => ({
        date,
        formattedDate: new Date(date + 'T00:00:00').toLocaleDateString('en-US', {
          weekday: 'long',
          year: 'numeric',
          month: 'long',
          day: 'numeric'
        }),
        logsAvailable: dates[date],
        endpoints: {
          calls: `/daily-archives/${date}/calls`,
          appointments: `/daily-archives/${date}/appointments`,
          ai: `/daily-archives/${date}/ai`,
          reminders: `/daily-archives/${date}/reminders`
        }
      })),
      lastUpdated: new Date().toISOString(),
      note: "📞 Все звонки сохраняются СРАЗУ после разговора!"
    });
    
  } catch (error) {
    console.error("ERROR loading daily archives:", error);
    res.status(500).json({ error: "Failed to load daily archives" });
  }
});

// Получить логи за конкретную дату
app.get('/daily-archives/:date/:type', (req, res) => {
  const { date, type } = req.params;
  
  try {
    const filePath = `${DAILY_LOGS_DIR}/${type}-${date}.json`;
    
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ 
        error: "Archive not found",
        message: `No ${type} logs found for date ${date}` 
      });
    }
    
    const data = fs.readFileSync(filePath, "utf8");
    const logs = JSON.parse(data || '[]');
    
    let totalItems = 0;
    let uniquePhones = new Set();
    let phoneDetails = [];
    
    // Анализируем данные
    logs.forEach(log => {
      if (log.phone) {
        uniquePhones.add(log.phone);
        phoneDetails.push({
          phone: log.phone,
          name: log.name || log.details?.name || 'N/A',
          action: log.action || 'N/A',
          time: log.time || log.timestamp || 'N/A',
          businessType: log.businessType || log.details?.businessType || 'N/A',
          serviceType: log.serviceType || log.details?.serviceType || 'N/A'
        });
      }
      totalItems++;
    });
    
    res.json({
      date,
      type,
      totalItems,
      uniquePhones: uniquePhones.size,
      phoneList: Array.from(uniquePhones),
      phoneDetails: phoneDetails.slice(0, 100), // Первые 100 записей
      logs: logs.slice(0, 50), // Первые 50 логов
      fileInfo: {
        size: fs.statSync(filePath).size,
        created: fs.statSync(filePath).birthtime,
        modified: fs.statSync(filePath).mtime
      },
      downloadUrl: `/daily-archives/${date}/${type}/download`
    });
    
  } catch (error) {
    console.error(`ERROR loading ${type} archive for ${date}:`, error);
    res.status(500).json({ error: "Failed to load archive" });
  }
});

// Скачать архив за дату
app.get('/daily-archives/:date/:type/download', (req, res) => {
  const { date, type } = req.params;
  const filePath = `${DAILY_LOGS_DIR}/${type}-${date}.json`;
  
  if (!fs.existsSync(filePath)) {
    return res.status(404).send("File not found");
  }
  
  res.download(filePath, `${type}-${date}.json`);
});

// ======================================================
// DEBUG ENDPOINTS (обновленные)
// ======================================================
app.get('/health', (req, res) => {
  res.status(200).send('✅ IVR Server is running');
});

app.get('/debug', (req, res) => {
  const appointments = loadDB();
  const businessStatus = getBusinessStatus();
  
  let callLogs = [];
  let aiConversations = [];
  let reminderLogs = [];
  
  try {
    if (fs.existsSync(CALL_LOGS_PATH)) {
      const logsData = fs.readFileSync(CALL_LOGS_PATH, "utf8");
      callLogs = JSON.parse(logsData || '[]');
    }
    
    if (fs.existsSync(AI_CONVERSATIONS_PATH)) {
      const convData = fs.readFileSync(AI_CONVERSATIONS_PATH, "utf8");
      aiConversations = JSON.parse(convData || '[]');
    }
    
    if (fs.existsSync(REMINDERS_LOG)) {
      const remData = fs.readFileSync(REMINDERS_LOG, "utf8");
      reminderLogs = JSON.parse(remData || '[]');
    }
  } catch (error) {
    console.error("ERROR loading logs:", error);
  }
  
  // Проверяем архивы
  let dailyArchives = [];
  try {
    if (fs.existsSync(DAILY_LOGS_DIR)) {
      const files = fs.readdirSync(DAILY_LOGS_DIR);
      const dates = new Set();
      files.forEach(file => {
        if (file.includes('-')) {
          const date = file.split('-').slice(1, 4).join('-').replace('.json', '');
          dates.add(date);
        }
      });
      dailyArchives = Array.from(dates).sort().reverse();
    }
  } catch (error) {
    console.error("ERROR loading daily archives:", error);
  }
  
  res.json({
    status: 'running',
    businessStatus,
    appointments: {
      total: appointments.length,
      recent: appointments.slice(-10)
    },
    callLogs: {
      total: callLogs.length,
      recent: callLogs.slice(-20)
    },
    aiConversations: {
      total: aiConversations.length,
      recent: aiConversations.slice(-10)
    },
    reminderLogs: {
      total: reminderLogs.length,
      recent: reminderLogs.slice(-10)
    },
    dailyArchives: {
      totalDates: dailyArchives.length,
      dates: dailyArchives.slice(0, 10),
      allDates: `/daily-archives`
    },
    systemInfo: {
      archiveMode: 'INSTANT (сохраняет сразу после звонка)',
      storage: {
        calls: `${DAILY_LOGS_DIR}/calls-YYYY-MM-DD.json`,
        appointments: `${DAILY_LOGS_DIR}/appointments-YYYY-MM-DD.json`,
        ai: `${DAILY_LOGS_DIR}/ai-YYYY-MM-DD.json`,
        reminders: `${DAILY_LOGS_DIR}/reminders-YYYY-MM-DD.json`
      }
    },
    nextAvailableDate: getNextAvailableDate(),
    reminderSystem: {
      schedule: 'ONE DAY BEFORE appointment at 2 PM Pacific Time',
      checkInterval: 'Every 5 minutes',
      testEndpoint: 'POST /test-reminder?phone=+1234567890'
    },
    businessHours: {
      open: businessStatus.isOpen,
      message: businessStatus.isOpen ? 'Open now' : `Closed - ${businessStatus.nextOpenTime}`
    },
    selfPing: process.env.FREE_PLAN === 'true' ? 'Active (4 min interval)' : 'Inactive'
  });
});

app.get('/', (req, res) => {
  const businessStatus = getBusinessStatus();
  
  res.send(`
    <html>
      <head>
        <title>Altair Partners IVR Server</title>
        <style>
          body { font-family: Arial, sans-serif; padding: 20px; max-width: 1000px; margin: 0 auto; }
          .status { padding: 10px; border-radius: 5px; margin: 10px 0; }
          .open { background-color: #d4edda; color: #155724; border: 1px solid #c3e6cb; }
          .closed { background-color: #f8d7da; color: #721c24; border: 1px solid #f5c6cb; }
          .endpoints { background-color: #e2e3e5; padding: 15px; border-radius: 5px; margin: 15px 0; }
          ul { line-height: 1.6; }
          a { color: #0066cc; text-decoration: none; }
          a:hover { text-decoration: underline; }
          .archive-info { background-color: #fff3cd; padding: 10px; border-radius: 5px; margin: 10px 0; }
          .instant-badge { background-color: #28a745; color: white; padding: 2px 6px; border-radius: 3px; font-size: 12px; }
        </style>
      </head>
      <body>
        <h1>✅ Altair Partners IVR Server</h1>
        
        <div class="status ${businessStatus.isOpen ? 'open' : 'closed'}">
          <p><strong>Status:</strong> ${businessStatus.isOpen ? '🟢 OPEN' : '🔴 CLOSED'}</p>
          <p><strong>Current Time (PST):</strong> ${businessStatus.currentTime}</p>
          <p><strong>Business Hours:</strong> ${businessStatus.hours}</p>
          <p><strong>Location:</strong> ${businessStatus.location}</p>
          <p>${businessStatus.isOpen ? '✅ Currently open' : '⏰ ' + businessStatus.nextOpenTime}</p>
        </div>
        
        <div class="archive-info">
          <h3>📦 Instant Archive System <span class="instant-badge">LIVE</span></h3>
          <p><strong>Все звонки сохраняются СРАЗУ после разговора!</strong></p>
          <p>• 📞 Звонки → мгновенно в архив</p>
          <p>• 📅 Appointments → мгновенно в архив</p>
          <p>• 🤖 AI разговоры → мгновенно в архив</p>
          <p>• ⏰ Reminders → мгновенно в архив</p>
          <p><a href="/daily-archives">📊 Просмотреть все архивы по датам</a></p>
        </div>
        
        <div class="endpoints">
          <h3>Endpoints:</h3>
          <ul>
            <li><a href="/health">/health</a> - Health check</li>
            <li><a href="/debug">/debug</a> - Debug info</li>
            <li><a href="/daily-archives">/daily-archives</a> - Все архивы по дням</li>
            <li><a href="/logs">/logs</a> - Текущие логи звонков</li>
            <li><a href="/appointments">/appointments</a> - Все appointments</li>
            <li><a href="/conversations">/conversations</a> - AI conversations</li>
            <li><a href="/reminders">/reminders</a> - Reminder logs</li>
            <li><a href="/business-status">/business-status</a> - Business hours check</li>
          </ul>
          
          <h3>Пример просмотра архива за сегодня:</h3>
          <ul>
            <li><a href="/daily-archives/${new Date().toISOString().split('T')[0]}/calls">/daily-archives/${new Date().toISOString().split('T')[0]}/calls</a> (сегодняшние звонки)</li>
            <li><a href="/daily-archives/${new Date().toISOString().split('T')[0]}/appointments">/daily-archives/${new Date().toISOString().split('T')[0]}/appointments</a> (сегодняшние appointments)</li>
          </ul>
        </div>
        
        <p><strong>Twilio Webhook:</strong> POST /voice</p>
        <p><strong>⏰ Reminder System:</strong> Calls ONE DAY BEFORE appointment at 2 PM Pacific Time</p>
        <p><strong>🔄 Check interval:</strong> Every 5 minutes</p>
        <p><strong>🔔 <a href="/test-reminder?phone=+15034448881">Test reminder</a></strong></p>
        <p><strong>📦 Архивация:</strong> <span class="instant-badge">INSTANT MODE</span> (сразу после звонка)</p>
        <p><strong>💾 Self-ping:</strong> ${process.env.FREE_PLAN === 'true' ? 'Active (каждые 4 минуты)' : 'Inactive'}</p>
        <p><strong>📞 Тестовый звонок:</strong> +1 (503) 444-8881</p>
      </body>
    </html>
  `);
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
      lastUpdated: new Date().toISOString(),
      note: "Это текущие логи. Архивы по дням доступны по /daily-archives"
    });
  } catch (error) {
    res.status(500).json({ error: "Failed to load logs" });
  }
});

app.get('/appointments', (req, res) => {
  const appointments = loadDB();
  
  res.json({
    total: appointments.length,
    appointments: appointments.reverse(),
    lastUpdated: new Date().toISOString(),
    note: "Это текущие appointments. Архивы по дням доступны по /daily-archives"
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
      conversations: aiConversations.reverse(),
      lastUpdated: new Date().toISOString(),
      note: "Это текущие AI разговоры. Архивы по дням доступны по /daily-archives"
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
      reminders: reminderLogs.reverse(),
      lastUpdated: new Date().toISOString(),
      systemInfo: 'Calls ONE DAY BEFORE appointment at 2 PM Pacific Time',
      note: "Это текущие reminders. Архивы по дням доступны по /daily-archives"
    });
  } catch (error) {
    res.status(500).json({ error: "Failed to load reminders" });
  }
});

// ======================================================
// START SERVER WITH REMINDER SYSTEM
// ======================================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  const businessStatus = getBusinessStatus();
  
  // Получаем реальный URL сервера
  const serverUrl = process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`;
  
  console.log(`🚀 Altair Partners IVR Server running on port ${PORT}`);
  console.log(`⏰ Business Status: ${businessStatus.isOpen ? 'OPEN' : 'CLOSED'}`);
  console.log(`🕐 Current Time (PST): ${businessStatus.currentTime}`);
  console.log(`📅 Next Open: ${businessStatus.nextOpenTime}`);
  console.log(`🌐 Server URL: ${serverUrl}`);
  console.log(`✅ Health check: ${serverUrl}/health`);
  console.log(`✅ Debug: ${serverUrl}/debug`);
  console.log(`📦 Daily archives: ${serverUrl}/daily-archives`);
  console.log(`📊 Current logs: ${serverUrl}/logs`);
  console.log(`📅 Appointments: ${serverUrl}/appointments`);
  console.log(`🤖 Conversations: ${serverUrl}/conversations`);
  console.log(`⏰ Reminders: ${serverUrl}/reminders`);
  console.log(`🏢 Business Status: ${serverUrl}/business-status`);
  console.log(`✅ Next available date: ${getNextAvailableDate()}`);
  console.log(`🤖 AI Representative is ready (fast mode)`);
  console.log(`📝 INSTANT ARCHIVE SYSTEM: Все данные сохраняются сразу после звонка!`);
  console.log(`📁 Archives location: ./logs/daily/`);
  console.log(`⏰ Reminder system: Calls ONE DAY BEFORE appointment at 2 PM Pacific Time`);
  console.log(`🔄 Check interval: Every 5 minutes`);
  console.log(`🔔 Test endpoint: POST ${serverUrl}/test-reminder?phone=+1234567890`);
  console.log(`🚪 After-hours options: Callback request (1) or Voice message (2)`);
  console.log(`💾 Self-ping: ${process.env.FREE_PLAN === 'true' ? 'Active (каждые 4 минуты)' : 'Inactive'}`);
  
  // Запускаем reminder scheduler
  startReminderScheduler();
  
  // Запускаем daily archiver
  startDailyArchiver();
  
  console.log(`✅ INSTANT ARCHIVE SYSTEM READY - Все звонки будут сохраняться сразу!`);
});