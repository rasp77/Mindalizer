/**
 * Magomar Chat - JavaScript
 * Handles chat functionality and n8n webhook integration
 */

// Configuration
const CONFIG = {
    webhookUrl: 'https://mindalizerai.app.n8n.cloud/webhook/70a5ae1c-2db4-4893-baf1-2abb076d42b0',
    maxRetries: 3,
    retryDelay: 1000,
    messageMaxLength: 2000
};

// State
let sessionId = null;
let isLoading = false;
let messageHistory = [];

// DOM Elements
const chatMessages = document.getElementById('chatMessages');
const chatForm = document.getElementById('chatForm');
const messageInput = document.getElementById('messageInput');
const sendButton = document.getElementById('sendButton');
const typingIndicator = document.getElementById('typingIndicator');
const errorToast = document.getElementById('errorToast');

// Initialize
document.addEventListener('DOMContentLoaded', init);

function init() {
    // Generate or restore session ID
    sessionId = getOrCreateSessionId();

    // Restore message history from sessionStorage
    restoreMessageHistory();

    // Set up event listeners
    chatForm.addEventListener('submit', handleSubmit);
    messageInput.addEventListener('input', handleInput);
    messageInput.addEventListener('keydown', handleKeydown);

    // Mobile keyboard handling
    setupMobileKeyboardHandling();

    // Focus input (delayed for mobile)
    setTimeout(() => messageInput.focus(), 100);

    // Log initialization
    console.log('Magomar Chat initialized with session:', sessionId);
}

/**
 * Handle mobile keyboard appearance
 */
function setupMobileKeyboardHandling() {
    // Handle visual viewport resize (keyboard open/close)
    if (window.visualViewport) {
        window.visualViewport.addEventListener('resize', handleViewportResize);
    }

    // Handle input focus - scroll to bottom when keyboard opens
    messageInput.addEventListener('focus', () => {
        setTimeout(() => {
            scrollToBottom();
            // Ensure input is visible
            messageInput.scrollIntoView({ behavior: 'smooth', block: 'end' });
        }, 300);
    });

    // Handle input blur
    messageInput.addEventListener('blur', () => {
        // Small delay to let keyboard close
        setTimeout(() => {
            window.scrollTo(0, 0);
        }, 100);
    });
}

/**
 * Handle viewport resize (keyboard open/close on mobile)
 */
function handleViewportResize() {
    // Scroll to bottom when keyboard opens
    setTimeout(scrollToBottom, 100);
}

/**
 * Get or create a unique session ID
 */
function getOrCreateSessionId() {
    let storedSessionId = sessionStorage.getItem('magomar_session_id');

    if (!storedSessionId) {
        // Generate new session ID
        storedSessionId = 'session_' + Date.now() + '_' + Math.random().toString(36).substring(2, 11);
        sessionStorage.setItem('magomar_session_id', storedSessionId);
    }

    return storedSessionId;
}

/**
 * Restore message history from sessionStorage
 */
function restoreMessageHistory() {
    const stored = sessionStorage.getItem('magomar_history');

    if (stored) {
        try {
            messageHistory = JSON.parse(stored);
            // Render stored messages (skip welcome message if history exists)
            if (messageHistory.length > 0) {
                // Clear the default welcome message
                chatMessages.innerHTML = '';
                // Re-render all messages
                messageHistory.forEach(msg => {
                    appendMessage(msg.content, msg.type, false);
                });
            }
        } catch (e) {
            console.error('Failed to restore message history:', e);
            messageHistory = [];
        }
    }
}

/**
 * Save message history to sessionStorage
 */
function saveMessageHistory() {
    try {
        sessionStorage.setItem('magomar_history', JSON.stringify(messageHistory));
    } catch (e) {
        console.error('Failed to save message history:', e);
    }
}

/**
 * Handle input changes
 */
function handleInput() {
    // Auto-resize textarea
    messageInput.style.height = 'auto';
    messageInput.style.height = Math.min(messageInput.scrollHeight, 120) + 'px';

    // Enable/disable send button
    const hasContent = messageInput.value.trim().length > 0;
    sendButton.disabled = !hasContent || isLoading;
}

/**
 * Handle keyboard events
 */
function handleKeydown(e) {
    // Submit on Enter (without Shift)
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        if (!sendButton.disabled) {
            chatForm.dispatchEvent(new Event('submit'));
        }
    }
}

/**
 * Handle form submission
 */
async function handleSubmit(e) {
    e.preventDefault();

    const message = messageInput.value.trim();

    if (!message || isLoading) {
        return;
    }

    // Clear input and reset height
    messageInput.value = '';
    messageInput.style.height = 'auto';
    sendButton.disabled = true;

    // Add user message to chat
    appendMessage(message, 'user');

    // Send to webhook
    await sendMessage(message);
}

/**
 * Append a message to the chat
 */
function appendMessage(content, type, save = true) {
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${type}-message`;

    const avatarLetter = type === 'user' ? 'V' : 'M'; // V for Visitante (user), M for Magomar

    messageDiv.innerHTML = `
        <div class="message-avatar">
            <span>${avatarLetter}</span>
        </div>
        <div class="message-content">
            ${formatMessage(content)}
        </div>
    `;

    chatMessages.appendChild(messageDiv);
    scrollToBottom();

    // Save to history
    if (save) {
        messageHistory.push({ content, type, timestamp: Date.now() });
        saveMessageHistory();
    }
}

/**
 * Format message content (handle markdown-like formatting)
 */
function formatMessage(content) {
    // Escape HTML
    let formatted = escapeHtml(content);

    // Convert line breaks to <br> or <p>
    formatted = formatted
        .split('\n\n')
        .map(para => `<p>${para.replace(/\n/g, '<br>')}</p>`)
        .join('');

    // Handle bullet points
    formatted = formatted.replace(/<p>[-•]\s*(.*?)<\/p>/g, '<li>$1</li>');
    formatted = formatted.replace(/(<li>.*<\/li>)+/g, '<ul>$&</ul>');

    // Handle bold text **text**
    formatted = formatted.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');

    // Handle tables (simple detection)
    if (formatted.includes('|') && formatted.includes('<br>')) {
        formatted = convertToTable(formatted);
    }

    return formatted;
}

/**
 * Escape HTML entities
 */
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

/**
 * Convert pipe-separated text to HTML table
 */
function convertToTable(text) {
    const lines = text.split('<br>').filter(line => line.includes('|'));

    if (lines.length < 2) return text;

    let tableHtml = '<table>';

    lines.forEach((line, index) => {
        // Skip separator lines (|---|---|)
        if (line.match(/^\|[\s-|]+\|$/)) return;

        const cells = line.split('|').filter(cell => cell.trim());
        const tag = index === 0 ? 'th' : 'td';

        if (cells.length > 0) {
            tableHtml += '<tr>';
            cells.forEach(cell => {
                tableHtml += `<${tag}>${cell.trim()}</${tag}>`;
            });
            tableHtml += '</tr>';
        }
    });

    tableHtml += '</table>';

    // Replace the table portion in the text
    return text.replace(/(<p>)?(\|[^<]+<br>)+(\|[^<]+)(<\/p>)?/g, tableHtml);
}

/**
 * Send message to n8n webhook
 */
async function sendMessage(message, retryCount = 0) {
    isLoading = true;
    showTypingIndicator();

    try {
        const response = await fetch(CONFIG.webhookUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                message: message,
                sessionId: sessionId
            })
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const data = await response.json();

        // Extract reply from response
        const reply = extractReply(data);

        if (reply) {
            appendMessage(reply, 'bot');
        } else {
            throw new Error('Empty response from server');
        }

    } catch (error) {
        console.error('Error sending message:', error);

        // Retry logic
        if (retryCount < CONFIG.maxRetries) {
            console.log(`Retrying... (${retryCount + 1}/${CONFIG.maxRetries})`);
            await delay(CONFIG.retryDelay * (retryCount + 1));
            return sendMessage(message, retryCount + 1);
        }

        // Show error message
        showToast('Desculpe, ocorreu um erro. Por favor tente novamente.');

    } finally {
        isLoading = false;
        hideTypingIndicator();
        sendButton.disabled = messageInput.value.trim().length === 0;
        messageInput.focus();
    }
}

/**
 * Extract reply from webhook response
 */
function extractReply(data) {
    // Handle different response formats
    if (typeof data === 'string') {
        return data;
    }

    // Try common response keys
    return data.reply ||
           data.message ||
           data.text ||
           data.answer ||
           data.output ||
           data.response ||
           data.data ||
           (Array.isArray(data) && data[0]?.reply) ||
           (Array.isArray(data) && data[0]?.json?.reply) ||
           null;
}

/**
 * Show typing indicator
 */
function showTypingIndicator() {
    typingIndicator.classList.add('visible');
    scrollToBottom();
}

/**
 * Hide typing indicator
 */
function hideTypingIndicator() {
    typingIndicator.classList.remove('visible');
}

/**
 * Scroll chat to bottom
 */
function scrollToBottom() {
    requestAnimationFrame(() => {
        chatMessages.scrollTop = chatMessages.scrollHeight;
    });
}

/**
 * Show error toast
 */
function showToast(message) {
    const toastMessage = errorToast.querySelector('.toast-message');
    toastMessage.textContent = message;
    errorToast.classList.add('visible');

    // Auto-hide after 5 seconds
    setTimeout(hideToast, 5000);
}

/**
 * Hide error toast
 */
function hideToast() {
    errorToast.classList.remove('visible');
}

/**
 * Delay helper
 */
function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Clear chat history (for debugging/testing)
 */
function clearHistory() {
    sessionStorage.removeItem('magomar_history');
    sessionStorage.removeItem('magomar_session_id');
    location.reload();
}

// Expose clearHistory for debugging
window.clearMagomarHistory = clearHistory;
