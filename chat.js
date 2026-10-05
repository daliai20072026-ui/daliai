const API_BASE = "";

const input = document.getElementById("messageInput");
const sendBtn = document.getElementById("sendBtn");
const messages = document.getElementById("messages");
const newChatBtn = document.getElementById("newChatBtn");
const clearChatBtn = document.getElementById("clearChatBtn");
const history = document.getElementById("history");
const modeBadge = document.getElementById("modeBadge");
const imageBtn = document.getElementById("imageBtn");
const imageInput = document.getElementById("imageInput");
const attachmentMenu = document.getElementById("attachmentMenu");
const attachmentOptions = document.querySelectorAll(".attachment-option");
const imagePreview = document.getElementById("imagePreview");
const previewImage = document.getElementById("previewImage");
const filePreviewInfo = document.getElementById("filePreviewInfo");
const filePreviewIcon = document.getElementById("filePreviewIcon");
const filePreviewName = document.getElementById("filePreviewName");
const removeImageBtn = document.getElementById("removeImageBtn");
const statusDot = document.getElementById("statusDot");
const statusText = document.getElementById("statusText");
const voiceBtn = document.getElementById("voiceBtn");
let voiceAudio = null;
let voiceBusy = false;
let voiceConversationMode = false;
let speechRecognition = null;
let speechListening = false;
const voiceLanguageSelect = document.getElementById("voiceLanguage");
const VOICE_LANGUAGES = { ar: "ar-TN", fr: "fr-FR", en: "en-US" };
function getVoiceLanguage() {
    const saved = localStorage.getItem("dali_voice_language");
    if (saved && VOICE_LANGUAGES[saved]) return saved;
    const browser = String(navigator.language || "").toLowerCase();
    if (browser.startsWith("ar")) return "ar";
    if (browser.startsWith("fr")) return "fr";
    return "en";
}

function getVoiceLanguageCode() {
    return getVoiceLanguage();
}

let gradioVoiceClientPromise = null;
const XTTS_SPACE = "abdelati88/voice-clone";
const XTTS_REFERENCE_URL =
    "https://media.githubusercontent.com/media/daliai20072026-ui/daliai/main/kikivoice-cloned-file-2026-10-05-05-56-45-9835.mp3";

// Legacy Gradio voice client kept unused for compatibility.
async function getGradioVoiceClient() {
    if (!gradioVoiceClientPromise) {
        gradioVoiceClientPromise = (async () => {
            const { Client } = await import(
                "https://cdn.jsdelivr.net/npm/@gradio/client/+esm"
            );
            return Client.connect(XTTS_SPACE);
        })();
    }
    return gradioVoiceClientPromise;
}

async function getVoiceReferenceBlob() {
    const response = await fetch(XTTS_REFERENCE_URL, { cache: "force-cache" });
    if (!response.ok) throw new Error("Reference audio unavailable.");
    const blob = await response.blob();
    return new File([blob], "dali-reference.mp3", {
        type: blob.type || "audio/mpeg"
    });
}

async function getAudioBlobFromGradioResult(result) {
    const output = result?.data?.[0];
    const url = typeof output === "string"
        ? output
        : output?.url || output?.path || output?.data;

    if (!url) throw new Error("No generated audio.");
    if (url.startsWith("data:")) return (await fetch(url)).blob();

    const response = await fetch(url);
    if (!response.ok) throw new Error("Generated audio unavailable.");
    return response.blob();
}


let selectedImage = null;
let selectedImageUrl = null;
let selectedImageObjectUrl = null;
let selectedFile = null;
let isSending = false;

// Conversation context exists only in this tab's memory.
// It is never written to localStorage, cookies, or the server database.
const conversationHistory = [];
const MAX_CONTEXT_MESSAGES = 40;
const MAX_CONTEXT_CHARS = 50000;
const CHAT_SESSION_KEY = "dali-active-chat-v1";

function persistConversation() {
    try {
        sessionStorage.setItem(
            CHAT_SESSION_KEY,
            JSON.stringify(conversationHistory)
        );
    } catch (error) {
        console.warn("Could not save temporary chat context:", error);
    }
}

function restoreConversation() {
    try {
        const raw = sessionStorage.getItem(CHAT_SESSION_KEY);
        if (!raw) return false;

        const saved = JSON.parse(raw);
        if (!Array.isArray(saved)) return false;

        conversationHistory.length = 0;

        for (const item of saved.slice(-MAX_CONTEXT_MESSAGES)) {
            if (!item || !["user", "assistant"].includes(item.role)) continue;
            if (typeof item.content !== "string" || !item.content.trim()) continue;

            conversationHistory.push({
                role: item.role,
                content: item.content.slice(0, 8000)
            });
        }

        if (!conversationHistory.length) return false;

        messages.innerHTML = "";
        for (const item of conversationHistory) {
            addMessage(item.content, item.role === "assistant" ? "ai-message" : "user-message");
        }

        updateMode("general");
        return true;
    } catch (error) {
        console.warn("Could not restore temporary chat context:", error);
        conversationHistory.length = 0;
        return false;
    }
}

const MAX_IMAGE_SIZE = 5 * 1024 * 1024;
const MAX_FILE_SIZE = 10 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set([
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/gif"
]);

async function readApiResponse(response) {
    const text = await response.text();

    if (!text) {
        return {};
    }

    try {
        return JSON.parse(text);
    } catch {
        throw new Error(
            "Server returned invalid JSON (HTTP " + response.status + ")."
        );
    }
}

async function apiRequest(path, options = {}) {
    const headers = new Headers(options.headers || {});

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60000);

    let response;

    try {
        response = await fetch(
            API_BASE + path,
            {
                cache: "no-store",
                credentials: "same-origin",
                ...options,
                headers,
                signal: options.signal || controller.signal
            }
        );
    } catch (error) {
        if (error.name === "AbortError") {
            throw new Error("The request timed out. Please try again.");
        }
        throw error;
    } finally {
        clearTimeout(timeoutId);
    }

    const data = await readApiResponse(response);

    if (!response.ok) {
        const rawError = data.error ?? data.details;
        let message =
            typeof rawError === "string"
                ? rawError
                : rawError && typeof rawError === "object"
                    ? (rawError.message || rawError.error || JSON.stringify(rawError))
                    : ("Request failed with HTTP " + response.status);

        if (response.status === 401 && /protected deployment/i.test(message)) {
            message = "This Vercel deployment is protected. Use the public Production URL, or sign in to Vercel for this deployment.";
        }

        throw new Error(message);
    }

    return data;
}

function escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text ?? "";
    return div.innerHTML;
}

function containsArabic(text) {
    return /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/.test(text || "");
}

function protectMath(text) {
    const formulas = [];
    const patterns = [
        /\\\[[\s\S]*?\\\]/g,
        /\$\$[\s\S]*?\$\$/g,
        /\\\([\s\S]*?\\\)/g,
        /\$(?!\s)(?:\\.|[^$\\\n])+\$/g
    ];

    for (const pattern of patterns) {
        text = text.replace(pattern, match => {
            const index = formulas.length;
            formulas.push(match);
            // Keep math outside Markdown parsing so underscores, asterisks,
            // backslashes, and dollar signs are not rewritten by marked.
            return "DALI_MATH_TOKEN" + index + "END";
        });
    }

    return { text, formulas };
}

function restoreMath(text, formulas) {
    formulas.forEach((formula, index) => {
        const token = "DALI_MATH_TOKEN" + index + "END";
        text = text.replace(new RegExp(token, "g"), formula);
    });

    return text;
}

function renderMarkdownFallback(text) {
    const fence = String.fromCharCode(96).repeat(3);
    const lines = String(text ?? "").replace(/\r\n?/g, "\n").split("\n");
    const output = [];
    let inCode = false;
    let codeLanguage = "";
    let codeLines = [];
    let inList = false;
    let listType = null;
    let inTable = false;

    const closeList = () => {
        if (!inList) return;
        output.push("</" + listType + ">");
        inList = false;
        listType = null;
    };

    const closeTable = () => {
        if (!inTable) return;
        output.push("</tbody></table>");
        inTable = false;
    };

    const inline = (value) => {
        let html = escapeHtml(value);
        html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
        html = html.replace(/\*([^*\n]+)\*/g, "<em>$1</em>");
        html = html.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
        return html;
    };

    for (const line of lines) {
        const trimmed = line.trim();

        if (trimmed.startsWith(fence)) {
            closeList();
            closeTable();

            if (!inCode) {
                inCode = true;
                codeLanguage = trimmed.slice(3).trim();
                codeLines = [];
            } else {
                const className = codeLanguage
                    ? ' class="language-' + escapeHtml(codeLanguage) + '"'
                    : "";
                output.push("<pre><code" + className + ">" + escapeHtml(codeLines.join("\n")) + "</code></pre>");
                inCode = false;
                codeLanguage = "";
                codeLines = [];
            }
            continue;
        }

        if (inCode) {
            codeLines.push(line);
            continue;
        }

        if (!trimmed) {
            closeList();
            continue;
        }

        const heading = trimmed.match(/^(#{1,6})\s+(.+)$/);
        if (heading) {
            closeList();
            closeTable();
            const level = heading[1].length;
            output.push("<h" + level + ">" + inline(heading[2]) + "</h" + level + ">");
            continue;
        }

        const quote = trimmed.match(/^>\s?(.*)$/);
        if (quote) {
            closeList();
            closeTable();
            output.push("<blockquote>" + inline(quote[1]) + "</blockquote>");
            continue;
        }

        const tableRow = trimmed.startsWith("|") && trimmed.endsWith("|");
        if (tableRow) {
            closeList();
            const cells = trimmed.slice(1, -1).split("|").map(cell => cell.trim());

            if (cells.every(cell => /^:?-{3,}:?$/.test(cell))) {
                continue;
            }

            if (!inTable) {
                output.push("<table><thead><tr>" + cells.map(cell => "<th>" + inline(cell) + "</th>").join("") + "</tr></thead><tbody>");
                inTable = true;
            } else {
                output.push("<tr>" + cells.map(cell => "<td>" + inline(cell) + "</td>").join("") + "</tr>");
            }
            continue;
        }

        closeTable();

        const listMatch = trimmed.match(/^([-*+] |\d+[.] )(.*)$/);
        if (listMatch) {
            const nextType = /^\d+[.] /.test(listMatch[1]) ? "ol" : "ul";
            if (!inList || listType !== nextType) {
                closeList();
                listType = nextType;
                inList = true;
                output.push("<" + listType + ">");
            }
            output.push("<li>" + inline(listMatch[2]) + "</li>");
            continue;
        }

        closeList();
        output.push("<p>" + inline(trimmed) + "</p>");
    }

    closeList();
    closeTable();

    if (inCode) {
        output.push("<pre><code>" + escapeHtml(codeLines.join("\n")) + "</code></pre>");
    }

    return output.join("");
}

function renderMarkdown(text) {
    text = text ?? "";
    const protectedMath = protectMath(text);

    if (
        typeof marked === "undefined" ||
        typeof DOMPurify === "undefined"
    ) {
        const safeFormulas = protectedMath.formulas.map(formula =>
            String(formula)
                .replace(/&/g, "&amp;")
                .replace(/</g, "&lt;")
                .replace(/>/g, "&gt;")
        );

        return restoreMath(
            renderMarkdownFallback(protectedMath.text),
            safeFormulas
        );
    }

    const rawHtml = marked.parse(
        protectedMath.text,
        { breaks: true }
    );

    const restoredHtml = restoreMath(
        rawHtml,
        protectedMath.formulas
    );

    return DOMPurify.sanitize(restoredHtml);
}

async function copyToClipboard(text) {
    const value = String(text ?? "");

    try {
        if (navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(value);
            return true;
        }
    } catch (error) {
        console.warn("Clipboard API unavailable:", error);
    }

    try {
        const textarea = document.createElement("textarea");
        textarea.value = value;
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        textarea.setAttribute("readonly", "");
        document.body.appendChild(textarea);
        textarea.select();

        const copied = document.execCommand("copy");
        textarea.remove();

        return copied;
    } catch (error) {
        console.error("Fallback copy failed:", error);
        return false;
    }
}

function makeCopyButton(label, successLabel, text) {
    const button = document.createElement("button");
    button.className = "copy-action";
    button.type = "button";
    button.textContent = label;

    button.addEventListener("click", async () => {
        const copied = await copyToClipboard(text);

        if (copied) {
            button.textContent = successLabel;
            button.classList.add("copied");

            setTimeout(() => {
                button.textContent = label;
                button.classList.remove("copied");
            }, 1500);
        } else {
            button.textContent = "Copy failed";

            setTimeout(() => {
                button.textContent = label;
            }, 1500);
        }
    });

    return button;
}

function addCopyButtons(message, originalText = "") {
    message.querySelectorAll("pre").forEach(pre => {
        if (
            pre.parentElement &&
            pre.parentElement.classList.contains("code-wrapper")
        ) {
            return;
        }

        const wrapper = document.createElement("div");
        wrapper.className = "code-wrapper";

        pre.parentNode.insertBefore(wrapper, pre);
        wrapper.appendChild(pre);

        const button = makeCopyButton(
            "Copy code",
            "Copied",
            pre.innerText
        );

        button.classList.add("copy-code");
        wrapper.appendChild(button);
    });

    const actions = document.createElement("div");
    actions.className = "message-actions";

    const copyResponse = makeCopyButton(
        "Copy",
        "Copied",
        originalText
    );

    actions.appendChild(copyResponse);
    message.appendChild(actions);
}

function renderMath(element) {
    if (!element || typeof renderMathInElement !== "function") {
        return;
    }

    try {
        renderMathInElement(element, {
            delimiters: [
                { left: "\\[", right: "\\]", display: true },
                { left: "$$", right: "$$", display: true },
                { left: "\\(", right: "\\)", display: false },
                { left: "$", right: "$", display: false }
            ],
            throwOnError: false,
            strict: "ignore",
            trust: false
        });
    } catch (error) {
        console.warn("KaTeX rendering failed:", error);
    }
}

function renderAllMath() {
    if (typeof renderMathInElement !== "function") return;

    document.querySelectorAll(".message-content").forEach(element => {
        if (
            element.textContent.includes("\\(") ||
            element.textContent.includes("\\)") ||
            element.textContent.includes("\\[") ||
            element.textContent.includes("\\]") ||
            element.textContent.includes("$")
        ) {
            renderMath(element);
        }
    });
}

window.addEventListener("load", () => {
    renderAllMath();
});
 
function parseStoredFile(text) {
    const match = String(text || "").match(
        /^([\s\S]*?)\[DALI_FILE\]\nfilename:\s*(.+?)\n\[FILE_TEXT\]\n[\s\S]*?\n\[DALI_FILE_END\]\s*$/
    );

    if (!match) {
        return {
            visibleText: text || "",
            filename: null
        };
    }

    return {
        visibleText: match[1].trim(),
        filename: match[2].trim()
    };
}

function addMessage(text, type, imageUrl = null, fileName = null) {
    const welcomeScreen = document.getElementById("welcomeScreen");
    if (welcomeScreen) {
        welcomeScreen.remove();
    }

    const message = document.createElement("div");
    message.className = "message " + type;

    const content = document.createElement("div");
    content.className = "message-content";

    const storedFile = type === "user-message"
        ? parseStoredFile(text)
        : { visibleText: text || "", filename: null };

    const visibleText = storedFile.visibleText;

    if (containsArabic(visibleText)) {
        content.classList.add("rtl");
    }

    if (type === "ai-message") {
        content.innerHTML = renderMarkdown(text);
    } else {
        content.textContent = visibleText;
    }

    const displayedFileName = fileName || storedFile.filename;

    if (displayedFileName && type === "user-message") {
        const chip = document.createElement("div");
        chip.className = "message-file-chip";

        const icon = document.createElement("span");
        icon.className = "ui-icon message-file-icon";
        icon.setAttribute("aria-hidden", "true");
        icon.textContent = getFileIcon(displayedFileName);

        const name = document.createElement("span");
        name.textContent = displayedFileName;

        chip.appendChild(icon);
        chip.appendChild(name);
        content.appendChild(chip);
    }

    if (imageUrl && type === "user-message") {
        const image = document.createElement("img");
        image.src = imageUrl;
        image.alt = "Attached image";
        image.className = "message-image";
        image.loading = "lazy";
        content.appendChild(image);
    }

    message.appendChild(content);
    messages.appendChild(message);

    if (type === "ai-message") {
        addCopyButtons(message, text);
        renderMath(message);
    }

    messages.scrollTop = messages.scrollHeight;
    return message;
}

function createLoadingMessage(title, detail) {
    const welcomeScreen = document.getElementById("welcomeScreen");
    if (welcomeScreen) {
        welcomeScreen.remove();
    }

    const message = document.createElement("div");
    message.className = "message loading-message";
    message.setAttribute("role", "status");
    message.setAttribute("aria-live", "polite");

    message.innerHTML = `
        <div class="loading-message-inner">
            <div class="loading-orb" aria-hidden="true">
                <span class="loading-spinner"></span>
            </div>
            <div class="loading-copy">
                <div class="loading-title">
                    <span class="loading-title-text"></span>
                    <span class="loading-dots" aria-hidden="true">
                        <span></span><span></span><span></span>
                    </span>
                </div>
                <div class="loading-detail"></div>
            </div>
        </div>
    `;

    const titleNode = message.querySelector(".loading-title-text");
    const detailNode = message.querySelector(".loading-detail");

    if (titleNode) titleNode.textContent = title || "Dali AI is working";
    if (detailNode) detailNode.textContent = detail || "Please wait…";

    messages.appendChild(message);
    messages.scrollTop = messages.scrollHeight;

    return message;
}

function setLoadingState(message, title, detail) {
    if (!message) return;

    const titleNode = message.querySelector(".loading-title-text");
    const detailNode = message.querySelector(".loading-detail");

    if (titleNode) titleNode.textContent = title || "Dali AI is working";
    if (detailNode) detailNode.textContent = detail || "Please wait…";

    messages.scrollTop = messages.scrollHeight;
}


function updateMode(mode) {
    if (!modeBadge) return;

    if (mode === "coding") {
        modeBadge.textContent = "Coding";
    } else if (mode === "study") {
        modeBadge.textContent = "Study";
    } else {
        modeBadge.textContent = "General";
    }
}

function updateConnectionStatus() {
    const online = navigator.onLine;

    if (statusText && statusDot) {
        statusText.textContent = online ? "Online" : "Offline";
        statusDot.style.background = online ? "var(--green)" : "var(--red)";
    }

    document.body.classList.toggle("offline-mode", !online);

    if (input) {
        input.disabled = !online;
        input.placeholder = online
            ? "Ask Dali AI anything..."
            : "You're offline — reconnect to send a message.";
    }

    if (sendBtn) {
        sendBtn.disabled = !online;
        sendBtn.title = online ? "Send message" : "Connect to the internet to send";
    }

    if (imageBtn) {
        imageBtn.disabled = !online;
        imageBtn.title = online
            ? "Import image"
            : "Connect to the internet to analyze an image";
    }
}

function showWelcome() {
    updateMode("general");

    messages.innerHTML = `
        <div class="welcome-screen" id="welcomeScreen">
            <div class="welcome-logo">
                <img src="./logo.png" alt="Dali AI">
            </div>

            <p class="welcome-eyebrow">Your everyday AI assistant</p>

            <h1>What can I help you with?</h1>

            <p class="welcome-subtitle">
                Ask a question, upload an image, get help with school,
                write something, or work on your code.
            </p>

            <div class="quick-prompts">
                <button type="button" class="prompt-card" data-prompt="Explain this topic in a simple way.">
                    <span class="ui-icon prompt-icon" aria-hidden="true">✦</span>
                    <span>
                        <strong>Study</strong>
                        <small>Explain something simply</small>
                    </span>
                </button>

                <button type="button" class="prompt-card" data-prompt="Help me fix this code and explain the error.">
                    <span class="ui-icon prompt-icon" aria-hidden="true">&lt;/&gt;</span>
                    <span>
                        <strong>Coding</strong>
                        <small>Fix and explain code</small>
                    </span>
                </button>

                <button type="button" class="prompt-card" data-prompt="Solve this math exercise step by step.">
                    <span class="ui-icon prompt-icon" aria-hidden="true">∑</span>
                    <span>
                        <strong>Math</strong>
                        <small>Step-by-step solutions</small>
                    </span>
                </button>

                <button type="button" class="prompt-card" data-prompt="Write a clear and professional version of this text.">
                    <span class="ui-icon prompt-icon" aria-hidden="true">✎</span>
                    <span>
                        <strong>Writing</strong>
                        <small>Write or improve text</small>
                    </span>
                </button>
            </div>

            <p class="welcome-hint">
                Use <strong>Attach</strong> to add a file or image.
            </p>
        </div>
    `;

    messages.querySelectorAll(".prompt-card").forEach(button => {
        button.addEventListener("click", () => {
            if (!input) return;
            input.value = button.dataset.prompt || "";
            input.focus();
            input.dispatchEvent(new Event("input", { bubbles: true }));
        });
    });
}

function updateHistoryNotice() {
    if (!history) return;

    history.innerHTML = "";

    const item = document.createElement("div");
    item.className = "history-item history-disabled";
    item.textContent = "Current chat stays in this tab only.";
    history.appendChild(item);
}

function getConversationHistoryForRequest() {
    const selected = [];
    let total = 0;

    for (let i = conversationHistory.length - 1; i >= 0 && selected.length < MAX_CONTEXT_MESSAGES; i--) {
        const item = conversationHistory[i];

        if (!item || !["user", "assistant"].includes(item.role)) {
            continue;
        }

        const content = String(item.content || "");
        const remaining = MAX_CONTEXT_CHARS - total;

        if (remaining <= 0) {
            break;
        }

        const clipped = content.slice(0, remaining);
        selected.unshift({
            role: item.role,
            content: clipped
        });

        total += clipped.length;
    }

    return selected;
}

function rememberTurn(userContent, assistantContent) {
    if (userContent) {
        conversationHistory.push({
            role: "user",
            content: userContent
        });
    }

    if (assistantContent) {
        conversationHistory.push({
            role: "assistant",
            content: assistantContent
        });
    }

    while (conversationHistory.length > MAX_CONTEXT_MESSAGES) {
        conversationHistory.shift();
    }

    persistConversation();
}

function loadChats() {
    updateHistoryNotice();
}

function startNewChat() {
    conversationHistory.length = 0;

    try {
        sessionStorage.removeItem(CHAT_SESSION_KEY);
    } catch (error) {
        console.warn("Could not clear temporary chat context:", error);
    }

    removeSelectedImage();
    showWelcome();
    updateHistoryNotice();
    input?.focus();
}

function clearChat() {
    startNewChat();
}

function removeSelectedImage() {
    selectedImage = null;
    selectedImageUrl = null;
    selectedFile = null;

    if (selectedImageObjectUrl) {
        URL.revokeObjectURL(selectedImageObjectUrl);
        selectedImageObjectUrl = null;
    }

    if (previewImage) {
        previewImage.onload = null;
        previewImage.onerror = null;
        previewImage.removeAttribute("src");
        previewImage.style.display = "none";
    }

    if (filePreviewInfo) {
        filePreviewInfo.style.display = "none";
    }

    if (filePreviewName) {
        filePreviewName.textContent = "";
    }

    if (filePreviewIcon) {
        filePreviewIcon.textContent = "📎";
    }

    if (imagePreview) {
        imagePreview.style.display = "none";

        const previewStatus = imagePreview.querySelector(".image-preview-status");
        if (previewStatus) {
            previewStatus.textContent = "";
        }
    }

    if (imageInput) {
        imageInput.value = "";
    }
}

function selectFile(file) {
    if (!file) return;

    if (file.size > MAX_FILE_SIZE) {
        addMessage(
            "This file is too large. Maximum size is 10 MB.",
            "ai-message"
        );
        return;
    }

    removeSelectedImage();

    const extension = String(file.name || "")
        .split(".")
        .pop()
        .toLowerCase();

    const imageExtensions = new Set(["jpg", "jpeg", "png", "webp", "gif"]);
    const isImage =
        ALLOWED_IMAGE_TYPES.has(file.type) ||
        imageExtensions.has(extension);

    const readableExtensions = new Set([
        "txt", "md", "markdown", "csv", "tsv", "json", "xml",
        "html", "htm", "css", "js", "jsx", "ts", "tsx",
        "py", "pyw", "php", "java", "c", "h", "cpp", "cxx",
        "hpp", "cs", "sql", "sh", "bat", "ps1", "jsonl",
        "yaml", "yml", "ini", "cfg", "conf", "log", "tex",
        "scss", "sass", "less", "vue", "svelte", "asm",
        "pdf", "docx", "xlsx", "xlsm", "pptx"
    ]);

    if (!isImage && !readableExtensions.has(extension)) {
        addMessage(
            "This file type is not supported for reading by Dali AI.",
            "ai-message"
        );
        return;
    }

    if (isImage) {
        if (file.size > MAX_IMAGE_SIZE) {
            addMessage(
                "Image is too large. Maximum size is 5 MB.",
                "ai-message"
            );
            return;
        }

        selectedImage = file;

        if (previewImage) {
            previewImage.onload = null;
            previewImage.onerror = () => {
                previewImage.removeAttribute("src");
                previewImage.style.display = "none";

                const previewStatus = imagePreview?.querySelector(".image-preview-status");
                if (previewStatus) {
                    previewStatus.textContent =
                        "Preview unavailable — the image will still be sent.";
                }
            };

            selectedImageObjectUrl = URL.createObjectURL(file);
            previewImage.src = selectedImageObjectUrl;
            previewImage.style.display = "block";
            previewImage.alt = file.name || "Selected image";
        }

        if (filePreviewInfo) {
            filePreviewInfo.style.display = "none";
        }

        if (imagePreview) {
            imagePreview.style.display = "flex";

            let previewStatus =
                imagePreview.querySelector(".image-preview-status");

            if (!previewStatus) {
                previewStatus = document.createElement("span");
                previewStatus.className = "image-preview-status";
                imagePreview.appendChild(previewStatus);
            }

            previewStatus.textContent = "";
        }

        const reader = new FileReader();

        reader.onload = () => {
            selectedImageUrl = reader.result;
        };

        reader.onerror = () => {
            const previewStatus =
                imagePreview?.querySelector(".image-preview-status");

            if (previewStatus) {
                previewStatus.textContent =
                    "Could not prepare the image, but you can still try sending it.";
            }
        };

        reader.readAsDataURL(file);
        return;
    }

    selectedFile = file;

    if (previewImage) {
        previewImage.onload = null;
        previewImage.onerror = null;
        previewImage.removeAttribute("src");
        previewImage.style.display = "none";
    }

    if (filePreviewInfo) {
        filePreviewInfo.style.display = "flex";
    }

    if (filePreviewName) {
        filePreviewName.textContent = file.name || "Selected file";
    }

    if (filePreviewIcon) {
        filePreviewIcon.textContent = getFileIcon(file.name);
    }

    if (imagePreview) {
        imagePreview.style.display = "flex";

        let previewStatus =
            imagePreview.querySelector(".image-preview-status");

        if (!previewStatus) {
            previewStatus = document.createElement("span");
            previewStatus.className = "image-preview-status";
            imagePreview.appendChild(previewStatus);
        }

        previewStatus.textContent = "";
    }
}

function getFileIcon(filename) {
    const extension = String(filename || "")
        .split(".")
        .pop()
        .toLowerCase();

    const icons = {
        pdf: "▣",
        docx: "▤",
        txt: "▤",
        md: "▤",
        csv: "▦",
        xlsx: "▦",
        xlsm: "▦",
        json: "{}",
        py: "</>",
        js: "</>",
        html: "</>",
        css: "</>",
        sql: "▦",
        pptx: "▥"
    };

    return icons[extension] || "📎";
}

async function sendMessage() {
    if (isSending) return;

    const text = (input?.value || "").trim();

    if (!text && !selectedImage && !selectedFile) {
        return;
    }

    isSending = true;

    const sendText = text;
    const imageFile = selectedImage;
    const fileFile = selectedFile;
    const imageUrl = selectedImageUrl;
    const attachmentName = imageFile?.name || fileFile?.name || null;
    const contextBeforeTurn = getConversationHistoryForRequest();

    addMessage(
        sendText || "Attachment",
        "user-message",
        imageUrl,
        attachmentName
    );

    input.value = "";

    if (typeof autoResize === "function") {
        autoResize();
    }

    removeSelectedImage();

    sendBtn.disabled = true;

    const loading = createLoadingMessage(
        imageFile || fileFile ? "Uploading your file…" : "Dali AI is thinking…",
        imageFile || fileFile
            ? "Your attachment is being sent securely. Please keep this page open."
            : "Your message was sent. Dali AI is preparing the answer."
    );

    let loadingStageTimer = null;

    if (imageFile || fileFile) {
        loadingStageTimer = window.setTimeout(() => {
            setLoadingState(
                loading,
                "Dali AI is reading your file…",
                "The upload is complete or nearly complete. Dali AI is processing it now."
            );
        }, 900);
    }

    try {
        let options;

        if (imageFile || fileFile) {
            const formData = new FormData();
            formData.append("message", sendText);
            formData.append("history", JSON.stringify(contextBeforeTurn));

            if (imageFile) {
                formData.append("image", imageFile);
            } else {
                formData.append("file", fileFile);
            }

            options = {
                method: "POST",
                body: formData
            };
        } else {
            const body = {
                message: sendText,
                history: contextBeforeTurn
            };

            options = {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify(body)
            };
        }

        const data = await apiRequest("/api/chat", options);

        if (loadingStageTimer) {
            clearTimeout(loadingStageTimer);
            loadingStageTimer = null;
        }

        setLoadingState(
            loading,
            "Response received ✓",
            "Dali AI finished processing. Showing your answer now…"
        );

        await new Promise(resolve => window.setTimeout(resolve, 180));

        loading.remove();

        const reply = data.reply || data.response || data.message || "No response.";

        addMessage(reply, "ai-message");
        if (voiceConversationMode) {
            voiceConversationMode = false;
        }

        const rememberedUser = sendText
            || (imageFile ? "[Image attached]" : "")
            || (fileFile ? "[File attached: " + fileFile.name + "]" : "");

        rememberTurn(rememberedUser, reply);
        updateMode(data.mode || "general");
    } catch (error) {
        if (loadingStageTimer) {
            clearTimeout(loadingStageTimer);
            loadingStageTimer = null;
        }

        loading.remove();

        console.error("Dali AI error:", error);

        addMessage(
            navigator.onLine
                ? "Dali AI error: " + error.message
                : "You're offline. Reconnect to the internet and try again.",
            "ai-message"
        );
    } finally {
        isSending = false;

        // Voice status must never remain stuck over the composer after the
        // voice request has been sent or completed.
        if (!speechListening) {
            setVoiceUi("", "Voice ready");
        }

        updateConnectionStatus();
        input?.focus();
    }
}
if (sendBtn) {
    sendBtn.addEventListener("click", sendMessage);
}

if (newChatBtn) {
    newChatBtn.addEventListener("click", startNewChat);
}

if (clearChatBtn) {
    clearChatBtn.addEventListener("click", clearChat);
}

function setAttachmentMenu(open) {
    if (!attachmentMenu || !imageBtn) return;

    attachmentMenu.classList.toggle("show", open);
    attachmentMenu.setAttribute("aria-hidden", String(!open));
    imageBtn.setAttribute("aria-expanded", String(open));
}

if (imageBtn && attachmentMenu) {
    imageBtn.addEventListener("click", event => {
        event.stopPropagation();

        if (!navigator.onLine) {
            return;
        }

        setAttachmentMenu(
            !attachmentMenu.classList.contains("show")
        );
    });
}

attachmentOptions.forEach(option => {
    option.addEventListener("click", () => {
        const accept = option.dataset.accept || "*/*";

        if (imageInput) {
            imageInput.accept = accept;
            imageInput.value = "";
            imageInput.click();
        }

        setAttachmentMenu(false);
    });
});

document.addEventListener("click", event => {
    if (
        attachmentMenu &&
        imageBtn &&
        !attachmentMenu.contains(event.target) &&
        event.target !== imageBtn
    ) {
        setAttachmentMenu(false);
    }
});

if (imageInput) {
    imageInput.addEventListener("change", () => {
        const file = imageInput.files?.[0];

        if (file) {
            selectFile(file);
        }

        setAttachmentMenu(false);
    });
}

if (removeImageBtn) {
    removeImageBtn.addEventListener(
        "click",
        removeSelectedImage
    );
}

if (input) {
    input.addEventListener("input", () => {
        input.style.height = "auto";
        input.style.height =
            Math.min(input.scrollHeight, 160) + "px";
    });

    input.addEventListener("keydown", event => {
        if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            sendMessage();
        }
    });
}

window.addEventListener("online", updateConnectionStatus);
window.addEventListener("offline", updateConnectionStatus);

updateConnectionStatus();

(function init() {
    const restored = restoreConversation();

    if (!restored) {
        showWelcome();
    }

    updateConnectionStatus();
    updateHistoryNotice();

    if ("serviceWorker" in navigator) {
        navigator.serviceWorker.register("./sw.js").catch(error => {
            console.warn("Dali AI offline cache unavailable:", error);
        });
    }
})();
function setVoiceUi(state, text) {
    if (!voiceBtn) return;
    const status = document.getElementById("voiceStatus");
    const statusText = document.getElementById("voiceStatusText");
    const label = voiceBtn.querySelector(".voice-label");
    const icon = voiceBtn.querySelector(".voice-mic");

    voiceBtn.classList.remove("voice-listening", "voice-thinking", "voice-speaking", "voice-error");

    if (state) voiceBtn.classList.add("voice-" + state);
    if (label) label.textContent = state === "listening" ? "Stop" : "Voice";
    if (icon) icon.textContent = state === "listening" ? "■" : "🎙";
    if (statusText) statusText.textContent = text || "Voice ready";
    if (status) status.classList.toggle("show", state === "listening" || state === "thinking" || state === "speaking" || state === "error");
}

function setVoiceBusyState(state, text) {
    setVoiceUi(state, text);
}

if (voiceBtn) {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!SpeechRecognition) {
        voiceBtn.disabled = true;
        voiceBtn.classList.add("voice-unavailable");
        voiceBtn.title = "Voice input is not supported by this browser";
        voiceBtn.setAttribute("aria-label", "Voice input is not supported by this browser");
        setVoiceUi("error", "Voice input is not supported in this browser");
    } else {
        speechRecognition = new SpeechRecognition();
        speechRecognition.continuous = false;
        speechRecognition.interimResults = true;
        const initialVoiceLanguage = getVoiceLanguage();
        if (voiceLanguageSelect) {
            voiceLanguageSelect.value = initialVoiceLanguage;
            voiceLanguageSelect.addEventListener("change", () => {
                localStorage.setItem("dali_voice_language", voiceLanguageSelect.value);
                if (speechRecognition && speechListening) speechRecognition.stop();
            });
        }
        speechRecognition.lang = VOICE_LANGUAGES[initialVoiceLanguage];

        speechRecognition.onstart = () => {
            speechListening = true;
            voiceConversationMode = true;
            voiceBtn.classList.add("voice-listening");
            setVoiceUi("listening", "Listening… speak now");
        };

        speechRecognition.onresult = event => {
            let transcript = "";
            for (let i = event.resultIndex; i < event.results.length; i++) {
                transcript += event.results[i]?.[0]?.transcript || "";
            }
            transcript = transcript.trim();
            if (!transcript || !input) return;

            input.value = transcript;
            input.dispatchEvent(new Event("input", {bubbles: true}));

            const finalResult = event.results?.[event.results.length - 1];
            if (finalResult?.isFinal) {
                setVoiceUi("thinking", "Sending your voice message…");
                sendMessage();
            }
        };

        speechRecognition.onerror = event => {
            console.warn("Speech recognition error:", event.error);
            voiceConversationMode = false;
            setVoiceUi("error", event.error === "not-allowed"
                ? "Microphone permission was denied"
                : "Voice input stopped — try again");
        };

        speechRecognition.onend = () => {
            speechListening = false;
            voiceBtn.classList.remove("voice-listening");
            if (!voiceBusy && !isSending) {
                setVoiceUi("", "Voice ready");
            }
        };

        voiceBtn.addEventListener("click", () => {
            if (voiceBusy || isSending) return;

            if (speechListening) {
                speechRecognition.stop();
                voiceConversationMode = false;
                setVoiceUi("", "Voice ready");
                return;
            }

            try {
                speechRecognition.lang = VOICE_LANGUAGES[getVoiceLanguage()];
                speechRecognition.start();
            } catch (error) {
                console.warn("Could not start speech recognition:", error);
            }
        });
    }
}
