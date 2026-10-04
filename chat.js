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

let currentChatId = null;
let selectedImage = null;
let selectedImageUrl = null;
let selectedImageObjectUrl = null;
let selectedFile = null;
let isSending = false;

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

let fallbackUserId = null;

function getDaliUserId() {
    const key = "dali_ai_user_id";

    try {
        const storedUserId = localStorage.getItem(key);

        if (storedUserId) {
            return storedUserId;
        }

        const newUserId = (
            typeof crypto !== "undefined" &&
            typeof crypto.randomUUID === "function"
        )
            ? crypto.randomUUID()
            : (
                "dali-" +
                Date.now().toString(36) +
                "-" +
                Math.random().toString(36).slice(2, 12)
            );

        localStorage.setItem(key, newUserId);
        return newUserId;
    } catch (error) {
        console.warn("Local storage unavailable:", error);
    }

    if (!fallbackUserId) {
        fallbackUserId = (
            typeof crypto !== "undefined" &&
            typeof crypto.randomUUID === "function"
        )
            ? crypto.randomUUID()
            : "dali-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 12);
    }

    return fallbackUserId;
}

async function apiRequest(path, options = {}) {
    const headers = new Headers(options.headers || {});

    // Authentication/session identity is now handled by the server-side
    // HttpOnly Flask session cookie. Never trust a client-supplied user ID.
    headers.delete("X-Dali-User");

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
        throw new Error(
            data.error ||
            data.details ||
            ("Request failed with HTTP " + response.status)
        );
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
            return "DALI_MATH_TOKEN_" + index + "_END";
        });
    }

    return { text, formulas };
}

function restoreMath(text, formulas) {
    formulas.forEach((formula, index) => {
        const token = "DALI_MATH_TOKEN_" + index + "_END";
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
        return restoreMath(
            renderMarkdownFallback(protectedMath.text),
            protectedMath.formulas
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

async function renderMath(element, attempts = 0) {
    if (typeof MathJax === "undefined") {
        if (attempts >= 25) return;
        setTimeout(() => renderMath(element, attempts + 1), 200);
        return;
    }

    try {
        if (MathJax.startup?.promise) {
            await MathJax.startup.promise;
        }

        await MathJax.typesetPromise([element]);
    } catch (error) {
        console.error("MathJax error:", error);
    }
}

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

async function loadChats() {
    if (!history) return;

    try {
        const data = await apiRequest("/api/chats");

        history.innerHTML = "";

        if (!data.chats?.length) {
            const empty = document.createElement("div");
            empty.className = "history-item";
            empty.textContent = "No chats yet";
            history.appendChild(empty);
            return;
        }

        data.chats.forEach(createHistoryItem);
    } catch (error) {
        console.error("Load chats error:", error);
        history.innerHTML = "";

        const item = document.createElement("div");
        item.className = "history-item";
        item.textContent = "History unavailable";
        history.appendChild(item);
    }
}

function createHistoryItem(chat) {
    const item = document.createElement("div");
    item.className = "history-item";

    if (String(chat.id) === String(currentChatId)) {
        item.classList.add("active");
    }

    item.textContent = chat.title || "New Chat";

    item.addEventListener("click", () => {
        loadChat(chat.id);
    });

    history.appendChild(item);
}

async function loadChat(chatId) {
    if (!chatId) {
        startNewChat();
        return;
    }

    try {
        const data = await apiRequest(
            "/api/chats/" + encodeURIComponent(chatId)
        );

        currentChatId = data.id || chatId;
        messages.innerHTML = "";
        updateMode("general");

        if (!data.messages?.length) {
            showWelcome();
        } else {
            data.messages.forEach(message => {
                const text = message.text ?? message.content ?? "";
                addMessage(
                    text,
                    message.role === "user"
                        ? "user-message"
                        : "ai-message"
                );
            });
        }

        await loadChats();
    } catch (error) {
        console.error("Load chat error:", error);

        // The chat may have disappeared on a serverless instance.
        // Clear the stale ID instead of leaving the UI stuck on a dead chat.
        currentChatId = null;
        await loadChats();

        addMessage(
            "This chat is no longer available. A new chat will be created when you send your next message.",
            "ai-message"
        );
    }
}

function startNewChat() {
    currentChatId = null;
    removeSelectedImage();
    showWelcome();
    loadChats();
    input?.focus();
}

async function deleteCurrentChat() {
    if (!currentChatId) {
        startNewChat();
        return;
    }

    try {
        await apiRequest(
            "/api/chats/" + encodeURIComponent(currentChatId),
            { method: "DELETE" }
        );

        currentChatId = null;
        showWelcome();
        await loadChats();
    } catch (error) {
        console.error("Delete chat error:", error);

        addMessage(
            "Could not clear this chat: " + error.message,
            "ai-message"
        );
    }
}

function clearChat() {
    deleteCurrentChat();
}

function removeSelectedImage() {
    selectedImage = null;
    selectedImageUrl = null;
    selectedFile = null;

    if (previewImage) {
        previewImage.src = "about:blank";
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

        const reader = new FileReader();

        reader.onload = () => {
            selectedImageUrl = reader.result;

            if (selectedImageObjectUrl) {
                URL.revokeObjectURL(selectedImageObjectUrl);
            }
            selectedImageObjectUrl = URL.createObjectURL(file);

            if (previewImage) {
                previewImage.onload = null;
                previewImage.onerror = () => {
                    previewImage.removeAttribute("src");
                    previewImage.style.display = "none";

                    const previewStatus = imagePreview?.querySelector(".image-preview-status");
                    if (previewStatus) {
                        previewStatus.textContent = "Preview unavailable — the image will still be sent.";
                    }
                };

                previewImage.src = selectedImageObjectUrl;
                previewImage.style.display = "block";
                previewImage.alt = file.name || "Selected image";
            }

            if (filePreviewInfo) {
                filePreviewInfo.style.display = "none";
            }

            if (imagePreview) {
                imagePreview.style.display = "flex";

                let previewStatus = imagePreview.querySelector(".image-preview-status");
                if (!previewStatus) {
                    previewStatus = document.createElement("span");
                    previewStatus.className = "image-preview-status";
                    imagePreview.appendChild(previewStatus);
                }
                previewStatus.textContent = "";
            }
        };

        reader.onerror = () => {
            removeSelectedImage();

            const previewStatus = imagePreview?.querySelector(".image-preview-status");
            if (previewStatus) {
                previewStatus.textContent = "Could not read the selected image.";
            }
        };

        reader.readAsDataURL(file);
        return;
    }

    selectedFile = file;

    if (previewImage) {
        previewImage.src = "about:blank";
        previewImage.style.display = "none";
    }

    if (filePreviewInfo) {
        filePreviewInfo.style.display = "flex";
    }

    if (filePreviewName) {
        filePreviewName.textContent = file.name;
    }

    if (filePreviewIcon) {
        filePreviewIcon.textContent = getFileIcon(file.name);
    }

    if (imagePreview) {
        imagePreview.style.display = "flex";
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

    const loading = addMessage(
        "Dali AI is reading your attachment and thinking...",
        "ai-message"
    );

    try {
        let options;

        if (imageFile || fileFile) {
            const formData = new FormData();
            formData.append("message", sendText);

            if (currentChatId) {
                formData.append("chat_id", currentChatId);
            }

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
                message: sendText
            };

            if (currentChatId) {
                body.chat_id = currentChatId;
            }

            options = {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify(body)
            };
        }

        const data = await apiRequest("/api/chat", options);

        loading.remove();

        currentChatId = data.chat_id || currentChatId;

        addMessage(
            data.reply || data.response || data.message || "No response.",
            "ai-message"
        );

        updateMode(data.mode || "general");
        await loadChats();
    } catch (error) {
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
    getDaliUserId();
    showWelcome();
    updateConnectionStatus();
    loadChats();

    if ("serviceWorker" in navigator) {
        navigator.serviceWorker.register("./sw.js").catch(error => {
            console.warn("Dali AI offline cache unavailable:", error);
        });
    }
})();