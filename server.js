const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const fs = require('fs').promises;
const session = require('express-session');
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcryptjs');
const axios = require('axios');

const app = express();
const PORT = 3000;

// WhatsApp Number for notifications
const WHATSAPP_NUMBER = '201029492347';
// This is a placeholder for a WhatsApp API. You'll need to use a service like Twilio or Vonage for a real app.
const WHATSAPP_API_URL = 'https://api.whatsapp.com/send?phone=';

// Middleware
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, '../frontend')));
app.use(session({
    secret: uuidv4(),
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 3600000, secure: false } // secure: true for production
}));

// Utility functions to read/write JSON files
async function readJsonFile(fileName) {
    try {
        const data = await fs.readFile(path.join(__dirname, fileName), 'utf8');
        return JSON.parse(data);
    } catch (error) {
        if (error.code === 'ENOENT') {
            console.error(`File not found: ${fileName}. Creating a new one.`);
            return {};
        }
        console.error(`Error reading ${fileName}:`, error);
        return {};
    }
}

async function writeJsonFile(fileName, data) {
    await fs.writeFile(path.join(__dirname, fileName), JSON.stringify(data, null, 2));
}

// WhatsApp Notification Function
async function sendWhatsAppNotification(message) {
    const fullMessage = encodeURIComponent(message);
    const url = `${WHATSAPP_API_URL}${WHATSAPP_NUMBER}&text=${fullMessage}`;
    
    // For local testing, we'll just log the message to the console.
    // In a real application, you would use an external API like Twilio.
    console.log(`Sending WhatsApp notification: ${url}`);
    // return axios.get(url); // Uncomment this in production with a real API
    return true;
}

// --- Frontend Routes (Serving Pages) ---
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../frontend', 'index.html'));
});

app.get('/register.html', (req, res) => {
    res.sendFile(path.join(__dirname, '../frontend', 'register.html'));
});

app.get('/services.html', (req, res) => {
    if (!req.session.isAuthenticated) {
        return res.redirect('/');
    }
    res.sendFile(path.join(__dirname, '../frontend', 'services.html'));
});

app.get('/admin-panel.html', (req, res) => {
    if (!req.session.isAuthenticated || req.session.role !== 'admin') {
        return res.redirect('/');
    }
    res.sendFile(path.join(__dirname, '../frontend', 'admin-panel.html'));
});

// --- API Routes ---

// User Registration
app.post('/api/register', async (req, res) => {
    const { username, email, password } = req.body;
    const usersData = await readJsonFile('users.json');
    const users = usersData.users || [];

    if (users.find(u => u.username === username)) {
        return res.status(409).json({ success: false, message: 'اسم المستخدم موجود بالفعل.' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = { username, email, password: hashedPassword, role: 'user' };
    users.push(newUser);
    await writeJsonFile('users.json', { users });
    res.json({ success: true, message: 'تم التسجيل بنجاح.' });
});

// User Login
app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    const usersData = await readJsonFile('users.json');
    const users = usersData.users || [];
    const user = users.find(u => u.username === username);

    if (!user) {
        return res.status(401).json({ success: false, message: 'اسم المستخدم أو كلمة المرور غير صحيحة.' });
    }

    const passwordMatch = await bcrypt.compare(password, user.password);
    if (passwordMatch) {
        req.session.isAuthenticated = true;
        req.session.username = user.username;
        req.session.role = user.role;
        res.json({ success: true, isAdmin: user.role === 'admin' });
    } else {
        res.status(401).json({ success: false, message: 'اسم المستخدم أو كلمة المرور غير صحيحة.' });
    }
});

// Get Services List
app.get('/api/services', async (req, res) => {
    const data = await readJsonFile('data.json');
    res.json(data.services || []);
});

// Submit New Request
app.post('/api/request', async (req, res) => {
    if (!req.session.isAuthenticated) {
        return res.status(401).json({ success: false, message: 'Authentication required.' });
    }

    const { service, link, quantity, notes } = req.body;
    if (!service || !link || !quantity) {
        return res.status(400).json({ success: false, message: 'بيانات الطلب غير مكتملة.' });
    }

    const data = await readJsonFile('data.json');
    const requests = data.requests || [];
    const newRequest = {
        id: requests.length + 1,
        username: req.session.username,
        service,
        link,
        quantity,
        notes,
        date: new Date().toLocaleString()
    };
    requests.push(newRequest);
    await writeJsonFile('data.json', { ...data, requests });

    const message = `طلب جديد:
- العميل: ${req.session.username}
- الخدمة: ${service}
- الرابط: ${link}
- الكمية: ${quantity}
- ملاحظات: ${notes || 'لا يوجد'}`;
    await sendWhatsAppNotification(message);

    res.json({ success: true, message: 'تم إرسال الطلب بنجاح.' });
});

// Get Alerts
app.get('/api/alerts', async (req, res) => {
    const data = await readJsonFile('data.json');
    res.json(data.alerts || []);
});

// Admin API Routes (Require Authentication)
app.get('/api/admin/requests', async (req, res) => {
    if (req.session.role !== 'admin') return res.status(403).json({ success: false, message: 'Forbidden' });
    const data = await readJsonFile('data.json');
    res.json(data.requests || []);
});

app.post('/api/admin/services/add', async (req, res) => {
    if (req.session.role !== 'admin') return res.status(403).json({ success: false, message: 'Forbidden' });
    const { name, icon, description } = req.body;
    const data = await readJsonFile('data.json');
    const services = data.services || [];
    services.push({ name, icon, description });
    await writeJsonFile('data.json', { ...data, services });
    res.json({ success: true });
});

app.post('/api/admin/services/delete', async (req, res) => {
    if (req.session.role !== 'admin') return res.status(403).json({ success: false, message: 'Forbidden' });
    const { name } = req.body;
    const data = await readJsonFile('data.json');
    const services = data.services || [];
    const filteredServices = services.filter(service => service.name !== name);
    await writeJsonFile('data.json', { ...data, services: filteredServices });
    res.json({ success: true });
});

app.post('/api/admin/alert', async (req, res) => {
    if (req.session.role !== 'admin') return res.status(403).json({ success: false, message: 'Forbidden' });
    const { message } = req.body;
    const data = await readJsonFile('data.json');
    const alerts = [{ message, date: new Date().toLocaleString() }];
    await writeJsonFile('data.json', { ...data, alerts });
    res.json({ success: true });
});

// Start Server
app.listen(PORT, () => {
    console.log(`Server is running at http://localhost:${PORT}`);
});
