(() => {
    "use strict";

    const $ = (selector) => document.querySelector(selector);

    const API_BASE = "https://shadow-reaper-worker.nthntjrn.workers.dev";
    let sessionToken = localStorage.getItem("shadow_session_token") || "";

    async function apiFetch(path, options = {}) {
        const headers = new Headers(options.headers || {});
        if (sessionToken) headers.set("Authorization", "Bearer " + sessionToken);
        return fetch(API_BASE + path, {
            ...options,
            headers,
            credentials: "omit"
        });
    }

    const sidebar = $("#sidebar");
    const chatForm = $("#chatForm");
    const messageInput = $("#messageInput");
    const messages = $("#messages");
    const welcomeScreen = $("#welcomeScreen");
    const systemStatus = $("#systemStatus");
    const activityStatus = $("#activityStatus");
    const activityCaption = $("#activityCaption");
    const visualizer = $("#voiceVisualizer");
    const sendButton = $("#sendButton");

    let isSending = false;
    let selectedProfile = null;

    async function initializeShadow() {
        try {
            setStatus("CONNECTING", "SETTING UP YOUR SHADOW SESSION");

            const session = await apiFetch("/api/device/session", {
                method: "POST"
            });

            if (!session.ok) throw new Error("Could not create device session.");
            const sessionData = await session.json();
            if (!sessionData.session_token) throw new Error("Worker did not return a session token.");
            sessionToken = sessionData.session_token;
            localStorage.setItem("shadow_session_token", sessionToken);

            const result = await apiFetch("/api/profiles");

            if (!result.ok) throw new Error("Could not load profiles.");

            const profileData = await result.json();
            let profiles = profileData.profiles || [];

            if (profiles.length === 0) {
                const name = window.prompt(
                    "Welcome! Who do I have the pleasure of talking to?"
                );

                if (!name || !name.trim()) {
                    setStatus("SETUP REQUIRED", "REFRESH TO CREATE YOUR PROFILE");
                    return;
                }

                const created = await apiFetch("/api/profiles", {
                    method: "POST",
                    credentials: "same-origin",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        display_name: name.trim(),
                        personality_mode: "regular"
                    })
                });

                if (!created.ok) throw new Error("Could not create your profile.");

                const createdData = await created.json();
                selectedProfile = createdData.profile;
            } else {
                selectedProfile = profiles[0];
            }

            setStatus(
                "ONLINE",
                "WELCOME, " + selectedProfile.display_name.toUpperCase()
            );

            console.log("[Shadow] Profile ready:", selectedProfile.display_name);
        } catch (error) {
            console.error("[Shadow Setup]", error);
            setStatus("SETUP ERROR", "CHECK THE BACKEND TERMINAL");
            addMessage("Shadow setup failed: " + error.message, "system");
        }
    }

    if (!chatForm || !messageInput || !messages) {
        console.error("Shadow Reaper: Required workspace elements are missing.");
        return;
    }

    function setStatus(status, caption) {
        if (systemStatus) systemStatus.textContent = status;
        if (activityStatus) activityStatus.textContent = status;
        if (activityCaption) activityCaption.textContent = caption;
    }

    function addMessage(content, type) {
        const message = document.createElement("div");
        message.className = `message message-${type}`;

        const bubble = document.createElement("div");
        bubble.className = "message-bubble";
        bubble.textContent = content;

        message.appendChild(bubble);
        messages.appendChild(message);
        messages.scrollTop = messages.scrollHeight;

        return message;
    }

    function speakReply(text) {
        if (!text || !text.trim()) return;

        if (!("speechSynthesis" in window)) {
            console.warn("[Shadow Voice] Browser speech synthesis is unavailable.");
            return;
        }

        try {
            window.speechSynthesis.cancel();

            const utterance = new SpeechSynthesisUtterance(text.trim());

            utterance.lang = "en-US";
            utterance.rate = 1.0;
            utterance.pitch = 0.9;
            utterance.volume = 1.0;

            utterance.onstart = () => {
                setStatus("SPEAKING", "SHADOW IS TALKING");
                if (visualizer) visualizer.classList.remove("idle");
            };

            utterance.onend = () => {
                if (!isSending) {
                    setStatus("ONLINE", "SHADOW IS STANDING BY");
                }
                if (visualizer) visualizer.classList.add("idle");
            };

            utterance.onerror = (event) => {
                console.error("[Shadow Voice Error]", event.error);
                if (!isSending) {
                    setStatus("VOICE ERROR", "CHECK YOUR BROWSER AUDIO SETTINGS");
                }
                if (visualizer) visualizer.classList.add("idle");
            };

            window.speechSynthesis.speak(utterance);
            console.log("[Shadow Voice] Browser speech started.");
        } catch (error) {
            console.error("[Shadow Voice Error]", error);
        }
    }

    async function sendMessage(content) {
        const text = content.trim();

        if (!text || isSending) return;
        if (!selectedProfile) {
            addMessage("Shadow is still setting up your profile. Please wait or refresh.", "system");
            return;
        }

        if (!selectedProfile) {
            addMessage("Shadow is still setting up your profile. Please wait or refresh the page.", "system");
            return;
        }

        isSending = true;

        if (welcomeScreen) welcomeScreen.hidden = true;

        addMessage(text, "user");

        messageInput.value = "";
        messageInput.style.height = "auto";

        if (sendButton) sendButton.disabled = true;

        if (visualizer) visualizer.classList.add("idle");

        setStatus("THINKING", "SHADOW IS PROCESSING YOUR MESSAGE");

        try {
            const response = await apiFetch("/api/chat", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                credentials: "same-origin",
                body: JSON.stringify({
                    message: text,
                    profile_id: selectedProfile.id
                })
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.detail || "Shadow Reaper could not respond.");
            }

            addMessage(data.reply, "assistant");
            speakReply(data.reply);

            setStatus("ONLINE", "SHADOW HAS RESPONDED");

        } catch (error) {
            console.error("Shadow Reaper API error:", error);

            addMessage(
                "I couldn't complete that request. " + error.message,
                "system"
            );

            setStatus("CONNECTION ERROR", "CHECK THE BACKEND TERMINAL");

        } finally {
            isSending = false;

            if (sendButton) sendButton.disabled = false;

            messageInput.focus();
        }
    }

    chatForm.addEventListener("submit", (event) => {
        event.preventDefault();
        sendMessage(messageInput.value);
    });

    messageInput.addEventListener("keydown", (event) => {
        if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            chatForm.requestSubmit();
        }
    });

    messageInput.addEventListener("input", () => {
        messageInput.style.height = "auto";
        messageInput.style.height =
            Math.min(messageInput.scrollHeight, 180) + "px";
    });

    $("#newChat")?.addEventListener("click", () => {
        messages.replaceChildren();
        messageInput.value = "";
        messageInput.style.height = "auto";

        if (welcomeScreen) welcomeScreen.hidden = false;

        setStatus("ONLINE", "SHADOW IS STANDING BY");

        sidebar?.classList.remove("open");
        messageInput.focus();
    });

    document.querySelectorAll(".suggestion[data-prompt]").forEach((button) => {
        button.addEventListener("click", () => {
            messageInput.value = button.dataset.prompt || "";
            messageInput.focus();
        });
    });

    $("#openSidebar")?.addEventListener("click", () => {
        sidebar?.classList.add("open");
    });

    $("#closeSidebar")?.addEventListener("click", () => {
        sidebar?.classList.remove("open");
    });

    document.querySelectorAll(".nav-item").forEach((button) => {
        button.addEventListener("click", () => {
            const view = button.dataset.view;

            if (view !== "chat") {
                alert(
                    view === "memory"
                        ? "Shadow Memory management will be connected in a later development step."
                        : "Voice Center will be connected in a later development step."
                );
            }

            document.querySelectorAll(".nav-item").forEach((item) => {
                item.classList.toggle("active", item === button);
            });

            sidebar?.classList.remove("open");
        });
    });

    $("#settingsButton")?.addEventListener("click", async () => {
        if (!selectedProfile) {
            alert("Your profile is still loading.");
            return;
        }

        const choice = window.prompt(
            "Shadow personality mode:\n1 = Regular\n2 = Business\n3 = Family-friendly",
            selectedProfile.personality_mode === "business" ? "2" :
            selectedProfile.personality_mode === "family" ? "3" : "1"
        );

        if (choice === null) return;

        const modes = { "1": "regular", "2": "business", "3": "family" };
        const mode = modes[choice.trim()];

        if (!mode) {
            alert("Please enter 1, 2, or 3.");
            return;
        }

        try {
            const response = await apiFetch("/api/profiles/" + selectedProfile.id, {
                method: "PATCH",
                credentials: "same-origin",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ personality_mode: mode })
            });

            if (!response.ok) throw new Error("Could not update personality mode.");

            selectedProfile.personality_mode = mode;
            alert("Shadow mode changed to " + mode + ".");
        } catch (error) {
            console.error("[Shadow Settings]", error);
            alert(error.message);
        }
    });

    const micButton = $("#micButton");
    const SpeechRecognition =
        window.SpeechRecognition || window.webkitSpeechRecognition;

    let recognition = null;
    let isListening = false;

    if (SpeechRecognition && micButton) {
        recognition = new SpeechRecognition();
        recognition.lang = "en-US";
        recognition.continuous = false;
        recognition.interimResults = false;

        recognition.onstart = () => {
            isListening = true;
            micButton.classList.add("listening");
            setStatus("LISTENING", "SHADOW IS LISTENING");
        };

        recognition.onresult = (event) => {
            const spokenText = event.results[0][0].transcript.trim();

            if (spokenText) {
                messageInput.value = spokenText;
                sendMessage(spokenText);
            }
        };

        recognition.onerror = (event) => {
            console.error("[Shadow Microphone]", event.error);
            setStatus("MICROPHONE ERROR", "CHECK MICROPHONE PERMISSION");
        };

        recognition.onend = () => {
            isListening = false;
            micButton.classList.remove("listening");

            if (!isSending) {
                setStatus("ONLINE", "SHADOW IS STANDING BY");
            }
        };

        micButton.addEventListener("click", () => {
            if (isListening) {
                recognition.stop();
                return;
            }

            try {
                recognition.start();
            } catch (error) {
                console.error("[Shadow Microphone]", error);
            }
        });
    } else if (micButton) {
        micButton.addEventListener("click", () => {
            alert("Voice recognition is not supported by this browser. Try Microsoft Edge or Google Chrome.");
        });
    }

    if (visualizer) visualizer.classList.add("idle");

    setStatus("CONNECTING", "INITIALIZING SHADOW");
    initializeShadow();

    console.log("Shadow Reaper browser workspace connected to API.");
})();
