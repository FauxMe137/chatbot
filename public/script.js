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

    const textElement = document.createElement("p");
    textElement.textContent = text;

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

function startNewChat() {
    // 1. Reset state
    currentConversationId = null;
    selectedFiles = [];
    filePreview.innerHTML = "";
    messageInput.value = "";
    resetInputHeight();

    // 2. Clear messages container and restore default greeting
    chatMessages.innerHTML = `
        <div class="message bot-message">
            <img src="/assets/chatbot-icon.png" alt="bot image" class="chat-image">
            <p>Hello! How can I help you?</p>
        </div>
    `;
}

newChatBtn.addEventListener("click", startNewChat);