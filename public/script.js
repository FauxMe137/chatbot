document.addEventListener("DOMContentLoaded", async () => {
    const savedConversationId = localStorage.getItem("currentConversationId");
    
    if (savedConversationId) {
        currentConversationId = Number(savedConversationId);
        
        try {
            const response = await fetch(`/api/history/${currentConversationId}`);
            if (response.ok) {
                const history = await response.json();
                
                if (history.length > 0) {
                    // Clear out any default greeting
                    chatMessages.innerHTML = "";
                    
                    // Render all past messages into the chat window
                    history.forEach(msg => {
                        displayMessage(msg.content, msg.role);
                    });
                }
            }
        } catch (err) {
            console.error("Could not restore chat history:", err);
            localStorage.removeItem("currentConversationId");
        }
    }
});

// ==========================================
// DOM ELEMENTS
// ==========================================

const chatForm = document.querySelector("#chat-form");
const messageInput = document.querySelector("#message-input");
const chatMessages = document.querySelector("#chat-messages");
const sendBtn = document.querySelector("#send-btn");
const attachBtn = document.querySelector("#attach-btn");
const fileInput = document.querySelector("#file-input");
const filePreview = document.querySelector("#file-preview");
const newChatBtn = document.querySelector("#new-chat-btn");


// Configure Marked to highlight code blocks automatically
marked.setOptions({
    highlight: function(code, lang) {
        if (lang && hljs.getLanguage(lang)) {
            return hljs.highlight(code, { language: lang }).value;
        }
        return hljs.highlightAuto(code).value;
    },
    breaks: true // Enables line breaks on single newlines
});

// ==========================================
// CHAT STATE
// ==========================================

let currentConversationId = null;
let selectedFiles = [];
let isSending = false;


// ==========================================
// SCROLL UTILITIES
// ==========================================

function scrollToBottom() {
    chatMessages.scrollTop = chatMessages.scrollHeight;
}


// ==========================================
// MESSAGE FUNCTIONS
// ==========================================

function displayMessage(text, sender, attachments = []) {
    const messageContainer = document.createElement("div");
    messageContainer.classList.add("message", `${sender}-message`);

    // Avatar setup based on sender
    const avatar = document.createElement("img");
    avatar.classList.add("chat-image");
    avatar.src = sender === "user" 
        ? "/assets/user-no-profile.png" 
        : "/assets/chatbot-icon.png";
    avatar.alt = `${sender} image`;

    // Dynamically choose "div" for the bot, and "p" for the user
    const textElement = document.createElement(sender === "bot" ? "div" : "p");

    if (sender === "bot") {
        textElement.innerHTML = marked.parse(text); // Renders Markdown safely inside a div
    } else {
        textElement.textContent = text; // Renders plain text inside a standard paragraph
    }

    messageContainer.appendChild(avatar);
    messageContainer.appendChild(textElement);

    // If bot message, add a copy button
    if (sender === "bot") {
        const copyBtn = document.createElement("button");
        copyBtn.type = "button";
        copyBtn.className = "copy-btn";
        copyBtn.title = "Copy response";
        copyBtn.innerHTML = `<span class="material-symbols-outlined" style="font-size: 16px;">content_copy</span>`;
        
        copyBtn.addEventListener("click", () => {
            copyTextToClipboard(text, copyBtn.querySelector(".material-symbols-outlined"));
        });
        
        messageContainer.appendChild(copyBtn);
    }

    //Display names of uploaded files under the user message
    if (attachments.length > 0) {
        const fileList = document.createElement("small");
        fileList.style.display = "block";
        fileList.style.opacity = "0.75";
        fileList.textContent = `Attached: ${attachments.map(f => f.name).join(", ")}`;
        textElement.appendChild(fileList);
    }

    chatMessages.appendChild(messageContainer);
    scrollToBottom();
}

// ==========================================
// LOADING STATE
// ==========================================

let typingIndicatorElement = null;

function showLoadingIndicator() {
    // Disable inputs
    isSending = true;
    sendBtn.disabled = true;
    attachBtn.disabled = true;
    messageInput.disabled = true;

    // Create a temporary bot message bubble
    typingIndicatorElement = document.createElement("div");
    typingIndicatorElement.classList.add("message", "bot-message");

    const avatar = document.createElement("img");
    avatar.classList.add("chat-image");
    avatar.src = "/assets/chatbot-icon.png";
    avatar.alt = "bot image";

    const dotsContainer = document.createElement("div");
    dotsContainer.classList.add("typing-indicator");
    dotsContainer.innerHTML = `
        <span class="typing-dot"></span>
        <span class="typing-dot"></span>
        <span class="typing-dot"></span>
    `;

    typingIndicatorElement.appendChild(avatar);
    typingIndicatorElement.appendChild(dotsContainer);

    chatMessages.appendChild(typingIndicatorElement);
    scrollToBottom();
}

function hideLoadingIndicator() {
    // Remove the animated bubble if present
    if (typingIndicatorElement) {
        typingIndicatorElement.remove();
        typingIndicatorElement = null;
    }

    // Re-enable inputs
    isSending = false;
    if (sendBtn) sendBtn.disabled = false;
    if (attachBtn) attachBtn.disabled = false;
    if (messageInput) {
        messageInput.disabled = false;
        // Optional chaining avoids crashing if the input is temporarily blurred
        messageInput.focus?.();
    }
}

// ==========================================
// CHAT FUNCTION
// ==========================================

async function sendMessage(messageText, files = []) {
    
    /* Stop sending process if a message is also sending */
    if (isSending) return;

    showLoadingIndicator();

    isSending = true;
    sendBtn.disabled = true;

    // Use FormData for text + file payloads
    const formData = new FormData();
    formData.append("message", messageText);
    if (currentConversationId) {
        formData.append("conversationId", currentConversationId);
    }

    files.forEach((file) => {
        formData.append("attachments", file);
    });

    try {
        // NOTE: express.json() does not parse FormData. 
        // Ensure you use multer or a similar multipart parser on this endpoint in server.js.
        const response = await fetch("/api/chat", {
            method: "POST",
            body: formData // Browser sets Content-Type to multipart/form-data automatically
        });

        if (!response.ok) {
            throw new Error(`Server responded with ${response.status}`);
        }

        const data = await response.json();
        
        // Check if backend returned valid content
        if (!data || !data.reply) {
            throw new Error("Empty or malformed response from server");
        }

        if (data.conversationId) {
            currentConversationId = data.conversationId;
            localStorage.setItem("currentConversationId", currentConversationId);
        }

        // Clean up the indicator before printing the real reply
        hideLoadingIndicator();
        displayMessage(data.reply, "bot");

    } catch (error) {
        console.error("Failed to send message:", error);
        
        // Ensure UI is restored before showing error
        hideLoadingIndicator();
        displayMessage("Something went wrong. Please try again.", "bot");
    } finally {
        // Absolute safety net: guarantees input controls unlock even if an error is thrown
        hideLoadingIndicator();
    }
}

// ==========================================
// FILE ATTACHMENTS
// ==========================================

const ALLOWED_MIME_TYPES = [
    "image/png",
    "image/jpeg",
    "application/pdf"
];

// Open native file dialog on button click
attachBtn.addEventListener("click", () => {
    fileInput.click();
});

// Handle file selection
fileInput.addEventListener("change", (e) => {
    const files = Array.from(e.target.files);
    
    files.forEach((file) => {
        // Validate MIME type
        if (!ALLOWED_MIME_TYPES.includes(file.type)) {
            alert(`File "${file.name}" is not supported. Please select PNG, JPG, or PDF files.`);
            return;
        }

        // Prevent duplicate file selection
        const isDuplicate = selectedFiles.some(
            (f) => f.name === file.name && f.size === file.size
        );
        if (isDuplicate) return;

        selectedFiles.push(file);
    });

    // Reset native input so selecting the same file again triggers change event
    fileInput.value = "";

    renderFilePreviews();
});

// Render tags/thumbnails in #file-preview
function renderFilePreviews() {
    filePreview.innerHTML = "";

    selectedFiles.forEach((file, index) => {
        const chip = document.createElement("div");
        chip.classList.add("file-preview-chip");

        // Display image thumbnail if it's PNG/JPG
        if (file.type.startsWith("image/")) {
            const thumbnail = document.createElement("img");
            thumbnail.src = URL.createObjectURL(file);
            thumbnail.alt = file.name;
            // Clean up object URL when thumbnail unloads
            thumbnail.onload = () => URL.revokeObjectURL(thumbnail.src);
            chip.appendChild(thumbnail);
        } else {
            // PDF document icon
            const docIcon = document.createElement("span");
            docIcon.classList.add("material-symbols-outlined");
            docIcon.style.fontSize = "18px";
            docIcon.textContent = "description";
            chip.appendChild(docIcon);
        }

        const nameSpan = document.createElement("span");
        nameSpan.classList.add("file-name");
        nameSpan.textContent = file.name;
        nameSpan.title = file.name;

        const removeBtn = document.createElement("button");
        removeBtn.type = "button";
        removeBtn.classList.add("remove-file-btn");
        removeBtn.setAttribute("aria-label", `Remove ${file.name}`);
        removeBtn.innerHTML = "&times;";
        
        // Remove individual file on click
        removeBtn.addEventListener("click", () => {
            removeFile(index);
        });

        chip.appendChild(nameSpan);
        chip.appendChild(removeBtn);
        filePreview.appendChild(chip);
    });
}

function removeFile(index) {
    selectedFiles.splice(index, 1);
    renderFilePreviews();
}


// ==========================================
// FORM SUBMISSION & INPUT BEHAVIOUR
// ==========================================

chatForm.addEventListener("submit", async (e) => {
    e.preventDefault();

    const text = messageInput.value.trim();

    // Prevent dispatch if there's no message and no file attached
    if (!text && selectedFiles.length === 0) return;

    // Snapshot files and reset queue
    const filesToSend = [...selectedFiles];
    selectedFiles = [];
    filePreview.innerHTML = "";

    // Display user bubble and reset textarea
    displayMessage(text, "user", filesToSend);
    messageInput.value = "";

    await sendMessage(text, filesToSend);
});

// Shift + Enter for new lines, Enter to submit
messageInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        chatForm.dispatchEvent(new Event("submit"));
    }
});

// ==========================================
// RESPONSE UTILITIES
// ==========================================

async function copyTextToClipboard(text, buttonElement) {
    try {
        await navigator.clipboard.writeText(text);
        
        // Brief visual feedback
        const originalText = buttonElement.textContent;
        buttonElement.textContent = "check";
        setTimeout(() => {
            buttonElement.textContent = originalText;
        }, 1500);
    } catch (err) {
        console.error("Failed to copy message:", err);
    }
}

// ==========================================
// START NEW CONVERSATIONS / CHATS
// ==========================================

if (newChatBtn) {
    newChatBtn.addEventListener("click", () => {
        // 1. Reset the active conversation session
        currentConversationId = null;
        
        // 2. Clear localStorage (prepping for the next checklist item)
        localStorage.removeItem("currentConversationId");

        // 3. Clear the chat window UI
        chatMessagesContainer.innerHTML = "";

        // 4. Reset input or attachments if needed
        messageInput.value = "";
        
        // 5. Re-display the default welcome bot greeting
        displayMessage("Hello! How can I help you today?", "bot");
    });
}

// Sidebar Toggle Logic (Adapted from template)
function showSidebar(){
    const sidebar = document.querySelector(".sidebar");
    sidebar.style.display = "flex";
    loadSidebarConversations(7); // Load top 7 by default when opened
}

function hideSidebar(){
    const sidebar = document.querySelector(".sidebar");
    sidebar.style.display = "none";
}

// Fetch and Render Conversations in Sidebar
async function loadSidebarConversations(limit = 7) {
    const container = document.getElementById("sidebar-conversations-container");
    try {
        const response = await fetch(`/api/conversations?limit=${limit}`);
        if (!response.ok) throw new Error("Failed to fetch conversations");
        
        const conversations = await response.json();
        container.innerHTML = "";

        if (conversations.length === 0) {
            container.innerHTML = `<p style="color: gray; padding: 15px; font-size: 0.85rem;">No past chats yet.</p>`;
            return;
        }

        conversations.forEach(conv => {
            const btn = document.createElement("button");
            btn.className = "conversation-item";
            if (conv.id === currentConversationId) {
                btn.classList.add("active");
            }
            // Display conversation ID or snippet title
            btn.textContent = `Chat Session #${conv.id}`;
            
            // Switch session on click
            btn.addEventListener("click", () => {
                switchConversation(conv.id);
                hideSidebar();
            });

            container.appendChild(btn);
        });
    } catch (err) {
        console.error("Sidebar load error:", err);
    }
}

// "View All History" button handler
document.getElementById("load-more-chats-btn").addEventListener("click", () => {
    loadSidebarConversations(100); // Load up to a higher cap (full-ish history)
});

// Switch active session and restore its history onto the UI
async function switchConversation(convId) {
    currentConversationId = convId;
    localStorage.setItem("currentConversationId", currentConversationId);

    try {
        const response = await fetch(`/api/history/${convId}`);
        if (response.ok) {
            const history = await response.json();
            chatMessagesContainer.innerHTML = ""; // Clear current view
            
            if (history.length > 0) {
                history.forEach(msg => {
                    displayMessage(msg.content, msg.role);
                });
            }
        }
    } catch (err) {
        console.error("Error switching conversation:", err);
    }
}