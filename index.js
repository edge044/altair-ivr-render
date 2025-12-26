const express = require('express');
const fs = require('fs');
const path = require('path');
const VoiceResponse = require('twilio').twiml.VoiceResponse;
const twilioClient = require('twilio')(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);
const { OpenAI } = require('openai');
const basicAuth = require('basic-auth');

const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

// ======================================================
// SECURITY: PASSWORD PROTECTION
// ======================================================

function requireAuth(req, res, next) {
  const AUTH_USERNAME = process.env.ARCHIVE_USERNAME || 'altair_admin';
  const AUTH_PASSWORD = process.env.ARCHIVE_PASSWORD || 'AltairSecure2024!@#$';
  
  const user = basicAuth(req);
  
  if (!user || user.name !== AUTH_USERNAME || user.pass !== AUTH_PASSWORD) {
    console.log(`🔒 Unauthorized access attempt from IP: ${req.ip} - User: ${user ? user.name : 'none'}`);
    
    res.set('WWW-Authenticate', 'Basic realm="Altair Partners - Secure Dashboard Access"');
    return res.status(401).send(`
      <html>
        <head>
          <title>🔒 401 - Secure Dashboard Access</title>
          <style>
            body { 
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; 
              padding: 40px; 
              text-align: center;
              background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
              min-height: 100vh;
              display: flex;
              align-items: center;
              justify-content: center;
            }
            .auth-box {
              background: white;
              padding: 40px;
              border-radius: 20px;
              box-shadow: 0 20px 60px rgba(0,0,0,0.3);
              max-width: 500px;
              width: 100%;
            }
            .lock-icon {
              font-size: 4rem;
              color: #4f46e5;
              margin-bottom: 20px;
            }
            h1 { 
              color: #1e293b; 
              margin-bottom: 10px;
              font-size: 2rem;
            }
            .subtitle {
              color: #64748b;
              margin-bottom: 30px;
              font-size: 1.1rem;
            }
            .warning {
              background: #fef3c7;
              border: 2px solid #f59e0b;
              padding: 15px;
              border-radius: 10px;
              margin: 20px 0;
              color: #92400e;
              font-size: 0.9rem;
            }
            .note {
              color: #64748b;
              font-size: 0.9rem;
              margin-top: 20px;
            }
          </style>
        </head>
        <body>
          <div class="auth-box">
            <div class="lock-icon">🔒</div>
            <h1>Secure Dashboard Access</h1>
            <p class="subtitle">All dashboards are password protected for security</p>
            
            <div class="warning">
              ⚠️ <strong>SECURITY NOTICE:</strong> Change default credentials in .env file!
              Unauthorized access is strictly prohibited.
            </div>
            
            <p class="note">Access restricted to Altair Partners authorized personnel only.</p>
            <p class="note">Contact system administrator for credentials.</p>
          </div>
        </body>
      </html>
    `);
  }
  
  console.log(`🔓 Authorized dashboard access from ${req.ip} - User: ${user.name}`);
  next();
}

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
// JSON DATABASE & LOGGING
// ======================================================

const LOGS_DIR = "./logs";
const CURRENT_LOGS_DIR = `${LOGS_DIR}/current`;
const DAILY_LOGS_DIR = `${LOGS_DIR}/daily`;

// Создаем папки
[LOGS_DIR, CURRENT_LOGS_DIR, DAILY_LOGS_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// Пути к файлам
const DB_PATH = `${CURRENT_LOGS_DIR}/appointments.json`;
const CALL_LOGS_PATH = `${CURRENT_LOGS_DIR}/call_logs.json`;
const AI_CONVERSATIONS_PATH = `${CURRENT_LOGS_DIR}/ai_conversations.json`;
const REMINDERS_LOG = `${CURRENT_LOGS_DIR}/reminders_log.json`;

// Функция для получения сегодняшней даты
function getTodayDateString() {
  const now = new Date();
  return now.toISOString().split('T')[0];
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
      existingData.push(...data);
    } else {
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
    'million', 'billion', '100k', '500k', 'investment', 'laws', 'contract'
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
      })
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
// BEAUTIFUL ARCHIVE VIEWER HTML
// ======================================================

const ARCHIVE_VIEWER_HTML = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>📊 Altair Partners - Beautiful Archive Viewer</title>
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
            font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
        }

        body {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            padding: 20px;
        }

        .container {
            max-width: 1400px;
            margin: 0 auto;
            background: white;
            border-radius: 20px;
            box-shadow: 0 20px 60px rgba(0,0,0,0.3);
            overflow: hidden;
            animation: fadeIn 0.5s ease;
        }

        @keyframes fadeIn {
            from { opacity: 0; transform: translateY(20px); }
            to { opacity: 1; transform: translateY(0); }
        }

        .header {
            background: linear-gradient(to right, #4f46e5, #7c3aed);
            color: white;
            padding: 30px 40px;
            border-bottom: 1px solid rgba(255,255,255,0.1);
        }

        .header h1 {
            font-size: 2.5rem;
            margin-bottom: 10px;
            display: flex;
            align-items: center;
            gap: 15px;
        }

        .header p {
            opacity: 0.9;
            font-size: 1.1rem;
            margin-bottom: 10px;
        }

        .badge {
            background: rgba(255,255,255,0.2);
            padding: 5px 12px;
            border-radius: 20px;
            font-size: 0.9rem;
            display: inline-flex;
            align-items: center;
            gap: 5px;
            margin-top: 5px;
        }

        .stats-bar {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 15px;
            padding: 20px 40px;
            background: #f8fafc;
            border-bottom: 1px solid #e2e8f0;
        }

        .stat-card {
            background: white;
            padding: 20px;
            border-radius: 12px;
            border: 1px solid #e2e8f0;
            text-align: center;
            transition: all 0.3s ease;
            cursor: pointer;
            position: relative;
            overflow: hidden;
        }

        .stat-card:hover {
            transform: translateY(-5px);
            box-shadow: 0 10px 30px rgba(99, 102, 241, 0.2);
            border-color: #6366f1;
        }

        .stat-card::before {
            content: '';
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            height: 4px;
            background: linear-gradient(to right, #4f46e5, #7c3aed);
        }

        .stat-number {
            font-size: 2.5rem;
            font-weight: 800;
            color: #4f46e5;
            margin-bottom: 5px;
            text-shadow: 2px 2px 4px rgba(0,0,0,0.1);
        }

        .stat-label {
            color: #64748b;
            font-size: 0.9rem;
            text-transform: uppercase;
            letter-spacing: 1px;
            font-weight: 600;
        }

        .controls {
            padding: 25px 40px;
            background: white;
            border-bottom: 1px solid #e2e8f0;
            display: flex;
            gap: 20px;
            align-items: center;
            flex-wrap: wrap;
        }

        .filter-btn {
            padding: 12px 24px;
            background: #f1f5f9;
            border: 2px solid #cbd5e1;
            border-radius: 10px;
            font-size: 1rem;
            font-weight: 600;
            color: #475569;
            cursor: pointer;
            transition: all 0.3s ease;
            display: flex;
            align-items: center;
            gap: 8px;
        }

        .filter-btn:hover {
            background: #e2e8f0;
            transform: translateY(-2px);
            box-shadow: 0 5px 15px rgba(0,0,0,0.1);
        }

        .filter-btn.active {
            background: linear-gradient(to right, #4f46e5, #7c3aed);
            color: white;
            border-color: #4f46e5;
            box-shadow: 0 5px 20px rgba(79, 70, 229, 0.3);
        }

        .search-box {
            flex: 1;
            min-width: 200px;
            padding: 12px 20px;
            border: 2px solid #cbd5e1;
            border-radius: 10px;
            font-size: 1rem;
            font-weight: 500;
            background: white;
            transition: all 0.3s ease;
        }

        .search-box:focus {
            outline: none;
            border-color: #4f46e5;
            box-shadow: 0 0 0 3px rgba(79, 70, 229, 0.1);
        }

        .action-btn {
            padding: 12px 24px;
            border: none;
            border-radius: 10px;
            font-weight: 600;
            cursor: pointer;
            display: flex;
            align-items: center;
            gap: 8px;
            transition: all 0.3s ease;
        }

        .refresh-btn {
            background: linear-gradient(to right, #10b981, #34d399);
            color: white;
        }

        .refresh-btn:hover {
            transform: translateY(-2px) rotate(5deg);
            box-shadow: 0 10px 20px rgba(16, 185, 129, 0.3);
        }

        .back-btn {
            background: #64748b;
            color: white;
        }

        .back-btn:hover {
            background: #475569;
            transform: translateX(-5px);
        }

        .date-grid {
            padding: 40px;
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
            gap: 25px;
        }

        .date-card {
            background: white;
            border: 2px solid #e2e8f0;
            border-radius: 15px;
            overflow: hidden;
            transition: all 0.3s ease;
            cursor: pointer;
            animation: cardSlide 0.5s ease backwards;
            animation-delay: calc(var(--i) * 0.1s);
        }

        @keyframes cardSlide {
            from {
                opacity: 0;
                transform: translateY(30px) scale(0.9);
            }
            to {
                opacity: 1;
                transform: translateY(0) scale(1);
            }
        }

        .date-card:hover {
            transform: translateY(-10px) scale(1.02);
            box-shadow: 0 20px 40px rgba(0,0,0,0.15);
            border-color: #4f46e5;
        }

        .date-header {
            background: linear-gradient(to right, #60a5fa, #3b82f6);
            color: white;
            padding: 20px;
            text-align: center;
            position: relative;
        }

        .date-header::after {
            content: '';
            position: absolute;
            bottom: -10px;
            left: 50%;
            transform: translateX(-50%);
            width: 0;
            height: 0;
            border-left: 10px solid transparent;
            border-right: 10px solid transparent;
            border-top: 10px solid #3b82f6;
        }

        .date-day {
            font-size: 1.8rem;
            font-weight: 700;
            margin-bottom: 5px;
        }

        .date-number {
            font-size: 3.5rem;
            font-weight: 800;
            line-height: 1;
            text-shadow: 2px 2px 4px rgba(0,0,0,0.2);
        }

        .date-month-year {
            font-size: 1.1rem;
            opacity: 0.9;
            margin-top: 5px;
        }

        .date-stats {
            padding: 20px;
            background: #f8fafc;
        }

        .stat-row {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 12px 0;
            border-bottom: 1px solid #e2e8f0;
        }

        .stat-row:last-child {
            border-bottom: none;
        }

        .log-type {
            font-weight: 600;
            color: #475569;
            display: flex;
            align-items: center;
            gap: 8px;
        }

        .log-count {
            background: #4f46e5;
            color: white;
            padding: 4px 12px;
            border-radius: 20px;
            font-size: 0.9rem;
            font-weight: 600;
            min-width: 40px;
            text-align: center;
        }

        .button-row {
            padding: 15px;
            display: flex;
            gap: 10px;
            flex-wrap: wrap;
        }

        .view-btn {
            flex: 1;
            min-width: 120px;
            padding: 12px;
            background: linear-gradient(to right, #4f46e5, #7c3aed);
            color: white;
            border: none;
            font-size: 1rem;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.3s ease;
            text-align: center;
            border-radius: 8px;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 8px;
        }

        .view-btn:hover {
            background: linear-gradient(to right, #4338ca, #6d28d9);
            transform: translateY(-2px);
            box-shadow: 0 5px 15px rgba(79, 70, 229, 0.3);
        }

        .details-container {
            padding: 40px;
            display: none;
        }

        .details-container.active {
            display: block;
            animation: slideIn 0.5s ease;
        }

        @keyframes slideIn {
            from {
                opacity: 0;
                transform: translateX(50px);
            }
            to {
                opacity: 1;
                transform: translateX(0);
            }
        }

        .details-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 30px;
            padding-bottom: 20px;
            border-bottom: 2px solid #e2e8f0;
        }

        .log-table-container {
            background: white;
            border-radius: 15px;
            overflow: hidden;
            box-shadow: 0 10px 30px rgba(0,0,0,0.1);
        }

        .log-table {
            width: 100%;
            border-collapse: collapse;
        }

        .log-table thead {
            background: linear-gradient(to right, #4f46e5, #7c3aed);
        }

        .log-table th {
            color: white;
            padding: 20px;
            text-align: left;
            font-weight: 600;
            font-size: 1.1rem;
            position: relative;
        }

        .log-table th::after {
            content: '';
            position: absolute;
            right: 0;
            top: 50%;
            transform: translateY(-50%);
            height: 60%;
            width: 1px;
            background: rgba(255,255,255,0.3);
        }

        .log-table th:last-child::after {
            display: none;
        }

        .log-table td {
            padding: 18px 20px;
            border-bottom: 1px solid #e2e8f0;
            transition: background 0.2s ease;
        }

        .log-table tbody tr:hover {
            background: #f8fafc;
        }

        .log-table tbody tr:last-child td {
            border-bottom: none;
        }

        .phone-number {
            font-family: 'SF Mono', Monaco, 'Cascadia Mono', monospace;
            background: #f1f5f9;
            padding: 6px 12px;
            border-radius: 6px;
            font-weight: 600;
            color: #1e293b;
            font-size: 0.9rem;
        }

        .action-badge {
            padding: 6px 15px;
            border-radius: 20px;
            font-size: 0.85rem;
            font-weight: 600;
            display: inline-flex;
            align-items: center;
            gap: 5px;
            white-space: nowrap;
        }

        .badge-call { background: #dbeafe; color: #1e40af; }
        .badge-appointment { background: #dcfce7; color: #166534; }
        .badge-ai { background: #fef3c7; color: #92400e; }
        .badge-reminder { background: #f3e8ff; color: #6b21a8; }
        .badge-error { background: #fee2e2; color: #991b1b; }

        .message-preview {
            max-width: 300px;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            color: #64748b;
        }

        .loading {
            text-align: center;
            padding: 60px;
            color: #64748b;
            font-size: 1.2rem;
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 20px;
        }

        .loader {
            width: 50px;
            height: 50px;
            border: 4px solid #e2e8f0;
            border-top: 4px solid #4f46e5;
            border-radius: 50%;
            animation: spin 1s linear infinite;
        }

        @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
        }

        .error-container {
            display: none;
            background: #fee2e2;
            color: #991b1b;
            padding: 20px;
            border-radius: 10px;
            margin: 20px;
            text-align: center;
            animation: shake 0.5s ease;
        }

        @keyframes shake {
            0%, 100% { transform: translateX(0); }
            25% { transform: translateX(-10px); }
            75% { transform: translateX(10px); }
        }

        .error-container.active {
            display: block;
        }

        .no-data {
            grid-column: 1 / -1;
            text-align: center;
            padding: 60px;
            color: #64748b;
            font-size: 1.2rem;
        }

        .no-data i {
            font-size: 3rem;
            margin-bottom: 20px;
            opacity: 0.5;
        }

        @media (max-width: 768px) {
            .date-grid {
                grid-template-columns: 1fr;
                padding: 20px;
            }
            
            .controls {
                flex-direction: column;
                align-items: stretch;
                gap: 15px;
            }
            
            .search-box {
                min-width: 100%;
            }
            
            .stats-bar {
                grid-template-columns: repeat(2, 1fr);
                padding: 15px;
                gap: 10px;
            }
            
            .stat-number {
                font-size: 2rem;
            }
        }

        @media (max-width: 480px) {
            .stats-bar {
                grid-template-columns: 1fr;
            }
            
            .header {
                padding: 20px;
            }
            
            .header h1 {
                font-size: 1.8rem;
            }
        }
    </style>
</head>
<body>
    <div class="container">
        <!-- Header -->
        <div class="header">
            <h1>
                <i class="fas fa-archive"></i>
                Altair Partners Call Archive
            </h1>
            <p>Instant call logging system • View all calls, appointments, and conversations • Real-time updates</p>
            <div class="badge">
                <i class="fas fa-bolt"></i>
                INSTANT ARCHIVE - Все звонки сохраняются сразу!
            </div>
        </div>

        <!-- Stats Bar -->
        <div class="stats-bar" id="statsBar">
            <div class="stat-card" id="totalDates">
                <div class="stat-number">0</div>
                <div class="stat-label">Archived Dates</div>
            </div>
            <div class="stat-card" id="totalCalls">
                <div class="stat-number">0</div>
                <div class="stat-label">Total Calls</div>
            </div>
            <div class="stat-card" id="totalAppointments">
                <div class="stat-number">0</div>
                <div class="stat-label">Appointments</div>
            </div>
            <div class="stat-card" id="totalAI">
                <div class="stat-number">0</div>
                <div class="stat-label">AI Conversations</div>
            </div>
        </div>

        <!-- Controls -->
        <div class="controls" id="controls">
            <button class="filter-btn active" data-type="all">
                <i class="fas fa-layer-group"></i> All Types
            </button>
            <button class="filter-btn" data-type="calls">
                <i class="fas fa-phone"></i> Calls
            </button>
            <button class="filter-btn" data-type="appointments">
                <i class="fas fa-calendar-check"></i> Appointments
            </button>
            <button class="filter-btn" data-type="ai">
                <i class="fas fa-robot"></i> AI Conversations
            </button>
            <button class="filter-btn" data-type="reminders">
                <i class="fas fa-bell"></i> Reminders
            </button>
            
            <input type="text" class="search-box" id="searchBox" placeholder="🔍 Search by date or phone number...">
            
            <button class="action-btn refresh-btn" id="refreshBtn">
                <i class="fas fa-sync-alt"></i> Refresh
            </button>
        </div>

        <!-- Loading -->
        <div class="loading" id="loading">
            <div class="loader"></div>
            Loading archive data...
        </div>

        <!-- Error -->
        <div class="error-container" id="errorContainer">
            <i class="fas fa-exclamation-triangle"></i>
            <h3>Error loading data</h3>
            <p id="errorMessage">Please check if the server is running.</p>
            <button class="action-btn refresh-btn" onclick="loadArchiveData()" style="margin-top: 10px;">
                <i class="fas fa-redo"></i> Try Again
            </button>
        </div>

        <!-- Dates Grid -->
        <div class="date-grid" id="dateGrid">
            <!-- Dates will be inserted here -->
        </div>

        <!-- No Data Message -->
        <div class="no-data" id="noData" style="display: none;">
            <i class="fas fa-inbox"></i>
            <h3>No archive data found</h3>
            <p>There are no logs available for the selected criteria.</p>
        </div>

        <!-- Details Container -->
        <div class="details-container" id="detailsContainer">
            <div class="details-header">
                <h2 id="detailTitle">
                    <i class="fas fa-file-alt"></i>
                    Log Details
                </h2>
                <button class="action-btn back-btn" id="backBtn">
                    <i class="fas fa-arrow-left"></i> Back to Archive
                </button>
            </div>
            
            <div class="log-table-container">
                <table class="log-table" id="logTable">
                    <thead>
                        <tr>
                            <th><i class="fas fa-clock"></i> Time</th>
                            <th><i class="fas fa-phone"></i> Phone Number</th>
                            <th><i class="fas fa-bolt"></i> Action</th>
                            <th><i class="fas fa-info-circle"></i> Details</th>
                        </tr>
                    </thead>
                    <tbody id="logTableBody">
                        <!-- Logs will be inserted here -->
                    </tbody>
                </table>
            </div>
        </div>
    </div>

    <script>
        // Configuration
        const SERVER_URL = window.location.origin;
        let currentView = 'grid';
        let currentDate = '';
        let currentType = 'all';
        let allDates = [];

        // DOM Elements
        const loadingEl = document.getElementById('loading');
        const errorContainerEl = document.getElementById('errorContainer');
        const errorMessageEl = document.getElementById('errorMessage');
        const dateGridEl = document.getElementById('dateGrid');
        const detailsContainerEl = document.getElementById('detailsContainer');
        const logTableBodyEl = document.getElementById('logTableBody');
        const detailTitleEl = document.getElementById('detailTitle');
        const backBtn = document.getElementById('backBtn');
        const refreshBtn = document.getElementById('refreshBtn');
        const searchBoxEl = document.getElementById('searchBox');
        const filterBtns = document.querySelectorAll('.filter-btn');
        const noDataEl = document.getElementById('noData');
        const statsBarEl = document.getElementById('statsBar');

        // Initialize
        document.addEventListener('DOMContentLoaded', () => {
            loadArchiveData();
            setupEventListeners();
            setupAutoRefresh();
            setupSearch();
        });

        // Event Listeners
        function setupEventListeners() {
            backBtn.addEventListener('click', showDateGrid);
            refreshBtn.addEventListener('click', loadArchiveData);
            
            filterBtns.forEach(btn => {
                btn.addEventListener('click', () => {
                    filterBtns.forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');
                    currentType = btn.dataset.type;
                    renderDateGrid();
                });
            });
        }

        // Search functionality
        function setupSearch() {
            let searchTimeout;
            searchBoxEl.addEventListener('input', () => {
                clearTimeout(searchTimeout);
                searchTimeout = setTimeout(() => {
                    renderDateGrid();
                }, 300);
            });
        }

        // Auto-refresh every 30 seconds
        function setupAutoRefresh() {
            setInterval(() => {
                if (currentView === 'grid') {
                    loadArchiveData();
                }
            }, 30000);
        }

        // Load archive data
        async function loadArchiveData() {
            showLoading();
            hideError();
            hideNoData();
            
            try {
                const response = await fetch('/daily-archives');
                
                if (!response.ok) {
                    throw new Error(\`Server error: \${response.status}\`);
                }
                
                const data = await response.json();
                allDates = data.dates || [];
                
                updateStats(data);
                renderDateGrid();
                hideLoading();
                
            } catch (error) {
                console.error('Error loading archive:', error);
                showError(\`Failed to load archive: \${error.message}\`);
                hideLoading();
            }
        }

        // Update statistics
        function updateStats(data) {
            document.getElementById('totalDates').querySelector('.stat-number').textContent = data.totalDates || 0;
            
            // Calculate totals
            let totalCalls = 0;
            let totalAppointments = 0;
            let totalAI = 0;
            
            allDates.forEach(date => {
                if (date.logsAvailable.calls) totalCalls++;
                if (date.logsAvailable.appointments) totalAppointments++;
                if (date.logsAvailable.ai) totalAI++;
            });
            
            document.getElementById('totalCalls').querySelector('.stat-number').textContent = totalCalls;
            document.getElementById('totalAppointments').querySelector('.stat-number').textContent = totalAppointments;
            document.getElementById('totalAI').querySelector('.stat-number').textContent = totalAI;
            
            // Animate stats
            animateStats();
        }

        // Animate stats numbers
        function animateStats() {
            const statNumbers = document.querySelectorAll('.stat-number');
            statNumbers.forEach(stat => {
                const target = parseInt(stat.textContent);
                let current = 0;
                const increment = target / 20;
                
                const timer = setInterval(() => {
                    current += increment;
                    if (current >= target) {
                        current = target;
                        clearInterval(timer);
                    }
                    stat.textContent = Math.floor(current);
                }, 50);
            });
        }

        // Render date grid
        function renderDateGrid() {
            dateGridEl.innerHTML = '';
            
            let filteredDates = [...allDates];
            
            // Filter by type
            if (currentType !== 'all') {
                filteredDates = filteredDates.filter(date => date.logsAvailable[currentType]);
            }
            
            // Filter by search
            const searchTerm = searchBoxEl.value.toLowerCase();
            if (searchTerm) {
                filteredDates = filteredDates.filter(date => {
                    return date.date.includes(searchTerm) ||
                           date.formattedDate.toLowerCase().includes(searchTerm);
                });
            }
            
            // Sort by date (newest first)
            filteredDates.sort((a, b) => new Date(b.date) - new Date(a.date));
            
            if (filteredDates.length === 0) {
                showNoData();
                return;
            }
            
            hideNoData();
            
            // Create date cards
            filteredDates.forEach((date, index) => {
                const dateCard = createDateCard(date, index);
                dateGridEl.appendChild(dateCard);
            });
        }

        // Create date card
        function createDateCard(dateData, index) {
            const card = document.createElement('div');
            card.className = 'date-card';
            card.style.setProperty('--i', index);
            
            const date = new Date(dateData.date + 'T00:00:00');
            const day = date.toLocaleDateString('en-US', { weekday: 'long' });
            const dateNum = date.getDate();
            const monthYear = date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
            
            card.innerHTML = \`
                <div class="date-header">
                    <div class="date-day">\${day}</div>
                    <div class="date-number">\${dateNum}</div>
                    <div class="date-month-year">\${monthYear}</div>
                </div>
                <div class="date-stats">
            \`;
            
            // Add stats rows
            const statsContainer = card.querySelector('.date-stats');
            
            if (dateData.logsAvailable.calls) {
                statsContainer.innerHTML += \`
                    <div class="stat-row">
                        <span class="log-type">
                            <i class="fas fa-phone"></i>
                            Calls
                        </span>
                        <span class="log-count">\${dateData.totalItems || '?'}</span>
                    </div>
                \`;
            }
            
            if (dateData.logsAvailable.appointments) {
                statsContainer.innerHTML += \`
                    <div class="stat-row">
                        <span class="log-type">
                            <i class="fas fa-calendar-check"></i>
                            Appointments
                        </span>
                        <span class="log-count">\${dateData.uniquePhones || '?'}</span>
                    </div>
                \`;
            }
            
            if (dateData.logsAvailable.ai) {
                statsContainer.innerHTML += \`
                    <div class="stat-row">
                        <span class="log-type">
                            <i class="fas fa-robot"></i>
                            AI Conversations
                        </span>
                        <span class="log-count">\${dateData.totalItems || '?'}</span>
                    </div>
                \`;
            }
            
            if (dateData.logsAvailable.reminders) {
                statsContainer.innerHTML += \`
                    <div class="stat-row">
                        <span class="log-type">
                            <i class="fas fa-bell"></i>
                            Reminders
                        </span>
                        <span class="log-count">\${dateData.totalItems || '?'}</span>
                    </div>
                \`;
            }
            
            // Add buttons
            const buttonRow = document.createElement('div');
            buttonRow.className = 'button-row';
            
            if (dateData.logsAvailable.calls) {
                buttonRow.innerHTML += \`
                    <button class="view-btn" data-type="calls">
                        <i class="fas fa-phone"></i>
                        Calls
                    </button>
                \`;
            }
            
            if (dateData.logsAvailable.appointments) {
                buttonRow.innerHTML += \`
                    <button class="view-btn" data-type="appointments">
                        <i class="fas fa-calendar-check"></i>
                        Appointments
                    </button>
                \`;
            }
            
            card.appendChild(buttonRow);
            
            // Add event listeners to buttons
            card.querySelectorAll('.view-btn').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const type = btn.dataset.type;
                    showLogDetails(dateData.date, type);
                });
            });
            
            return card;
        }

        // Show log details
        async function showLogDetails(date, type) {
            showLoading();
            currentDate = date;
            currentView = 'details';
            
            try {
                const response = await fetch(\`/daily-archives/\${date}/\${type}\`);
                
                if (!response.ok) {
                    throw new Error(\`Failed to load \${type} logs\`);
                }
                
                const data = await response.json();
                
                // Update title
                const dateObj = new Date(date + 'T00:00:00');
                const formattedDate = dateObj.toLocaleDateString('en-US', {
                    weekday: 'long',
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric'
                });
                
                const typeLabels = {
                    'calls': 'Calls',
                    'appointments': 'Appointments',
                    'ai': 'AI Conversations',
                    'reminders': 'Reminders'
                };
                
                detailTitleEl.innerHTML = \`
                    <i class="fas fa-file-alt"></i>
                    \${typeLabels[type]} - \${formattedDate}
                \`;
                
                // Clear table
                logTableBodyEl.innerHTML = '';
                
                // Add logs to table
                if (data.logs && data.logs.length > 0) {
                    data.logs.forEach(log => {
                        const row = createLogRow(log, type);
                        logTableBodyEl.appendChild(row);
                    });
                } else {
                    logTableBodyEl.innerHTML = \`
                        <tr>
                            <td colspan="4" style="text-align: center; padding: 40px; color: #64748b;">
                                <i class="fas fa-inbox" style="font-size: 2rem; margin-bottom: 10px; display: block;"></i>
                                No \${type} logs found for this date
                            </td>
                        </tr>
                    \`;
                }
                
                // Show details view
                dateGridEl.style.display = 'none';
                detailsContainerEl.classList.add('active');
                hideLoading();
                
            } catch (error) {
                console.error('Error loading log details:', error);
                showError(\`Failed to load log details: \${error.message}\`);
                hideLoading();
            }
        }

        // Create log table row
        function createLogRow(log, type) {
            const row = document.createElement('tr');
            
            // Format time
            const time = log.time || log.timestamp || 'N/A';
            const timeFormatted = new Date(time).toLocaleString('en-US', {
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
                hour12: true
            });
            
            // Format phone
            const phone = log.phone || log.details?.phone || 'N/A';
            const formattedPhone = phone !== 'N/A' ? 
                \`<span class="phone-number">\${phone}</span>\` : 
                '<span style="color: #94a3b8;">N/A</span>';
            
            // Format action
            const action = log.action || 'N/A';
            const actionBadge = getActionBadge(action);
            
            // Format details
            let details = 'No details';
            if (type === 'appointments') {
                const name = log.name || log.details?.name || 'Unknown';
                const business = log.businessType || log.details?.businessType || '';
                const service = log.serviceType || log.details?.serviceType || '';
                details = \`
                    <strong>\${name}</strong><br>
                    \${business ? \`<small>\${business}</small>\` : ''}
                    \${service ? \`<br><small>\${service}</small>\` : ''}
                \`;
            } else if (type === 'ai') {
                const question = log.question ? log.question.substring(0, 60) + (log.question.length > 60 ? '...' : '') : '';
                const response = log.response ? log.response.substring(0, 60) + (log.response.length > 60 ? '...' : '') : '';
                details = \`
                    <div class="message-preview">
                        <strong>Q:</strong> \${question || 'N/A'}<br>
                        <strong>A:</strong> \${response || 'N/A'}
                    </div>
                \`;
            } else if (type === 'calls') {
                const name = log.details?.name || '';
                const actionType = log.details?.action || '';
                details = \`
                    \${name ? \`<strong>\${name}</strong><br>\` : ''}
                    \${actionType}
                \`;
            } else if (type === 'reminders') {
                const apptName = log.appointment?.name || '';
                const apptDate = log.appointment?.date || '';
                const apptTime = log.appointment?.time || '';
                details = \`
                    \${apptName ? \`<strong>\${apptName}</strong><br>\` : ''}
                    \${apptDate ? \`\${apptDate} at \${apptTime}\` : 'No appointment details'}
                \`;
            }
            
            row.innerHTML = \`
                <td>\${timeFormatted}</td>
                <td>\${formattedPhone}</td>
                <td>\${actionBadge}</td>
                <td>\${details}</td>
            \`;
            
            return row;
        }

        // Show date grid
        function showDateGrid() {
            currentView = 'grid';
            dateGridEl.style.display = 'grid';
            detailsContainerEl.classList.remove('active');
        }

        // Utility functions
        function getActionBadge(action) {
            let badgeClass = 'badge-call';
            let icon = 'fa-phone';
            
            if (action.includes('APPOINTMENT')) {
                badgeClass = 'badge-appointment';
                icon = 'fa-calendar-check';
            } else if (action.includes('AI') || action.includes('CONVERSATION')) {
                badgeClass = 'badge-ai';
                icon = 'fa-robot';
            } else if (action.includes('REMINDER')) {
                badgeClass = 'badge-reminder';
                icon = 'fa-bell';
            } else if (action.includes('ERROR') || action.includes('FAILED')) {
                badgeClass = 'badge-error';
                icon = 'fa-exclamation-circle';
            }
            
            return \`<span class="action-badge \${badgeClass}">
                <i class="fas \${icon}"></i>
                \${action}
            </span>\`;
        }

        function showLoading() {
            loadingEl.style.display = 'flex';
            dateGridEl.style.display = 'none';
        }

        function hideLoading() {
            loadingEl.style.display = 'none';
            dateGridEl.style.display = 'grid';
        }

        function showError(message) {
            errorMessageEl.textContent = message;
            errorContainerEl.classList.add('active');
        }

        function hideError() {
            errorContainerEl.classList.remove('active');
        }

        function showNoData() {
            noDataEl.style.display = 'block';
            dateGridEl.style.display = 'none';
        }

        function hideNoData() {
            noDataEl.style.display = 'none';
            dateGridEl.style.display = 'grid';
        }
    </script>
</body>
</html>
`;

// ======================================================
// UNIFIED SECURE DASHBOARD HTML
// ======================================================

const DASHBOARD_HTML = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>📊 Altair Partners - Secure Dashboard</title>
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
            font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
        }

        body {
            background: linear-gradient(135deg, #1e3c72 0%, #2a5298 100%);
            min-height: 100vh;
            padding: 20px;
            color: white;
        }

        .container {
            max-width: 1400px;
            margin: 0 auto;
            background: rgba(255, 255, 255, 0.95);
            border-radius: 20px;
            box-shadow: 0 20px 60px rgba(0,0,0,0.5);
            overflow: hidden;
            color: #333;
        }

        .header {
            background: linear-gradient(to right, #4f46e5, #7c3aed);
            color: white;
            padding: 30px 40px;
            border-bottom: 1px solid rgba(255,255,255,0.1);
        }

        .header h1 {
            font-size: 2.5rem;
            margin-bottom: 10px;
            display: flex;
            align-items: center;
            gap: 15px;
        }

        .security-banner {
            background: #fee2e2;
            color: #991b1b;
            padding: 15px;
            border-radius: 10px;
            margin: 20px 0;
            border: 2px solid #ef4444;
            text-align: center;
            font-weight: 600;
        }

        .dashboard-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(350px, 1fr));
            gap: 25px;
            padding: 30px;
        }

        .dashboard-card {
            background: white;
            padding: 30px;
            border-radius: 15px;
            box-shadow: 0 10px 30px rgba(0,0,0,0.1);
            transition: all 0.3s ease;
            border: 2px solid #e2e8f0;
            text-align: center;
        }

        .dashboard-card:hover {
            transform: translateY(-10px);
            box-shadow: 0 20px 40px rgba(0,0,0,0.2);
        }

        .card-icon {
            font-size: 3.5rem;
            margin-bottom: 20px;
            height: 80px;
            display: flex;
            align-items: center;
            justify-content: center;
        }

        .card-title {
            font-size: 1.8rem;
            font-weight: 700;
            margin-bottom: 15px;
            color: #1e293b;
        }

        .card-description {
            color: #64748b;
            margin-bottom: 25px;
            line-height: 1.6;
        }

        .card-btn {
            display: inline-block;
            padding: 12px 30px;
            background: linear-gradient(to right, #4f46e5, #7c3aed);
            color: white;
            text-decoration: none;
            border-radius: 10px;
            font-weight: 600;
            font-size: 1.1rem;
            transition: all 0.3s ease;
            border: none;
            cursor: pointer;
            width: 100%;
        }

        .card-btn:hover {
            background: linear-gradient(to right, #4338ca, #6d28d9);
            transform: translateY(-2px);
            box-shadow: 0 5px 15px rgba(79, 70, 229, 0.4);
        }

        .system-status {
            background: #f8fafc;
            padding: 25px;
            border-radius: 15px;
            margin: 30px;
            border-left: 5px solid #10b981;
        }

        .status-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 15px;
            margin-top: 15px;
        }

        .status-item {
            background: white;
            padding: 15px;
            border-radius: 10px;
            text-align: center;
            border: 1px solid #e2e8f0;
        }

        .status-label {
            color: #64748b;
            font-size: 0.9rem;
            margin-bottom: 5px;
        }

        .status-value {
            color: #1e293b;
            font-size: 1.3rem;
            font-weight: 700;
        }

        .active {
            color: #10b981;
        }

        .inactive {
            color: #ef4444;
        }

        .logout-btn {
            display: block;
            width: 200px;
            margin: 30px auto;
            padding: 12px;
            background: #64748b;
            color: white;
            text-align: center;
            border-radius: 10px;
            text-decoration: none;
            font-weight: 600;
            transition: all 0.3s ease;
        }

        .logout-btn:hover {
            background: #475569;
        }

        .iframe-container {
            display: none;
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0,0,0,0.9);
            z-index: 1000;
            padding: 20px;
        }

        .iframe-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            background: #1e293b;
            color: white;
            padding: 15px 20px;
            border-radius: 10px 10px 0 0;
        }

        .close-btn {
            background: #ef4444;
            color: white;
            border: none;
            padding: 8px 15px;
            border-radius: 5px;
            cursor: pointer;
            font-weight: 600;
        }

        .iframe-content {
            background: white;
            height: calc(100vh - 100px);
            border-radius: 0 0 10px 10px;
            overflow: hidden;
        }

        iframe {
            width: 100%;
            height: 100%;
            border: none;
        }

        @media (max-width: 768px) {
            .dashboard-grid {
                grid-template-columns: 1fr;
                padding: 15px;
            }
            
            .header h1 {
                font-size: 2rem;
            }
            
            .card-title {
                font-size: 1.5rem;
            }
        }
    </style>
</head>
<body>
    <div class="container">
        <!-- Header -->
        <div class="header">
            <h1>
                <i class="fas fa-shield-alt"></i>
                Altair Partners - Secure Dashboard
            </h1>
            <p>All systems in one secure location</p>
        </div>

        <!-- Security Banner -->
        <div class="security-banner">
            🔒 SECURE ACCESS | Username: altair_admin | Password: AltairSecure2024!@#$ | Change in .env file
        </div>

        <!-- Dashboard Grid -->
        <div class="dashboard-grid">
            <!-- Archive Viewer Card -->
            <div class="dashboard-card">
                <div class="card-icon" style="color: #8b5cf6;">
                    <i class="fas fa-archive"></i>
                </div>
                <div class="card-title">🗂️ Archive Viewer</div>
                <div class="card-description">
                    Browse all call logs, appointments, AI conversations, and reminders. Beautiful interface with search.
                </div>
                <button class="card-btn" onclick="openDashboard('archive')">
                    <i class="fas fa-external-link-alt"></i> Open Archive
                </button>
            </div>

            <!-- Appointments Card -->
            <div class="dashboard-card">
                <div class="card-icon" style="color: #ef4444;">
                    <i class="fas fa-calendar-check"></i>
                </div>
                <div class="card-title">📅 Appointments</div>
                <div class="card-description">
                    View all scheduled appointments. See upcoming meetings, dates, times, and client information.
                </div>
                <button class="card-btn" onclick="openDashboard('appointments')">
                    <i class="fas fa-external-link-alt"></i> View Appointments
                </button>
            </div>

            <!-- Analytics Card -->
            <div class="dashboard-card">
                <div class="card-icon" style="color: #4f46e5;">
                    <i class="fas fa-chart-line"></i>
                </div>
                <div class="card-title">📈 Analytics Dashboard</div>
                <div class="card-description">
                    Real-time call analytics, charts, and statistics. Track conversions, sentiment, and performance.
                </div>
                <button class="card-btn" onclick="openDashboard('analytics')">
                    <i class="fas fa-external-link-alt"></i> Open Analytics
                </button>
            </div>

            <!-- Debug Card -->
            <div class="dashboard-card">
                <div class="card-icon" style="color: #f59e0b;">
                    <i class="fas fa-cogs"></i>
                </div>
                <div class="card-title">🔧 System Debug</div>
                <div class="card-description">
                    Technical dashboard for system monitoring, logs, and debugging. Check server status and errors.
                </div>
                <button class="card-btn" onclick="openDashboard('debug')">
                    <i class="fas fa-external-link-alt"></i> Open Debug
                </button>
            </div>
        </div>

        <!-- System Status -->
        <div class="system-status">
            <h3 style="color: #1e293b; margin-bottom: 15px;"><i class="fas fa-server"></i> System Status</h3>
            <div class="status-grid" id="systemStatus">
                <div class="status-item">
                    <div class="status-label">Server</div>
                    <div class="status-value active">ONLINE</div>
                </div>
                <div class="status-item">
                    <div class="status-label">IVR System</div>
                    <div class="status-value active">RUNNING</div>
                </div>
                <div class="status-item">
                    <div class="status-label">Database</div>
                    <div class="status-value active">ACTIVE</div>
                </div>
                <div class="status-item">
                    <div class="status-label">Archive System</div>
                    <div class="status-value active">WORKING</div>
                </div>
            </div>
        </div>

        <!-- Logout -->
        <a href="/" class="logout-btn">
            <i class="fas fa-sign-out-alt"></i> Back to Main Page
        </a>
    </div>

    <!-- Dashboard Container (Hidden until clicked) -->
    <div class="iframe-container" id="dashboardContainer">
        <div class="iframe-header">
            <div id="dashboardTitle">Dashboard</div>
            <button class="close-btn" onclick="closeDashboard()">
                <i class="fas fa-times"></i> Close
            </button>
        </div>
        <div class="iframe-content">
            <iframe id="dashboardFrame" src=""></iframe>
        </div>
    </div>

    <script>
        // Dashboard URLs mapping
        const dashboardUrls = {
            'analytics': '/debug',
            'archive': '/archive-viewer',
            'debug': '/debug',
            'appointments': '/debug'
        };

        const dashboardTitles = {
            'analytics': '📈 Analytics Dashboard',
            'archive': '🗂️ Archive Viewer',
            'debug': '🔧 System Debug',
            'appointments': '📅 Appointments'
        };

        function openDashboard(type) {
            const url = dashboardUrls[type];
            const title = dashboardTitles[type];
            
            if (!url) {
                alert('Dashboard not available');
                return;
            }

            document.getElementById('dashboardTitle').textContent = title;
            document.getElementById('dashboardFrame').src = url;
            document.getElementById('dashboardContainer').style.display = 'block';
            document.body.style.overflow = 'hidden';
        }

        function closeDashboard() {
            document.getElementById('dashboardContainer').style.display = 'none';
            document.getElementById('dashboardFrame').src = '';
            document.body.style.overflow = 'auto';
        }

        // Close with ESC key
        document.addEventListener('keydown', function(event) {
            if (event.key === 'Escape') {
                closeDashboard();
            }
        });

        // Check system status on load
        window.addEventListener('load', function() {
            fetch('/health')
                .then(response => {
                    if (!response.ok) {
                        document.querySelectorAll('.status-value')[0].textContent = 'OFFLINE';
                        document.querySelectorAll('.status-value')[0].className = 'status-value inactive';
                    }
                })
                .catch(error => {
                    document.querySelectorAll('.status-value')[0].textContent = 'OFFLINE';
                    document.querySelectorAll('.status-value')[0].className = 'status-value inactive';
                });
        });
    </script>
</body>
</html>
`;

// ======================================================
// ДНЕВНЫЕ АРХИВЫ - API ENDPOINTS
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
      phoneDetails: phoneDetails.slice(0, 100),
      logs: logs.slice(0, 50),
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
// IVR LOGIC CONTINUES... 
// (Здесь должна быть остальная IVR логика из второго кода)
// ======================================================

// REPRESENTATIVE (Option 2) - БЫСТРЫЙ AI
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
    twiml.redirect('/get-name');
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

// APPOINTMENT FLOW
app.post('/get-name', (req, res) => {
  const twiml = new VoiceResponse();
  const phone = req.body.From;
  
  console.log(`📝 Getting name for: ${phone}`);
  
  logCall(phone, 'APPOINTMENT_FLOW_STARTED');

  const gather = twiml.gather({
    input: 'speech',
    action: '/verify-name',
    method: 'POST',
    speechTimeout: 3,
    timeout: 10,
    speechModel: 'phone_call',
    enhanced: true
  });
  
  gather.say("First question: What is your full name?", { voice: 'alice', language: 'en-US' });
  
  twiml.say("I didn't hear your name. Please try again.", { voice: 'alice', language: 'en-US' });
  twiml.redirect('/get-name');
  
  res.type('text/xml');
  res.send(twiml.toString());
});

app.post('/verify-name', (req, res) => {
  const twiml = new VoiceResponse();
  const name = req.body.SpeechResult || '';
  const phone = req.body.From;
  
  console.log(`📝 Name received: ${name} for ${phone}`);
  
  if (!name || name.trim() === '') {
    twiml.say("Sorry, I didn't catch your name. Let's try again.", { voice: 'alice', language: 'en-US' });
    twiml.redirect('/get-name');
    return res.type('text/xml').send(twiml.toString());
  }
  
  const gather = twiml.gather({
    input: 'speech dtmf',
    action: `/get-business-type?name=${encodeURIComponent(name)}`,
    method: 'POST',
    speechTimeout: 3,
    timeout: 10
  });
  
  gather.say(`I heard: ${name}. Is this correct? Say yes or no.`, { voice: 'alice', language: 'en-US' });
  
  twiml.say("No response received. Let's try again.", { voice: 'alice', language: 'en-US' });
  twiml.redirect('/get-name');
  
  res.type('text/xml');
  res.send(twiml.toString());
});

app.post('/get-business-type', (req, res) => {
  const twiml = new VoiceResponse();
  const response = req.body.SpeechResult || req.body.Digits || '';
  const phone = req.body.From;
  const name = decodeURIComponent(req.query.name || '');
  
  console.log(`📝 Name verification: ${response} for ${name}`);
  
  const lowerResponse = response.toLowerCase();
  
  if (lowerResponse.includes('no') || lowerResponse === '2') {
    twiml.say("Let's try again. What is your full name?", { voice: 'alice', language: 'en-US' });
    twiml.redirect('/get-name');
    return res.type('text/xml').send(twiml.toString());
  }
  
  const gather = twiml.gather({
    input: 'speech',
    action: `/verify-business-type?name=${encodeURIComponent(name)}`,
    method: 'POST',
    speechTimeout: 3,
    timeout: 10
  });
  
  gather.say(`Thanks ${name}. Second question: What type of business do you have?`, 
    { voice: 'alice', language: 'en-US' });
  
  twiml.say("I didn't hear your business type. Please try again.", { voice: 'alice', language: 'en-US' });
  twiml.redirect('/get-business-type');
  
  res.type('text/xml');
  res.send(twiml.toString());
});

app.post('/verify-business-type', (req, res) => {
  const twiml = new VoiceResponse();
  const businessType = req.body.SpeechResult || '';
  const phone = req.body.From;
  const name = decodeURIComponent(req.query.name || '');
  
  console.log(`🏢 Business type: ${businessType} for ${name}`);
  
  if (!businessType || businessType.trim() === '') {
    twiml.say("Sorry, I didn't catch your business type. Let's try again.", { voice: 'alice', language: 'en-US' });
    twiml.redirect('/get-business-type');
    return res.type('text/xml').send(twiml.toString());
  }
  
  const gather = twiml.gather({
    input: 'speech dtmf',
    action: `/get-service-type?name=${encodeURIComponent(name)}&businessType=${encodeURIComponent(businessType)}`,
    method: 'POST',
    speechTimeout: 3,
    timeout: 10
  });
  
  gather.say(`I heard: ${businessType}. Is this correct? Say yes or no.`, { voice: 'alice', language: 'en-US' });
  
  twiml.say("No response received. Let's try again.", { voice: 'alice', language: 'en-US' });
  twiml.redirect('/get-business-type');
  
  res.type('text/xml');
  res.send(twiml.toString());
});

app.post('/get-service-type', (req, res) => {
  const twiml = new VoiceResponse();
  const response = req.body.SpeechResult || req.body.Digits || '';
  const phone = req.body.From;
  const name = decodeURIComponent(req.query.name || '');
  const businessType = decodeURIComponent(req.query.businessType || '');
  
  console.log(`🏢 Business verification: ${response} for ${businessType}`);
  
  const lowerResponse = response.toLowerCase();
  
  if (lowerResponse.includes('no') || lowerResponse === '2') {
    twiml.say("Let's try again. What type of business do you have?", { voice: 'alice', language: 'en-US' });
    twiml.redirect('/get-business-type');
    return res.type('text/xml').send(twiml.toString());
  }
  
  const gather = twiml.gather({
    input: 'speech',
    action: `/verify-service-type?name=${encodeURIComponent(name)}&businessType=${encodeURIComponent(businessType)}`,
    method: 'POST',
    speechTimeout: 3,
    timeout: 10
  });
  
  gather.say("Third question: What type of service are you looking for?", 
    { voice: 'alice', language: 'en-US' });
  
  twiml.say("I didn't hear your service type. Please try again.", { voice: 'alice', language: 'en-US' });
  twiml.redirect('/get-service-type');
  
  res.type('text/xml');
  res.send(twiml.toString());
});

app.post('/verify-service-type', (req, res) => {
  const twiml = new VoiceResponse();
  const serviceType = req.body.SpeechResult || '';
  const phone = req.body.From;
  const name = decodeURIComponent(req.query.name || '');
  const businessType = decodeURIComponent(req.query.businessType || '');
  
  console.log(`🔧 Service type: ${serviceType} for ${name}`);
  
  if (!serviceType || serviceType.trim() === '') {
    twiml.say("Sorry, I didn't catch your service type. Let's try again.", { voice: 'alice', language: 'en-US' });
    twiml.redirect('/get-service-type');
    return res.type('text/xml').send(twiml.toString());
  }
  
  const gather = twiml.gather({
    input: 'speech dtmf',
    action: `/schedule-date?name=${encodeURIComponent(name)}&businessType=${encodeURIComponent(businessType)}&serviceType=${encodeURIComponent(serviceType)}`,
    method: 'POST',
    speechTimeout: 3,
    timeout: 10
  });
  
  gather.say(`I heard: ${serviceType}. Is this correct? Say yes or no.`, { voice: 'alice', language: 'en-US' });
  
  twiml.say("No response received. Let's try again.", { voice: 'alice', language: 'en-US' });
  twiml.redirect('/get-service-type');
  
  res.type('text/xml');
  res.send(twiml.toString());
});

app.post('/schedule-date', (req, res) => {
  const twiml = new VoiceResponse();
  const response = req.body.SpeechResult || req.body.Digits || '';
  const phone = req.body.From;
  const name = decodeURIComponent(req.query.name || '');
  const businessType = decodeURIComponent(req.query.businessType || '');
  const serviceType = decodeURIComponent(req.query.serviceType || '');
  
  console.log(`🔧 Service verification: ${response} for ${serviceType}`);
  
  const lowerResponse = response.toLowerCase();
  
  if (lowerResponse.includes('no') || lowerResponse === '2') {
    twiml.say("Let's try again. What type of service are you looking for?", { voice: 'alice', language: 'en-US' });
    twiml.redirect('/get-service-type');
    return res.type('text/xml').send(twiml.toString());
  }
  
  const nextDate = getNextAvailableDate();
  
  const gather = twiml.gather({
    input: 'speech',
    action: `/schedule-time?name=${encodeURIComponent(name)}&businessType=${encodeURIComponent(businessType)}&serviceType=${encodeURIComponent(serviceType)}&date=${encodeURIComponent(nextDate)}`,
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
  twiml.redirect('/schedule-date');
  
  res.type('text/xml');
  res.send(twiml.toString());
});

app.post('/schedule-time', (req, res) => {
  const twiml = new VoiceResponse();
  const time = req.body.SpeechResult || '';
  const phone = req.body.From;
  const name = decodeURIComponent(req.query.name || '');
  const businessType = decodeURIComponent(req.query.businessType || '');
  const serviceType = decodeURIComponent(req.query.serviceType || '');
  const date = decodeURIComponent(req.query.date || '');
  
  console.log(`⏰ Time received: ${time} for ${date}`);
  
  if (!time || time.trim() === '') {
    twiml.say("Sorry, I didn't catch the time. Let's try again.", { voice: 'alice', language: 'en-US' });
    twiml.redirect('/schedule-date');
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
        to: '+15035442571'
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

// CANCEL / RESCHEDULE APPOINTMENT
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
    twiml.redirect('/get-name');
  }

  else {
    twiml.say("Invalid option. Returning to main menu.", { voice: 'alice', language: 'en-US' });
    twiml.redirect('/voice');
  }

  res.type('text/xml');
  res.send(twiml.toString());
});

// CALLBACK REQUEST (Option 3)
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
    to: '+15035442571'
  });
  
  twiml.hangup();

  res.type('text/xml');
  res.send(twiml.toString());
});

// PARTNERSHIP (Option 4)
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
// DASHBOARD ENDPOINTS
// ======================================================

// Secure Dashboard
app.get('/dashboard', requireAuth, (req, res) => {
  res.send(DASHBOARD_HTML);
});

// Archive Viewer
app.get('/archive-viewer', requireAuth, (req, res) => {
  res.send(ARCHIVE_VIEWER_HTML);
});

// ======================================================
// MAIN ENDPOINTS
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
      allDates: `/daily-archives`,
      beautifulViewer: `/archive-viewer`
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
    selfPing: process.env.FREE_PLAN === 'true' ? 'Active (4 min interval)' : 'Inactive',
    dashboards: {
      secureDashboard: '/dashboard (password protected)',
      archiveViewer: '/archive-viewer'
    }
  });
});

// Главная страница БЕЗ ЛОГИНА И ПАРОЛЯ
app.get('/', (req, res) => {
  const businessStatus = getBusinessStatus();
  
  res.send(`
    <html>
      <head>
        <title>Altair Partners IVR Server</title>
        <style>
          body { 
            font-family: Arial, sans-serif; 
            padding: 20px; 
            max-width: 1000px; 
            margin: 0 auto; 
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); 
            min-height: 100vh;
            color: white;
          }
          .main-container { 
            background: rgba(255, 255, 255, 0.95); 
            padding: 40px; 
            border-radius: 20px; 
            box-shadow: 0 20px 60px rgba(0,0,0,0.3);
            color: #333;
          }
          .status { 
            padding: 20px; 
            border-radius: 10px; 
            margin: 15px 0; 
          }
          .open { 
            background: linear-gradient(to right, #10b981, #34d399); 
            color: white; 
          }
          .closed { 
            background: linear-gradient(to right, #ef4444, #f97316); 
            color: white; 
          }
          .dashboard-btn { 
            display: block; 
            width: 100%; 
            padding: 20px; 
            background: linear-gradient(to right, #4f46e5, #7c3aed); 
            color: white; 
            text-align: center; 
            border-radius: 15px; 
            text-decoration: none; 
            font-weight: 600; 
            font-size: 1.2rem; 
            margin: 15px 0; 
            transition: all 0.3s ease; 
          }
          .dashboard-btn:hover { 
            background: linear-gradient(to right, #4338ca, #6d28d9); 
            transform: translateY(-5px); 
            box-shadow: 0 10px 30px rgba(79, 70, 229, 0.4); 
          }
          .system-info { 
            background: #f0f9ff; 
            padding: 20px; 
            border-radius: 10px; 
            margin: 20px 0; 
            border: 2px solid #0ea5e9; 
          }
          .cta-button { 
            display: inline-block; 
            background: linear-gradient(to right, #10b981, #34d399); 
            color: white; 
            padding: 12px 24px; 
            border-radius: 10px; 
            text-decoration: none; 
            font-weight: 600; 
            margin: 10px 5px; 
            transition: all 0.3s ease; 
          }
          .cta-button:hover { 
            transform: translateY(-3px); 
            box-shadow: 0 10px 20px rgba(16, 185, 129, 0.3); 
            text-decoration: none; 
          }
          h1 { 
            color: #1e293b; 
            margin-bottom: 20px; 
            display: flex; 
            align-items: center; 
            gap: 15px; 
          }
        </style>
      </head>
      <body>
        <div class="main-container">
          <h1>
            <span style="font-size: 2rem;">🚀</span>
            Altair Partners IVR System
          </h1>
          
          <div class="status ${businessStatus.isOpen ? 'open' : 'closed'}">
            <p><strong>Status:</strong> ${businessStatus.isOpen ? '🟢 OPEN' : '🔴 CLOSED'}</p>
            <p><strong>Current Time (PST):</strong> ${businessStatus.currentTime}</p>
            <p><strong>Business Hours:</strong> ${businessStatus.hours}</p>
            <p>${businessStatus.isOpen ? '✅ Currently open' : '⏰ ' + businessStatus.nextOpenTime}</p>
          </div>
          
          <div class="system-info">
            <h3 style="color: #0369a1; margin-top: 0;">🚀 NEW UNIFIED DASHBOARD!</h3>
            <p><strong>🔐 Secure Access:</strong> All dashboards protected with password</p>
            <p><strong>📊 Everything in One Place:</strong> Analytics, Archive, Appointments, Debug</p>
            <p><strong>🎯 Easy Navigation:</strong> Click any system to open in popup</p>
          </div>
          
          <a href="/dashboard" class="dashboard-btn">
            <span style="font-size: 1.5rem; margin-right: 10px;">🔐</span>
            ENTER SECURE DASHBOARD
          </a>
          
          <p style="text-align: center; margin-top: 10px;">
            <a href="/archive-viewer" class="cta-button">
              🗂️ Open Archive Viewer
            </a>
            <a href="/debug" class="cta-button">
              🔧 System Debug
            </a>
          </p>
          
          <div style="margin-top: 30px; padding-top: 20px; border-top: 2px solid #e2e8f0;">
            <p><strong>📞 Twilio Webhook:</strong> POST /voice</p>
            <p><strong>📈 Instant Archive System:</strong> Все звонки сохраняются сразу!</p>
            <p><strong>🗂️ Beautiful Archive:</strong> /archive-viewer - Красивый интерфейс с кнопками</p>
            <p><strong>⏰ Reminder System:</strong> Calls ONE DAY BEFORE appointment at 2 PM PST</p>
            <p><strong>🔔 Test Call:</strong> +1 (503) 444-8881</p>
            <p><strong>📱 Admin Notifications:</strong> Sent to +1 (503) 544-2571</p>
          </div>
        </div>
      </body>
    </html>
  `);
});

// ======================================================
// START SERVER WITH REMINDER SYSTEM
// ======================================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  const businessStatus = getBusinessStatus();
  const serverUrl = process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`;
  
  console.log(`🚀 Altair Partners IVR Server running on port ${PORT}`);
  console.log(`⏰ Business Status: ${businessStatus.isOpen ? 'OPEN' : 'CLOSED'}`);
  console.log(`📅 Next Open: ${businessStatus.nextOpenTime}`);
  console.log(`🌐 Server URL: ${serverUrl}`);
  
  console.log(`\n🚀 NEW UNIFIED DASHBOARD:`);
  console.log(`✅ ${serverUrl}/dashboard - ALL SYSTEMS IN ONE PLACE`);
  console.log(`🔐 Password: altair_admin / AltairSecure2024!@#$`);
  
  console.log(`\n📊 INDIVIDUAL SYSTEMS:`);
  console.log(`✅ ${serverUrl}/archive-viewer - КРАСИВЫЙ АРХИВ С КНОПКАМИ`);
  console.log(`✅ ${serverUrl}/daily-archives - Все архивы в JSON`);
  console.log(`✅ ${serverUrl}/debug - System Debug`);
  
  console.log(`\n🔒 SECURITY INFO:`);
  console.log(`✅ Username: altair_admin`);
  console.log(`✅ Password: AltairSecure2024!@#$`);
  console.log(`📱 Notifications sent to: +1 (503) 544-2571`);
  
  console.log(`\n🗂️ ARCHIVE SYSTEM:`);
  console.log(`✅ INSTANT MODE - сохраняет сразу после звонка`);
  console.log(`✅ Красивый интерфейс с кнопками и анимациями`);
  console.log(`✅ Поиск по датам и номерам`);
  console.log(`✅ Все данные: calls, appointments, ai, reminders`);
  
  console.log(`\n📈 АНАЛИТИКА:`);
  console.log(`✅ Все звонки логируются`);
  console.log(`✅ Appointments сохраняются`);
  console.log(`✅ AI conversations архивируются`);
  console.log(`✅ Reminders отслеживаются`);
  
  // Запускаем reminder scheduler
  startReminderScheduler();
  
  console.log(`\n✅ INSTANT ARCHIVE SYSTEM READY - Все звонки будут сохраняться сразу!`);
  console.log(`✅ BEAUTIFUL DASHBOARD READY - Открывай ${serverUrl}/dashboard`);
  console.log(`✅ АРХИВ РАБОТАЕТ - ${serverUrl}/archive-viewer`);
});