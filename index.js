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
// SECURITY: PASSWORD PROTECTION FOR ARCHIVES
// ======================================================

function requireArchiveAuth(req, res, next) {
  const AUTH_USERNAME = process.env.ARCHIVE_USERNAME || 'altair_admin';
  const AUTH_PASSWORD = process.env.ARCHIVE_PASSWORD || 'AltairSecure2024!@#$';
  
  const user = basicAuth(req);
  
  if (!user || user.name !== AUTH_USERNAME || user.pass !== AUTH_PASSWORD) {
    console.log(`🔒 Unauthorized access attempt from IP: ${req.ip} - User: ${user ? user.name : 'none'}`);
    
    res.set('WWW-Authenticate', 'Basic realm="Altair Partners Archive - Secure Access"');
    return res.status(401).send(`
      <html>
        <head>
          <title>🔒 401 - Secure Archive Access</title>
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
            .credentials {
              background: #f8fafc;
              padding: 20px;
              border-radius: 10px;
              margin: 20px 0;
              text-align: left;
            }
            .cred-item {
              display: flex;
              justify-content: space-between;
              padding: 10px 0;
              border-bottom: 1px solid #e2e8f0;
            }
            .cred-item:last-child {
              border-bottom: none;
            }
            .label {
              color: #475569;
              font-weight: 600;
            }
            .value {
              font-family: 'SF Mono', Monaco, monospace;
              background: #f1f5f9;
              padding: 4px 12px;
              border-radius: 6px;
              color: #1e293b;
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
            <h1>Secure Archive Access</h1>
            <p class="subtitle">This archive contains confidential call data and is password protected</p>
            
            <div class="credentials">
              <div class="cred-item">
                <span class="label">Username:</span>
                <span class="value">${AUTH_USERNAME}</span>
              </div>
              <div class="cred-item">
                <span class="label">Password:</span>
                <span class="value">•••••••••••</span>
              </div>
            </div>
            
            <div class="warning">
              ⚠️ <strong>SECURITY NOTICE:</strong> All access attempts are logged and monitored.
              Unauthorized access is strictly prohibited.
            </div>
            
            <p class="note">Access restricted to Altair Partners authorized personnel only.</p>
            <p class="note">Please contact the system administrator if you need credentials.</p>
          </div>
        </body>
      </html>
    `);
  }
  
  console.log(`🔓 Authorized archive access from ${req.ip} - User: ${user.name}`);
  next();
}

// ======================================================
// ANALYTICS FUNCTIONS - НОВАЯ АНАЛИТИКА!
// ======================================================

// Трекер пути пользователя
const userJourneyTracker = {};

function startUserJourney(phone) {
  userJourneyTracker[phone] = {
    startTime: new Date(),
    path: ['MAIN_MENU'],
    optionsSelected: [],
    speechTranscripts: [],
    pagesVisited: [],
    lastActionTime: new Date(),
    totalDuration: 0,
    conversion: false,
    sentiment: 'neutral',
    callQuality: 'good',
    deviceType: 'phone', // по умолчанию
    location: 'unknown',
    hangupReason: '',
    frustrationLevel: 0
  };
}

function trackUserAction(phone, action, details = {}) {
  if (!userJourneyTracker[phone]) {
    startUserJourney(phone);
  }
  
  userJourneyTracker[phone].path.push(action);
  userJourneyTracker[phone].lastActionTime = new Date();
  
  if (details.option) {
    userJourneyTracker[phone].optionsSelected.push(details.option);
  }
  
  if (details.speech) {
    userJourneyTracker[phone].speechTranscripts.push({
      text: details.speech,
      time: new Date().toISOString()
    });
  }
  
  // Определяем настроение по словам
  if (details.speech) {
    const text = details.speech.toLowerCase();
    if (text.includes('спасибо') || text.includes('отлично') || text.includes('хорошо')) {
      userJourneyTracker[phone].sentiment = 'positive';
    } else if (text.includes('проблем') || text.includes('жалоб') || text.includes('плох')) {
      userJourneyTracker[phone].sentiment = 'negative';
      userJourneyTracker[phone].frustrationLevel += 1;
    }
  }
  
  console.log(`📊 Analytics: ${phone} -> ${action}`);
}

function completeUserJourney(phone, reason = 'normal_hangup') {
  if (!userJourneyTracker[phone]) return null;
  
  const journey = userJourneyTracker[phone];
  journey.endTime = new Date();
  journey.totalDuration = (journey.endTime - journey.startTime) / 1000; // секунды
  journey.hangupReason = reason;
  journey.conversion = journey.path.includes('APPOINTMENT_SCHEDULED') || 
                      journey.path.includes('CALLBACK_REQUESTED');
  
  // Сохраняем аналитику
  saveAnalytics(phone, journey);
  
  // Очищаем трекер
  delete userJourneyTracker[phone];
  
  return journey;
}

// Определяем тип устройства по User-Agent
function detectDevice(req) {
  const agent = req.headers['user-agent'] || '';
  if (agent.includes('Mobile')) return 'mobile';
  if (agent.includes('Tablet')) return 'tablet';
  return 'desktop';
}

// Анализируем качество звонка по длительности
function analyzeCallQuality(duration) {
  if (duration < 10) return 'poor'; // Слишком короткий
  if (duration > 300) return 'excellent'; // Долгий разговор
  return 'good';
}

// ======================================================
// SELF-PING SYSTEM (to keep server awake on Free plan)
// ======================================================
if (process.env.NODE_ENV !== 'production' || process.env.FREE_PLAN === 'true') {
  const PING_INTERVAL = 4 * 60 * 1000; // 4 minutes
  
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
  
  // First ping immediately after startup
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
// JSON DATABASE & LOGGING WITH INSTANT ARCHIVING
// ======================================================

// Logs folders
const LOGS_DIR = "./logs";
const CURRENT_LOGS_DIR = `${LOGS_DIR}/current`;
const DAILY_LOGS_DIR = `${LOGS_DIR}/daily`;
const ANALYTICS_DIR = `${LOGS_DIR}/analytics`;

// Create folders if they don't exist
if (!fs.existsSync(LOGS_DIR)) fs.mkdirSync(LOGS_DIR);
if (!fs.existsSync(CURRENT_LOGS_DIR)) fs.mkdirSync(CURRENT_LOGS_DIR);
if (!fs.existsSync(DAILY_LOGS_DIR)) fs.mkdirSync(DAILY_LOGS_DIR);
if (!fs.existsSync(ANALYTICS_DIR)) fs.mkdirSync(ANALYTICS_DIR);

// Paths to current logs
const DB_PATH = `${CURRENT_LOGS_DIR}/appointments.json`;
const CALL_LOGS_PATH = `${CURRENT_LOGS_DIR}/call_logs.json`;
const AI_CONVERSATIONS_PATH = `${CURRENT_LOGS_DIR}/ai_conversations.json`;
const REMINDERS_LOG = `${CURRENT_LOGS_DIR}/reminders_log.json`;
const ANALYTICS_PATH = `${ANALYTICS_DIR}/call_analytics.json`;

// ======================================================
// INSTANT ARCHIVING FUNCTIONS (IMMEDIATELY AFTER CALL!)
// ======================================================

function getTodayDateString() {
  const now = new Date();
  return now.toISOString().split('T')[0]; // "2025-12-24"
}

// НОВАЯ: Сохраняем аналитику
function saveAnalytics(phone, journey) {
  try {
    const analyticsFile = `${ANALYTICS_DIR}/analytics-${getTodayDateString()}.json`;
    
    let existingAnalytics = [];
    
    if (fs.existsSync(analyticsFile)) {
      try {
        const fileData = fs.readFileSync(analyticsFile, "utf8");
        if (fileData.trim() !== '') {
          existingAnalytics = JSON.parse(fileData);
        }
      } catch (e) {
        console.log(`⚠️ Creating new analytics file for today`);
      }
    }
    
    // Добавляем новую аналитику
    existingAnalytics.push({
      phone,
      ...journey,
      analyticsDate: getTodayDateString()
    });
    
    // Сохраняем
    fs.writeFileSync(analyticsFile, JSON.stringify(existingAnalytics, null, 2));
    
    // Также сохраняем в общий файл для быстрого доступа
    saveToCurrentAnalytics(phone, journey);
    
    console.log(`📈 Analytics saved for ${phone} (${journey.totalDuration}s, conversion: ${journey.conversion})`);
    
  } catch (error) {
    console.error(`❌ Error saving analytics:`, error);
  }
}

// Сохраняем аналитику в текущие логи
function saveToCurrentAnalytics(phone, journey) {
  try {
    let currentAnalytics = [];
    
    if (fs.existsSync(ANALYTICS_PATH)) {
      try {
        const fileData = fs.readFileSync(ANALYTICS_PATH, "utf8");
        if (fileData.trim() !== '') {
          currentAnalytics = JSON.parse(fileData);
        }
      } catch (e) {
        console.log(`⚠️ Creating new current analytics file`);
      }
    }
    
    currentAnalytics.push({
      phone,
      ...journey,
      timestamp: new Date().toISOString()
    });
    
    // Ограничиваем размер (последние 1000 записей)
    if (currentAnalytics.length > 1000) {
      currentAnalytics = currentAnalytics.slice(-1000);
    }
    
    fs.writeFileSync(ANALYTICS_PATH, JSON.stringify(currentAnalytics, null, 2));
    
  } catch (error) {
    console.error(`❌ Error saving to current analytics:`, error);
  }
}

// Saves data IMMEDIATELY to daily archive
function saveToDailyArchive(type, data) {
  try {
    const today = getTodayDateString();
    const archiveFile = `${DAILY_LOGS_DIR}/${type}-${today}.json`;
    
    let existingData = [];
    
    // 1. Load existing data if file exists
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
    
    // 2. Add new data
    if (Array.isArray(data)) {
      // If array came - add all elements
      existingData.push(...data);
    } else {
      // If object came - add it
      existingData.push(data);
    }
    
    // 3. Limit size (last 2000 records)
    if (existingData.length > 2000) {
      existingData = existingData.slice(-2000);
    }
    
    // 4. Save to daily file
    fs.writeFileSync(archiveFile, JSON.stringify(existingData, null, 2));
    
    console.log(`✅ Instant archive: ${type} saved for ${today} (${existingData.length} records)`);
    
    // 5. Also save to current logs for quick access
    saveToCurrentLogs(type, data);
    
  } catch (error) {
    console.error(`❌ Instant archive error for ${type}:`, error);
  }
}

// Saves to current logs
function saveToCurrentLogs(type, data) {
  try {
    let filePath, currentData = [];
    
    // Determine file path
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
    
    // Load existing data
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
    
    // Add new data
    if (Array.isArray(data)) {
      currentData.push(...data);
    } else {
      currentData.push(data);
    }
    
    // Limit size
    if (currentData.length > 1000) {
      currentData = currentData.slice(-1000);
    }
    
    // Save
    fs.writeFileSync(filePath, JSON.stringify(currentData, null, 2));
    
  } catch (error) {
    console.error(`❌ Error saving to current logs for ${type}:`, error);
  }
}

// ======================================================
// УЛУЧШЕННОЕ ЛОГИРОВАНИЕ ЗВОНКОВ С АНАЛИТИКОЙ
// ======================================================

function logCall(phone, action, details = {}) {
  try {
    // Начинаем отслеживание если еще не начато
    if (action === 'CALL_RECEIVED') {
      startUserJourney(phone);
    }
    
    // Трекаем действие
    trackUserAction(phone, action, details);
    
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
      // НОВОЕ: Детальная аналитика
      analytics: {
        callStage: action,
        userJourney: userJourneyTracker[phone] ? userJourneyTracker[phone].path : [],
        optionsSelected: userJourneyTracker[phone] ? userJourneyTracker[phone].optionsSelected : [],
        sentiment: userJourneyTracker[phone] ? userJourneyTracker[phone].sentiment : 'neutral',
        frustrationLevel: userJourneyTracker[phone] ? userJourneyTracker[phone].frustrationLevel : 0,
        timeInSystem: userJourneyTracker[phone] ? 
          (new Date() - userJourneyTracker[phone].startTime) / 1000 : 0
      }
    };
    
    // INSTANT ARCHIVING to daily file
    saveToDailyArchive('calls', logEntry);
    
    console.log(`📝 Call logged: ${phone} - ${action}`);
    
    // Если звонок завершен, сохраняем полную аналитику
    if (action.includes('HANGUP') || action.includes('GOODBYE')) {
      completeUserJourney(phone, action);
    }
    
  } catch (error) {
    console.error("ERROR logging call:", error);
  }
}

// НОВАЯ: Логирование голосовых сообщений с транскрипцией
function logVoiceMessage(phone, transcript, details = {}) {
  try {
    const logEntry = {
      phone,
      action: 'VOICE_MESSAGE_RECORDED',
      transcript,
      details,
      timestamp: new Date().toISOString(),
      time: new Date().toLocaleString('en-US', { 
        timeZone: 'America/Los_Angeles',
        hour12: true
      }),
      analytics: {
        messageLength: transcript.length,
        wordCount: transcript.split(' ').length,
        containsKeywords: extractKeywords(transcript),
        sentiment: analyzeSentiment(transcript),
        urgencyLevel: checkUrgency(transcript)
      }
    };
    
    saveToDailyArchive('voice_messages', logEntry);
    console.log(`🎤 Voice message logged: ${phone} (${transcript.length} chars)`);
    
  } catch (error) {
    console.error("ERROR logging voice message:", error);
  }
}

// Вспомогательные функции для анализа
function extractKeywords(text) {
  const lower = text.toLowerCase();
  const keywords = [];
  
  const importantWords = [
    'appointment', 'schedule', 'meeting', 'urgent', 'important',
    'problem', 'issue', 'help', 'emergency', 'asap',
    'cancel', 'reschedule', 'change', 'update',
    'price', 'cost', 'money', 'payment', 'invoice',
    'complaint', 'angry', 'frustrated', 'disappointed'
  ];
  
  importantWords.forEach(word => {
    if (lower.includes(word)) {
      keywords.push(word);
    }
  });
  
  return keywords;
}

function analyzeSentiment(text) {
  const lower = text.toLowerCase();
  
  const positiveWords = ['thank', 'great', 'good', 'excellent', 'happy', 'perfect', 'love'];
  const negativeWords = ['angry', 'mad', 'bad', 'terrible', 'horrible', 'hate', 'disappointed'];
  
  let score = 0;
  
  positiveWords.forEach(word => {
    if (lower.includes(word)) score += 1;
  });
  
  negativeWords.forEach(word => {
    if (lower.includes(word)) score -= 1;
  });
  
  if (score > 0) return 'positive';
  if (score < 0) return 'negative';
  return 'neutral';
}

function checkUrgency(text) {
  const lower = text.toLowerCase();
  
  if (lower.includes('emergency') || lower.includes('urgent') || lower.includes('asap')) {
    return 'high';
  }
  
  if (lower.includes('soon') || lower.includes('quick') || lower.includes('fast')) {
    return 'medium';
  }
  
  return 'low';
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
    
    // INSTANT ARCHIVING
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
6. ANALYZE customer mood from their words
`;

async function getRepResponse(question, phone) {
  try {
    console.log(`🤖 AI Question: ${question}`);
    
    // Анализируем настроение
    const sentiment = analyzeSentiment(question);
    console.log(`📊 Customer sentiment: ${sentiment}`);
    
    // Трекаем что сказал пользователь
    if (userJourneyTracker[phone]) {
      userJourneyTracker[phone].speechTranscripts.push({
        text: question,
        time: new Date().toISOString(),
        sentiment: sentiment
      });
      
      if (sentiment === 'negative') {
        userJourneyTracker[phone].frustrationLevel += 1;
        console.log(`⚠️ Negative sentiment detected for ${phone}, frustration: ${userJourneyTracker[phone].frustrationLevel}`);
      }
    }
    
    const completion = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [
        {
          role: "system",
          content: `${REP_CONTEXT}\n\nCustomer mood: ${sentiment}. Respond in 5-10 words maximum.`
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
      }),
      // НОВОЕ: Аналитика разговора
      analytics: {
        questionLength: question.length,
        responseLength: response.length,
        questionSentiment: analyzeSentiment(question),
        responseSentiment: analyzeSentiment(response),
        containsAppointmentKeyword: question.toLowerCase().includes('appointment'),
        containsPriceKeyword: question.toLowerCase().includes('price') || question.toLowerCase().includes('cost')
      }
    };
    
    // INSTANT ARCHIVING
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
  
  // INSTANT ARCHIVING appointments
  saveToDailyArchive('appointments', appointment);
  
  console.log(`✅ Appointment added: ${name} - ${date} at ${time}`);
  
  logCall(phone, 'APPOINTMENT_SCHEDULED', {
    name,
    businessType,
    serviceType,
    date,
    time
  });
  
  // Отмечаем успешную конверсию
  if (userJourneyTracker[phone]) {
    userJourneyTracker[phone].conversion = true;
    userJourneyTracker[phone].sentiment = 'positive';
  }
  
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
// НОВАЯ: HTML СТРАНИЦА АНАЛИТИКИ
// ======================================================

const ANALYTICS_HTML = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>📈 Altair Partners - Call Analytics Dashboard</title>
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
    <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
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
            max-width: 1600px;
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

        .stats-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
            gap: 20px;
            padding: 30px;
            background: #f8fafc;
        }

        .stat-card {
            background: white;
            padding: 25px;
            border-radius: 15px;
            box-shadow: 0 5px 20px rgba(0,0,0,0.1);
            text-align: center;
            transition: transform 0.3s ease;
            border-left: 5px solid #4f46e5;
        }

        .stat-card:hover {
            transform: translateY(-5px);
        }

        .stat-number {
            font-size: 3rem;
            font-weight: 800;
            color: #4f46e5;
            margin-bottom: 10px;
        }

        .charts-container {
            padding: 30px;
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(500px, 1fr));
            gap: 30px;
        }

        .chart-box {
            background: white;
            padding: 25px;
            border-radius: 15px;
            box-shadow: 0 5px 20px rgba(0,0,0,0.1);
        }

        .chart-title {
            font-size: 1.3rem;
            font-weight: 600;
            margin-bottom: 20px;
            color: #1e293b;
            display: flex;
            align-items: center;
            gap: 10px;
        }

        .filters {
            padding: 20px 30px;
            background: #e2e8f0;
            display: flex;
            gap: 15px;
            align-items: center;
            flex-wrap: wrap;
        }

        .filter-btn {
            padding: 10px 20px;
            background: white;
            border: 2px solid #cbd5e1;
            border-radius: 10px;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.3s ease;
        }

        .filter-btn.active {
            background: #4f46e5;
            color: white;
            border-color: #4f46e5;
        }

        .call-list {
            padding: 30px;
        }

        .call-item {
            background: white;
            margin-bottom: 15px;
            padding: 20px;
            border-radius: 10px;
            border-left: 4px solid #4f46e5;
            box-shadow: 0 3px 10px rgba(0,0,0,0.1);
        }

        .call-header {
            display: flex;
            justify-content: space-between;
            margin-bottom: 10px;
        }

        .phone-number {
            font-family: monospace;
            background: #f1f5f9;
            padding: 5px 10px;
            border-radius: 5px;
            font-weight: 600;
        }

        .sentiment {
            padding: 3px 10px;
            border-radius: 20px;
            font-size: 0.8rem;
            font-weight: 600;
        }

        .sentiment-positive { background: #dcfce7; color: #166534; }
        .sentiment-negative { background: #fee2e2; color: #991b1b; }
        .sentiment-neutral { background: #e2e8f0; color: #475569; }

        .conversion-badge {
            background: #10b981;
            color: white;
            padding: 3px 10px;
            border-radius: 20px;
            font-size: 0.8rem;
            font-weight: 600;
        }

        @media (max-width: 768px) {
            .charts-container {
                grid-template-columns: 1fr;
            }
            
            .stat-number {
                font-size: 2rem;
            }
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1><i class="fas fa-chart-line"></i> Call Analytics Dashboard</h1>
            <p>Real-time call tracking and performance analysis</p>
        </div>

        <div class="filters">
            <button class="filter-btn active" onclick="loadData('today')">
                <i class="fas fa-calendar-day"></i> Today
            </button>
            <button class="filter-btn" onclick="loadData('week')">
                <i class="fas fa-calendar-week"></i> This Week
            </button>
            <button class="filter-btn" onclick="loadData('month')">
                <i class="fas fa-calendar-alt"></i> This Month
            </button>
            <button class="filter-btn" onclick="loadData('all')">
                <i class="fas fa-database"></i> All Time
            </button>
        </div>

        <div class="stats-grid" id="statsGrid">
            <!-- Stats will be loaded here -->
        </div>

        <div class="charts-container">
            <div class="chart-box">
                <div class="chart-title"><i class="fas fa-phone"></i> Calls Over Time</div>
                <canvas id="callsChart"></canvas>
            </div>
            
            <div class="chart-box">
                <div class="chart-title"><i class="fas fa-smile"></i> Customer Sentiment</div>
                <canvas id="sentimentChart"></canvas>
            </div>

            <div class="chart-box">
                <div class="chart-title"><i class="fas fa-clock"></i> Average Call Duration</div>
                <canvas id="durationChart"></canvas>
            </div>

            <div class="chart-box">
                <div class="chart-title"><i class="fas fa-bullseye"></i> Conversion Rate</div>
                <canvas id="conversionChart"></canvas>
            </div>
        </div>

        <div class="call-list" id="callList">
            <!-- Recent calls will be loaded here -->
        </div>
    </div>

    <script>
        // Charts
        let callsChart, sentimentChart, durationChart, conversionChart;
        
        // Load initial data
        document.addEventListener('DOMContentLoaded', () => {
            loadData('today');
            setInterval(() => loadData('today'), 30000); // Auto-refresh every 30 seconds
        });

        async function loadData(timeframe) {
            try {
                // Update active button
                document.querySelectorAll('.filter-btn').forEach(btn => btn.classList.remove('active'));
                event.target.classList.add('active');

                const response = await fetch(\`/analytics/data?timeframe=\${timeframe}\`);
                const data = await response.json();

                updateStats(data.stats);
                updateCharts(data.charts);
                updateCallList(data.recentCalls);

            } catch (error) {
                console.error('Error loading analytics:', error);
            }
        }

        function updateStats(stats) {
            const statsGrid = document.getElementById('statsGrid');
            statsGrid.innerHTML = \`
                <div class="stat-card">
                    <div class="stat-number">\${stats.totalCalls}</div>
                    <div>Total Calls</div>
                </div>
                <div class="stat-card">
                    <div class="stat-number">\${stats.averageDuration}s</div>
                    <div>Avg Duration</div>
                </div>
                <div class="stat-card">
                    <div class="stat-number">\${stats.conversionRate}%</div>
                    <div>Conversion Rate</div>
                </div>
                <div class="stat-card">
                    <div class="stat-number">\${stats.uniqueCallers}</div>
                    <div>Unique Callers</div>
                </div>
                <div class="stat-card">
                    <div class="stat-number">\${stats.positiveSentiment}%</div>
                    <div>Positive Calls</div>
                </div>
                <div class="stat-card">
                    <div class="stat-number">\${stats.appointments}</div>
                    <div>Appointments</div>
                </div>
            \`;
        }

        function updateCharts(chartData) {
            // Calls over time chart
            if (callsChart) callsChart.destroy();
            const callsCtx = document.getElementById('callsChart').getContext('2d');
            callsChart = new Chart(callsCtx, {
                type: 'line',
                data: {
                    labels: chartData.callsOverTime.labels,
                    datasets: [{
                        label: 'Calls',
                        data: chartData.callsOverTime.data,
                        borderColor: '#4f46e5',
                        backgroundColor: 'rgba(79, 70, 229, 0.1)',
                        fill: true,
                        tension: 0.4
                    }]
                }
            });

            // Sentiment chart
            if (sentimentChart) sentimentChart.destroy();
            const sentimentCtx = document.getElementById('sentimentChart').getContext('2d');
            sentimentChart = new Chart(sentimentCtx, {
                type: 'doughnut',
                data: {
                    labels: ['Positive', 'Neutral', 'Negative'],
                    datasets: [{
                        data: [chartData.sentiment.positive, chartData.sentiment.neutral, chartData.sentiment.negative],
                        backgroundColor: ['#10b981', '#94a3b8', '#ef4444']
                    }]
                }
            });

            // Duration chart
            if (durationChart) durationChart.destroy();
            const durationCtx = document.getElementById('durationChart').getContext('2d');
            durationChart = new Chart(durationCtx, {
                type: 'bar',
                data: {
                    labels: chartData.duration.labels,
                    datasets: [{
                        label: 'Duration (seconds)',
                        data: chartData.duration.data,
                        backgroundColor: '#8b5cf6'
                    }]
                }
            });

            // Conversion chart
            if (conversionChart) conversionChart.destroy();
            const conversionCtx = document.getElementById('conversionChart').getContext('2d');
            conversionChart = new Chart(conversionCtx, {
                type: 'bar',
                data: {
                    labels: chartData.conversion.labels,
                    datasets: [{
                        label: 'Conversions',
                        data: chartData.conversion.data,
                        backgroundColor: '#10b981'
                    }]
                }
            });
        }

        function updateCallList(calls) {
            const callList = document.getElementById('callList');
            callList.innerHTML = '<h2 style="margin-bottom: 20px;"><i class="fas fa-list"></i> Recent Calls</h2>';
            
            calls.forEach(call => {
                const sentimentClass = \`sentiment-\${call.sentiment || 'neutral'}\`;
                callList.innerHTML += \`
                    <div class="call-item">
                        <div class="call-header">
                            <div>
                                <span class="phone-number">\${call.phone}</span>
                                <span class="sentiment \${sentimentClass}" style="margin-left: 10px;">
                                    \${call.sentiment || 'neutral'}
                                </span>
                                \${call.conversion ? '<span class="conversion-badge" style="margin-left: 10px;">CONVERTED</span>' : ''}
                            </div>
                            <div>\${call.time}</div>
                        </div>
                        <div style="margin-bottom: 10px;">
                            <strong>Path:</strong> \${call.path ? call.path.join(' → ') : 'N/A'}
                        </div>
                        <div style="margin-bottom: 5px;">
                            <strong>Duration:</strong> \${call.duration || 0} seconds
                        </div>
                        <div style="margin-bottom: 5px;">
                            <strong>Options selected:</strong> \${call.optionsSelected ? call.optionsSelected.join(', ') : 'None'}
                        </div>
                        \${call.transcript ? \`
                            <div style="margin-top: 10px; padding: 10px; background: #f8fafc; border-radius: 5px;">
                                <strong>Last message:</strong> "\${call.transcript.length > 100 ? call.transcript.substring(0, 100) + '...' : call.transcript}"
                            </div>
                        \` : ''}
                    </div>
                \`;
            });
        }
    </script>
</body>
</html>
`;

// ======================================================
// НОВЫЕ ЭНДПОИНТЫ ДЛЯ АНАЛИТИКИ
// ======================================================

// Dashboard аналитики (PROTECTED)
app.get('/analytics-dashboard', requireArchiveAuth, (req, res) => {
  res.send(ANALYTICS_HTML);
});

// API для данных аналитики (PROTECTED)
app.get('/analytics/data', requireArchiveAuth, (req, res) => {
  try {
    const timeframe = req.query.timeframe || 'today';
    
    // Загружаем аналитику
    let allAnalytics = [];
    if (fs.existsSync(ANALYTICS_PATH)) {
      const data = fs.readFileSync(ANALYTICS_PATH, "utf8");
      allAnalytics = JSON.parse(data || '[]');
    }
    
    // Фильтруем по времени
    const filteredAnalytics = filterByTimeframe(allAnalytics, timeframe);
    
    // Вычисляем статистику
    const stats = calculateStats(filteredAnalytics);
    const charts = prepareChartData(filteredAnalytics);
    
    // Получаем недавние звонки
    const recentCalls = filteredAnalytics
      .slice(-20)
      .reverse()
      .map(call => ({
        phone: call.phone,
        time: call.endTime ? new Date(call.endTime).toLocaleTimeString() : 'N/A',
        duration: call.totalDuration || 0,
        sentiment: call.sentiment || 'neutral',
        path: call.path || [],
        optionsSelected: call.optionsSelected || [],
        transcript: call.speechTranscripts && call.speechTranscripts.length > 0 
          ? call.speechTranscripts[call.speechTranscripts.length - 1].text 
          : '',
        conversion: call.conversion || false
      }));
    
    res.json({
      success: true,
      timeframe,
      totalRecords: filteredAnalytics.length,
      stats,
      charts,
      recentCalls
    });
    
  } catch (error) {
    console.error("Error loading analytics data:", error);
    res.status(500).json({ error: "Failed to load analytics" });
  }
});

// Вспомогательные функции для аналитики
function filterByTimeframe(data, timeframe) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  
  return data.filter(item => {
    const itemDate = new Date(item.endTime || item.timestamp || item.startTime);
    
    switch(timeframe) {
      case 'today':
        return itemDate >= today;
      case 'week':
        const weekAgo = new Date(today);
        weekAgo.setDate(today.getDate() - 7);
        return itemDate >= weekAgo;
      case 'month':
        const monthAgo = new Date(today);
        monthAgo.setMonth(today.getMonth() - 1);
        return itemDate >= monthAgo;
      default:
        return true; // all time
    }
  });
}

function calculateStats(data) {
  if (data.length === 0) {
    return {
      totalCalls: 0,
      averageDuration: 0,
      conversionRate: 0,
      uniqueCallers: 0,
      positiveSentiment: 0,
      appointments: 0
    };
  }
  
  const totalCalls = data.length;
  const totalDuration = data.reduce((sum, call) => sum + (call.totalDuration || 0), 0);
  const averageDuration = Math.round(totalDuration / totalCalls);
  const conversions = data.filter(call => call.conversion).length;
  const conversionRate = Math.round((conversions / totalCalls) * 100);
  
  const uniquePhones = new Set(data.map(call => call.phone));
  
  const positiveCalls = data.filter(call => call.sentiment === 'positive').length;
  const positiveSentiment = Math.round((positiveCalls / totalCalls) * 100);
  
  // Загружаем appointments для статистики
  let appointments = 0;
  try {
    if (fs.existsSync(DB_PATH)) {
      const appointmentsData = fs.readFileSync(DB_PATH, "utf8");
      appointments = JSON.parse(appointmentsData || '[]').length;
    }
  } catch (e) {
    console.error("Error loading appointments for stats:", e);
  }
  
  return {
    totalCalls,
    averageDuration,
    conversionRate,
    uniqueCallers: uniquePhones.size,
    positiveSentiment,
    appointments
  };
}

function prepareChartData(data) {
  // Группируем по часам для графика звонков
  const callsByHour = {};
  for (let i = 0; i < 24; i++) {
    callsByHour[i] = 0;
  }
  
  data.forEach(call => {
    const hour = new Date(call.startTime || call.timestamp).getHours();
    callsByHour[hour]++;
  });
  
  // Сентимент
  const sentiment = {
    positive: data.filter(c => c.sentiment === 'positive').length,
    neutral: data.filter(c => c.sentiment === 'neutral').length,
    negative: data.filter(c => c.sentiment === 'negative').length
  };
  
  // Длительность звонков (группируем)
  const durationRanges = ['<30s', '30-60s', '1-3m', '3-5m', '5-10m', '>10m'];
  const durationCounts = [0, 0, 0, 0, 0, 0];
  
  data.forEach(call => {
    const duration = call.totalDuration || 0;
    if (duration < 30) durationCounts[0]++;
    else if (duration < 60) durationCounts[1]++;
    else if (duration < 180) durationCounts[2]++;
    else if (duration < 300) durationCounts[3]++;
    else if (duration < 600) durationCounts[4]++;
    else durationCounts[5]++;
  });
  
  // Конверсии по дням (последние 7 дней)
  const conversionByDay = {};
  const last7Days = [];
  for (let i = 6; i >= 0; i--) {
    const date = new Date();
    date.setDate(date.getDate() - i);
    const dateStr = date.toISOString().split('T')[0];
    last7Days.push(dateStr);
    conversionByDay[dateStr] = 0;
  }
  
  data.forEach(call => {
    if (call.conversion) {
      const dateStr = new Date(call.endTime || call.timestamp).toISOString().split('T')[0];
      if (conversionByDay[dateStr] !== undefined) {
        conversionByDay[dateStr]++;
      }
    }
  });
  
  return {
    callsOverTime: {
      labels: Object.keys(callsByHour).map(h => `${h}:00`),
      data: Object.values(callsByHour)
    },
    sentiment,
    duration: {
      labels: durationRanges,
      data: durationCounts
    },
    conversion: {
      labels: last7Days.map(d => d.split('-')[2]), // только день
      data: last7Days.map(d => conversionByDay[d] || 0)
    }
  };
}

// ======================================================
// BEAUTIFUL ARCHIVE VIEWER HTML (ОБНОВЛЕННЫЙ)
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
                INSTANT ARCHIVE - All calls saved immediately!
            </div>
            <div class="badge" style="background: #10b981; margin-left: 10px;">
                <i class="fas fa-chart-line"></i>
                NEW: Analytics Dashboard Available!
            </div>
        </div>

        <!-- Navigation -->
        <div style="background: #f1f5f9; padding: 15px 40px; display: flex; gap: 10px; border-bottom: 1px solid #e2e8f0;">
            <a href="/archive-viewer" style="padding: 10px 20px; background: #4f46e5; color: white; border-radius: 8px; text-decoration: none; font-weight: 600;">
                <i class="fas fa-archive"></i> Archive
            </a>
            <a href="/analytics-dashboard" style="padding: 10px 20px; background: #10b981; color: white; border-radius: 8px; text-decoration: none; font-weight: 600;">
                <i class="fas fa-chart-line"></i> Analytics Dashboard
            </a>
            <a href="/debug" style="padding: 10px 20px; background: #64748b; color: white; border-radius: 8px; text-decoration: none; font-weight: 600;">
                <i class="fas fa-cogs"></i> Debug
            </a>
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
// BEAUTIFUL ARCHIVE VIEWER ENDPOINT (PROTECTED!)
// ======================================================
app.get('/archive-viewer', requireArchiveAuth, (req, res) => {
  res.send(ARCHIVE_VIEWER_HTML);
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
    time: new Date().toLocaleTimeString(),
    deviceType: detectDevice(req)
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
  
  logCall(phone, `MENU_OPTION_${digit}`, {
    option: digit,
    deviceType: detectDevice(req)
  });

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
    // Сохраняем с транскрипцией
    logVoiceMessage(phone, message);
    
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
      preview: message.substring(0, 100),
      sentiment: analyzeSentiment(message),
      urgency: checkUrgency(message)
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
// REPRESENTATIVE (Option 2) - FAST AI
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
      category: 'legal/money',
      sentiment: analyzeSentiment(question),
      urgency: checkUrgency(question)
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
// DAILY ARCHIVES - NEW ENDPOINTS (PROTECTED!)
// ======================================================

// Show all available archive dates (PROTECTED)
app.get('/daily-archives', requireArchiveAuth, (req, res) => {
  try {
    const files = fs.readdirSync(DAILY_LOGS_DIR);
    
    // Group files by date
    const dates = {};
    
    files.forEach(file => {
      if (file.includes('calls-') || file.includes('appointments-') || file.includes('ai-') || file.includes('reminders-') || file.includes('voice_messages-')) {
        const date = file.split('-').slice(1, 4).join('-').replace('.json', '');
        const type = file.split('-')[0];
        
        if (!dates[date]) {
          dates[date] = {
            calls: false,
            appointments: false,
            ai: false,
            reminders: false,
            voice_messages: false
          };
        }
        
        if (type === 'calls') dates[date].calls = true;
        if (type === 'appointments') dates[date].appointments = true;
        if (type === 'ai') dates[date].ai = true;
        if (type === 'reminders') dates[date].reminders = true;
        if (type === 'voice_messages') dates[date].voice_messages = true;
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
          reminders: `/daily-archives/${date}/reminders`,
          voice_messages: `/daily-archives/${date}/voice_messages`
        }
      })),
      lastUpdated: new Date().toISOString(),
      note: "📞 All calls are saved IMMEDIATELY after conversation!"
    });
    
  } catch (error) {
    console.error("ERROR loading daily archives:", error);
    res.status(500).json({ error: "Failed to load daily archives" });
  }
});

// Get logs for specific date (PROTECTED)
app.get('/daily-archives/:date/:type', requireArchiveAuth, (req, res) => {
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
    
    // Analyze data
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

// Download archive for date (PROTECTED)
app.get('/daily-archives/:date/:type/download', requireArchiveAuth, (req, res) => {
  const { date, type } = req.params;
  const filePath = `${DAILY_LOGS_DIR}/${type}-${date}.json`;
  
  if (!fs.existsSync(filePath)) {
    return res.status(404).send("File not found");
  }
  
  res.download(filePath, `${type}-${date}.json`);
});

// ======================================================
// DEBUG ENDPOINTS (updated)
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
  let analyticsData = [];
  
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
    
    if (fs.existsSync(ANALYTICS_PATH)) {
      const analytics = fs.readFileSync(ANALYTICS_PATH, "utf8");
      analyticsData = JSON.parse(analytics || '[]');
    }
  } catch (error) {
    console.error("ERROR loading logs:", error);
  }
  
  // Check archives
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
  
  // Calculate analytics stats
  const totalCalls = analyticsData.length;
  const successfulCalls = analyticsData.filter(a => a.conversion).length;
  const conversionRate = totalCalls > 0 ? Math.round((successfulCalls / totalCalls) * 100) : 0;
  const averageDuration = totalCalls > 0 ? 
    Math.round(analyticsData.reduce((sum, a) => sum + (a.totalDuration || 0), 0) / totalCalls) : 0;
  
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
    analytics: {
      totalCalls,
      successfulCalls,
      conversionRate: `${conversionRate}%`,
      averageDuration: `${averageDuration}s`,
      recentJourneys: analyticsData.slice(-10).map(a => ({
        phone: a.phone,
        duration: a.totalDuration,
        conversion: a.conversion,
        sentiment: a.sentiment,
        path: a.path ? a.path.slice(-5) : []
      }))
    },
    dailyArchives: {
      totalDates: dailyArchives.length,
      dates: dailyArchives.slice(0, 10),
      allDates: `/daily-archives`,
      beautifulViewer: `/archive-viewer`,
      analyticsDashboard: `/analytics-dashboard`,
      security: 'PROTECTED - Requires authentication'
    },
    systemInfo: {
      archiveMode: 'INSTANT (saves immediately after call)',
      analyticsMode: 'REAL-TIME (tracks user journey)',
      storage: {
        calls: `${DAILY_LOGS_DIR}/calls-YYYY-MM-DD.json`,
        appointments: `${DAILY_LOGS_DIR}/appointments-YYYY-MM-DD.json`,
        ai: `${DAILY_LOGS_DIR}/ai-YYYY-MM-DD.json`,
        reminders: `${DAILY_LOGS_DIR}/reminders-YYYY-MM-DD.json`,
        voice_messages: `${DAILY_LOGS_DIR}/voice_messages-YYYY-MM-DD.json`,
        analytics: `${ANALYTICS_DIR}/analytics-YYYY-MM-DD.json`
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
    security: {
      archiveProtection: 'ACTIVE (Basic Auth)',
      defaultUsername: 'altair_admin',
      note: 'Set ARCHIVE_USERNAME and ARCHIVE_PASSWORD in .env to change'
    }
  });
});

app.get('/', (req, res) => {
  const businessStatus = getBusinessStatus();
  
  res.send(`
    <html>
      <head>
        <title>Altair Partners IVR Server</title>
        <style>
          body { font-family: Arial, sans-serif; padding: 20px; max-width: 1000px; margin: 0 auto; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); min-height: 100vh; }
          .main-container { background: white; padding: 30px; border-radius: 20px; box-shadow: 0 20px 60px rgba(0,0,0,0.3); }
          .status { padding: 15px; border-radius: 10px; margin: 15px 0; }
          .open { background: linear-gradient(to right, #10b981, #34d399); color: white; }
          .closed { background: linear-gradient(to right, #ef4444, #f97316); color: white; }
          .endpoints { background: #f8fafc; padding: 20px; border-radius: 10px; margin: 20px 0; }
          ul { line-height: 1.8; list-style: none; padding: 0; }
          li { padding: 8px 0; border-bottom: 1px solid #e2e8f0; }
          a { color: #4f46e5; text-decoration: none; font-weight: 600; display: flex; align-items: center; gap: 10px; }
          a:hover { color: #7c3aed; text-decoration: underline; }
          .analytics-info { background: linear-gradient(to right, #dbeafe, #93c5fd); padding: 15px; border-radius: 10px; margin: 15px 0; border: 2px solid #3b82f6; }
          .instant-badge { background: linear-gradient(to right, #10b981, #34d399); color: white; padding: 5px 10px; border-radius: 20px; font-size: 12px; font-weight: 600; display: inline-flex; align-items: center; gap: 5px; }
          .cta-button { display: inline-block; background: linear-gradient(to right, #4f46e5, #7c3aed); color: white; padding: 12px 24px; border-radius: 10px; text-decoration: none; font-weight: 600; margin: 10px 5px; transition: all 0.3s ease; }
          .cta-button:hover { transform: translateY(-3px); box-shadow: 0 10px 20px rgba(79, 70, 229, 0.3); text-decoration: none; }
          .security-badge { background: linear-gradient(to right, #ef4444, #f97316); color: white; padding: 5px 10px; border-radius: 20px; font-size: 12px; font-weight: 600; display: inline-flex; align-items: center; gap: 5px; margin-left: 10px; }
          .analytics-badge { background: linear-gradient(to right, #8b5cf6, #a78bfa); color: white; padding: 5px 10px; border-radius: 20px; font-size: 12px; font-weight: 600; display: inline-flex; align-items: center; gap: 5px; margin-left: 10px; }
          h1 { color: #1e293b; margin-bottom: 20px; display: flex; align-items: center; gap: 15px; }
        </style>
      </head>
      <body>
        <div class="main-container">
          <h1>
            <span style="font-size: 2rem;">🚀</span>
            Altair Partners IVR Server
          </h1>
          
          <div class="status ${businessStatus.isOpen ? 'open' : 'closed'}">
            <p><strong>Status:</strong> ${businessStatus.isOpen ? '🟢 OPEN' : '🔴 CLOSED'}</p>
            <p><strong>Current Time (PST):</strong> ${businessStatus.currentTime}</p>
            <p><strong>Business Hours:</strong> ${businessStatus.hours}</p>
            <p><strong>Location:</strong> ${businessStatus.location}</p>
            <p>${businessStatus.isOpen ? '✅ Currently open' : '⏰ ' + businessStatus.nextOpenTime}</p>
          </div>
          
          <div class="analytics-info">
            <h3 style="color: #1e40af; margin-top: 0;">📈 NEW! Advanced Analytics Dashboard <span class="analytics-badge">📊 ANALYTICS</span></h3>
            <p><strong>Real-time call tracking and user journey analysis!</strong></p>
            <p>• 📊 Charts and statistics in real-time</p>
            <p>• 🎯 Conversion rate tracking</p>
            <p>• 😊 Customer sentiment analysis</p>
            <p>• ⏱️ Call duration analytics</p>
            <p>• 🗺️ User journey visualization</p>
            <p style="margin-top: 10px;">
              <a href="/analytics-dashboard" class="cta-button">
                📈 Open Analytics Dashboard
              </a>
              <a href="/archive-viewer" class="cta-button" style="background: linear-gradient(to right, #10b981, #34d399);">
                🗂️ Open Archive Viewer
              </a>
            </p>
          </div>
          
          <div class="endpoints">
            <h3 style="color: #1e293b;">📊 Analytics Endpoints:</h3>
            <ul>
              <li><a href="/analytics-dashboard"><span style="font-size: 1.2rem;">📈</span> /analytics-dashboard</a> - Advanced analytics with charts! <span class="security-badge">🔒</span></li>
              <li><a href="/archive-viewer"><span style="font-size: 1.2rem;">🗂️</span> /archive-viewer</a> - Beautiful archive with buttons! <span class="security-badge">🔒</span></li>
              <li><a href="/daily-archives"><span style="font-size: 1.2rem;">📊</span> /daily-archives</a> - All archives by days (JSON) <span class="security-badge">🔒</span></li>
            </ul>
            
            <h3 style="color: #1e293b; margin-top: 25px;">🔧 System Endpoints:</h3>
            <ul>
              <li><a href="/debug"><span style="font-size: 1.2rem;">🔧</span> /debug</a> - Debug info</li>
              <li><a href="/health"><span style="font-size: 1.2rem;">❤️</span> /health</a> - Health check</li>
              <li><a href="/business-status"><span style="font-size: 1.2rem;">🏢</span> /business-status</a> - Business hours check</li>
            </ul>
            
            <h3 style="color: #1e293b; margin-top: 25px;">📋 Data Endpoints:</h3>
            <ul>
              <li><a href="/logs"><span style="font-size: 1.2rem;">📞</span> /logs</a> - Current call logs</li>
              <li><a href="/appointments"><span style="font-size: 1.2rem;">📅</span> /appointments</a> - All appointments</li>
              <li><a href="/conversations"><span style="font-size: 1.2rem;">🤖</span> /conversations</a> - AI conversations</li>
              <li><a href="/reminders"><span style="font-size: 1.2rem;">⏰</span> /reminders</a> - Reminder logs</li>
            </ul>
          </div>
          
          <div style="margin-top: 30px; padding-top: 20px; border-top: 2px solid #e2e8f0;">
            <p><strong>Twilio Webhook:</strong> POST /voice</p>
            <p><strong>📈 Analytics System:</strong> Tracks user journey, sentiment, conversions</p>
            <p><strong>⏰ Reminder System:</strong> Calls ONE DAY BEFORE appointment at 2 PM Pacific Time</p>
            <p><strong>🔄 Check interval:</strong> Every 5 minutes</p>
            <p><strong>🔔 Test reminder:</strong> POST /test-reminder?phone=+15034448881</p>
            <p><strong>📦 Archiving:</strong> <span class="instant-badge">INSTANT MODE</span> (immediately after call)</p>
            <p><strong>📊 Analytics:</strong> <span class="instant-badge">REAL-TIME</span> (user journey tracking)</p>
            <p><strong>🔒 Archive Security:</strong> Password protected (username: altair_admin)</p>
            <p><strong>💾 Self-ping:</strong> ${process.env.FREE_PLAN === 'true' ? 'Active (every 4 minutes)' : 'Inactive'}</p>
            <p><strong>📞 Test call:</strong> +1 (503) 444-8881</p>
            <p><strong>🔑 Default password:</strong> altair_admin / AltairSecure2024!@#$</p>
          </div>
        </div>
      </body>
    </html>
  `);
});

// Public endpoints (no protection needed)
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
      note: "These are current logs. Daily archives available at /daily-archives (password protected)"
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
    note: "These are current appointments. Daily archives available at /daily-archives (password protected)"
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
      note: "These are current AI conversations. Daily archives available at /daily-archives (password protected)"
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
      note: "These are current reminders. Daily archives available at /daily-archives (password protected)"
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
  
  // Get real server URL
  const serverUrl = process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`;
  
  console.log(`🚀 Altair Partners IVR Server running on port ${PORT}`);
  console.log(`⏰ Business Status: ${businessStatus.isOpen ? 'OPEN' : 'CLOSED'}`);
  console.log(`🕐 Current Time (PST): ${businessStatus.currentTime}`);
  console.log(`📅 Next Open: ${businessStatus.nextOpenTime}`);
  console.log(`🌐 Server URL: ${serverUrl}`);
  console.log(`\n📊 ADVANCED ANALYTICS DASHBOARD:`);
  console.log(`✅ ${serverUrl}/analytics-dashboard - REAL-TIME CHARTS & STATISTICS!`);
  console.log(`📈 Features: Conversion tracking, sentiment analysis, user journey`);
  console.log(`\n🗂️ BEAUTIFUL ARCHIVE VIEWER:`);
  console.log(`✅ ${serverUrl}/archive-viewer - BEAUTIFUL INTERFACE WITH BUTTONS!`);
  console.log(`🔒 PROTECTED with password: altair_admin / AltairSecure2024!@#$`);
  console.log(`\n📊 Main endpoints:`);
  console.log(`✅ Health check: ${serverUrl}/health`);
  console.log(`✅ Debug: ${serverUrl}/debug`);
  console.log(`✅ Daily archives (JSON): ${serverUrl}/daily-archives (PROTECTED)`);
  console.log(`\n📋 Data endpoints:`);
  console.log(`✅ Current logs: ${serverUrl}/logs`);
  console.log(`✅ Appointments: ${serverUrl}/appointments`);
  console.log(`✅ Conversations: ${serverUrl}/conversations`);
  console.log(`✅ Reminders: ${serverUrl}/reminders`);
  console.log(`✅ Business Status: ${serverUrl}/business-status`);
  console.log(`\n🛠️ System info:`);
  console.log(`✅ Next available date: ${getNextAvailableDate()}`);
  console.log(`🤖 AI Representative is ready (fast mode)`);
  console.log(`📝 INSTANT ARCHIVE SYSTEM: All data saved immediately after call!`);
  console.log(`📊 ADVANCED ANALYTICS: Real-time user journey tracking!`);
  console.log(`📁 Archives location: ./logs/daily/`);
  console.log(`📈 Analytics location: ./logs/analytics/`);
  console.log(`⏰ Reminder system: Calls ONE DAY BEFORE appointment at 2 PM Pacific Time`);
  console.log(`🔄 Check interval: Every 5 minutes`);
  console.log(`🔔 Test endpoint: POST ${serverUrl}/test-reminder?phone=+1234567890`);
  console.log(`🚪 After-hours options: Callback request (1) or Voice message (2)`);
  console.log(`💾 Self-ping: ${process.env.FREE_PLAN === 'true' ? 'Active (every 4 minutes)' : 'Inactive'}`);
  console.log(`\n🔒 SECURITY INFORMATION:`);
  console.log(`✅ Archive protection: ACTIVE (Basic Auth)`);
  console.log(`✅ Default username: altair_admin`);
  console.log(`✅ Default password: AltairSecure2024!@#$`);
  console.log(`⚠️ IMPORTANT: Change password in .env file with:`);
  console.log(`   ARCHIVE_USERNAME=yourusername`);
  console.log(`   ARCHIVE_PASSWORD=yourstrongpassword`);
  console.log(`\n🔥 NEW FEATURES:`);
  console.log(`✅ Advanced Analytics Dashboard with real-time charts`);
  console.log(`✅ User journey tracking and sentiment analysis`);
  console.log(`✅ Conversion rate tracking and call duration analytics`);
  console.log(`✅ Voice message transcription and analysis`);
  console.log(`✅ Beautiful responsive design for all devices`);
  
  // Start reminder scheduler
  startReminderScheduler();
  
  console.log(`\n✅ INSTANT ARCHIVE SYSTEM READY - All calls will be saved immediately!`);
  console.log(`✅ ADVANCED ANALYTICS READY - Real-time tracking and analysis!`);
  console.log(`✅ BEAUTIFUL DASHBOARDS READY - Open in browser and enjoy!`);
  console.log(`✅ SECURITY PROTECTION ACTIVE - Archives are password protected!`);
});