const express = require("express");
const path = require("path");
const fs = require("fs");
const dotenv = require("dotenv");
const multer = require("multer");
const Database = require("better-sqlite3");

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5500;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// ==========================================
// DIRECTORY INITIALIZATION
// ==========================================

const uploadsDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
}

const databaseDir = path.join(__dirname, "database");
if (!fs.existsSync(databaseDir)) {
    fs.mkdirSync(databaseDir, { recursive: true });
}

// ==========================================
// DATABASE (better-sqlite3 pointing to chatbot.db)
// ==========================================

const db = new Database(path.join(databaseDir, "chatbot.db"));
db.pragma("journal_mode = WAL");

// Ensures the tables exist in chatbot.db without overwriting pre-existing data
db.exec(`
    CREATE TABLE IF NOT EXISTS conversations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        conversation_id INTEGER NOT NULL,
        sender TEXT CHECK(sender IN ('user', 'bot')),
        text TEXT,
        attachments TEXT, -- JSON array of file paths/names
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
    );
`);

// Prepared statements for faster execution
const queries = {
    createConversation: db.prepare("INSERT INTO conversations DEFAULT VALUES"),
    insertMessage: db.prepare(`
        INSERT INTO messages (conversation_id, sender, text, attachments)
        VALUES (?, ?, ?, ?)
    `),
    getConversationMessages: db.prepare(`
        SELECT sender, text, attachments, created_at 
        FROM messages 
        WHERE conversation_id = ? 
        ORDER BY id ASC
    `)
};

// ==========================================
// MULTER (FILE UPLOAD CONFIG)
// ==========================================

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadsDir),
    filename: (req, file, cb) => {
        const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
        cb(null, `${uniqueSuffix}-${file.originalname}`);
    }
});

const upload = multer({
    storage,
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit per file
    fileFilter: (req, file, cb) => {
        const allowedTypes = ["image/png", "image/jpeg", "application/pdf"];
        if (allowedTypes.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error(`Unsupported file type: ${file.mimetype}`));
        }
    }
});

// ==========================================
// GEMINI REST API (NATIVE HTTPS FETCH)
// ==========================================

async function callGeminiREST(promptText, files = []) {
    if (!GEMINI_API_KEY) {
        throw new Error("GEMINI_API_KEY is missing from environment variables.");
    }

    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent?key=${GEMINI_API_KEY}`;
    const parts = [];

    // 1. Process files into inline base64 data
    for (const file of files) {
        const buffer = fs.readFileSync(file.path);
        parts.push({
            inline_data: {
                mime_type: file.mimetype,
                data: buffer.toString("base64")
            }
        });
    }

    // 2. Append prompt text
    if (promptText && promptText.trim().length > 0) {
        parts.push({ text: promptText });
    }

    const payload = {
        contents: [
            {
                role: "user",
                parts: parts
            }
        ]
    };

    const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Gemini API error [${response.status}]: ${errorText}`);
    }

    const data = await response.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text || "No response text received.";
}

// ==========================================
// MIDDLEWARE & STATIC ASSETS
// ==========================================

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve frontend files
app.use(express.static(path.join(__dirname, "public")));
app.use("/assets", express.static(path.join(__dirname, "assets")));
// Serve uploaded attachments
app.use("/uploads", express.static(uploadsDir));

// ==========================================
// API ROUTES
// ==========================================

// Chat endpoint (receives FormData)
app.post("/api/chat", upload.array("attachments"), async (req, res) => {
    try {
        const messageText = req.body.message || "";
        let conversationId = req.body.conversationId ? Number(req.body.conversationId) : null;
        const uploadedFiles = req.files || [];

        if (!messageText && uploadedFiles.length === 0) {
            return res.status(400).json({ error: "Message text or an attachment is required." });
        }

        // 1. Start a conversation session if one does not exist
        if (!conversationId) {
            const result = queries.createConversation.run();
            conversationId = result.lastInsertRowid;
        }

        // 2. Persist the user message and attached files
        const attachmentFilenames = uploadedFiles.map((file) => file.filename);
        queries.insertMessage.run(
            conversationId,
            "user",
            messageText,
            JSON.stringify(attachmentFilenames)
        );

        // 3. Query Gemini REST
        const replyText = await callGeminiREST(messageText, uploadedFiles);

        // 4. Persist the bot reply
        queries.insertMessage.run(
            conversationId,
            "bot",
            replyText,
            JSON.stringify([])
        );

        // 5. Send JSON response
        return res.json({
            reply: replyText,
            conversationId
        });

    } catch (error) {
        console.error("Route error (/api/chat):", error);
        return res.status(500).json({ error: error.message || "Failed to process chat message." });
    }
});

// Fetch past conversation messages
app.get("/api/conversations/:id/messages", (req, res) => {
    try {
        const messages = queries.getConversationMessages.all(req.params.id);
        const parsed = messages.map((msg) => ({
            ...msg,
            attachments: JSON.parse(msg.attachments || "[]")
        }));
        return res.json(parsed);
    } catch (error) {
        console.error("Route error (/api/conversations/:id/messages):", error);
        return res.status(500).json({ error: "Failed to load past messages." });
    }
});

// ==========================================
// START SERVER
// ==========================================

app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server listening on http://localhost:${PORT}`);
});