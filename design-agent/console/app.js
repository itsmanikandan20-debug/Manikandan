// Helper window: voice conversation (with typing as a backup) with the local server.
(function () {
  const $ = (id) => document.getElementById(id);
  const chat = $("chat");
  const empty = $("empty");
  const text = $("text");
  const send = $("send");
  const setup = $("setup");
  const settingsPanel = $("settings");
  const orb = $("orb");

  let socket = null;
  let current = null; // the agent bubble being streamed
  let busy = false;
  let waitingToSend = null; // something you said while it was still answering

  const STATE_LABEL = {
    off: "Tap to start talking",
    listening: "Listening… just talk",
    hearing: "Listening…",
    thinking: "Thinking…",
    speaking: "Speaking… (talk to interrupt)",
  };

  // ---------- voice ----------
  const voice = window.createVoice({
    onUserSaid: (said) => {
      if (busy) waitingToSend = said;
      else submit(said);
    },
    onState: (state) => {
      orb.dataset.state = state;
      orb.setAttribute("aria-label", state === "off" ? "Start talking" : "Stop talking");
      $("voice-state").textContent = STATE_LABEL[state] || "";
      if (state !== "off") showProblem("");
    },
    onCaption: (caption, who) => {
      $("caption").textContent = caption;
      $("caption").dataset.who = who;
    },
    onProblem: showProblem,
  });

  function showProblem(message) {
    $("problem").textContent = message;
    $("problem").hidden = !message;
  }

  orb.addEventListener("click", () => {
    if (voice.isOn()) voice.stop();
    else voice.start();
  });

  if (!voice.supported) {
    showProblem("Voice needs Google Chrome or Microsoft Edge. You can still type below.");
    orb.disabled = true;
  }

  // ---------- show / hide text ----------
  function setTextVisible(visible) {
    document.body.classList.toggle("text-hidden", !visible);
    $("text-toggle").textContent = visible ? "Hide text" : "Show text";
    $("text-toggle").setAttribute("aria-pressed", String(visible));
    try {
      localStorage.setItem("design-agent-text", visible ? "1" : "0");
    } catch {
      // not remembered
    }
  }
  $("text-toggle").addEventListener("click", () => setTextVisible(document.body.classList.contains("text-hidden")));
  try {
    setTextVisible(localStorage.getItem("design-agent-text") === "1");
  } catch {
    setTextVisible(false);
  }

  // ---------- settings ----------
  function fillVoices() {
    const select = $("set-voice");
    const list = voice.supported ? voice.voices() : [];
    select.innerHTML = "";
    const auto = new Option("Automatic (best available)", "");
    select.add(auto);
    list.forEach((v) => select.add(new Option(`${v.name} (${v.lang})`, v.name)));
    select.value = voice.settings.voice || "";
  }
  if (window.speechSynthesis) window.speechSynthesis.onvoiceschanged = fillVoices;
  fillVoices();

  $("set-lang").value = voice.settings.lang;
  if (!$("set-lang").value) $("set-lang").value = "en-US";
  $("set-rate").value = voice.settings.rate;
  $("rate-value").textContent = Number(voice.settings.rate).toFixed(2) + "×";

  $("set-lang").addEventListener("change", (e) => voice.saveSettings({ lang: e.target.value }));
  $("set-voice").addEventListener("change", (e) => voice.saveSettings({ voice: e.target.value }));
  $("set-rate").addEventListener("input", (e) => {
    voice.saveSettings({ rate: Number(e.target.value) });
    $("rate-value").textContent = Number(e.target.value).toFixed(2) + "×";
  });
  $("test-voice").addEventListener("click", () => voice.say("Hi! This is how I sound. Does this voice work for you?"));

  $("settings-btn").addEventListener("click", () => {
    settingsPanel.hidden = !settingsPanel.hidden;
    $("settings-btn").setAttribute("aria-expanded", String(!settingsPanel.hidden));
  });
  $("key-btn").addEventListener("click", () => {
    settingsPanel.hidden = true;
    setup.hidden = false;
    $("key-input").focus();
  });
  $("new-chat").addEventListener("click", () => {
    if (socket && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "reset" }));
    $("caption").textContent = "New conversation started.";
    settingsPanel.hidden = true;
  });

  // ---------- messages ----------
  function scrollDown() {
    chat.scrollTop = chat.scrollHeight;
  }

  function addBubble(kind, content) {
    empty.hidden = true;
    const el = document.createElement("div");
    el.className = "msg " + kind;
    el.textContent = content;
    chat.appendChild(el);
    scrollDown();
    return el;
  }

  function clearChat() {
    chat.querySelectorAll(".msg").forEach((el) => el.remove());
    empty.hidden = false;
  }

  function setBusy(value) {
    busy = value;
    send.disabled = value;
  }

  // ---------- status ----------
  function showStatus(status) {
    setup.hidden = status.hasKey;
    $("st-ai").classList.toggle("on", status.hasKey);
    $("st-ai").textContent = status.hasKey ? "AI ready" : "AI: needs key";
    $("st-ai").title = status.model ? "Model: " + status.model : "";
    $("st-browser").classList.toggle("on", Boolean(status.connections && status.connections.browser));
    $("st-figma").classList.toggle("on", Boolean(status.connections && status.connections.figma));
  }

  // ---------- connection to the local server ----------
  function connect() {
    socket = new WebSocket("ws://" + location.host + "/ws");
    socket.addEventListener("open", () => socket.send(JSON.stringify({ type: "hello", role: "console" })));
    socket.addEventListener("message", (event) => handle(JSON.parse(event.data)));
    socket.addEventListener("close", () => {
      $("st-ai").classList.remove("on");
      $("st-ai").textContent = "Not running";
      $("st-ai").title = "Start Design Agent again (double-click Start Design Agent)";
      setTimeout(connect, 2000);
    });
  }

  function handle(message) {
    switch (message.type) {
      case "status":
        showStatus(message);
        break;
      case "history":
        clearChat();
        message.messages.forEach((m) => addBubble(m.role, m.text));
        break;
      case "message":
        addBubble(message.role, message.text);
        break;
      case "agent_start":
        setBusy(true);
        current = addBubble("agent thinking", "");
        voice.beginAnswer();
        if (!voice.isOn()) $("caption").textContent = "Thinking…";
        break;
      case "agent_delta":
        if (!current) current = addBubble("agent", "");
        current.classList.remove("thinking");
        current.textContent += message.text;
        scrollDown();
        if (voice.isOn()) voice.speakPiece(message.text);
        else $("caption").textContent = current.textContent;
        break;
      case "agent_done":
        if (current && !current.textContent) current.remove();
        current = null;
        setBusy(false);
        if (voice.isOn()) voice.finishAnswer();
        if (waitingToSend) {
          const said = waitingToSend;
          waitingToSend = null;
          voice.stopSpeaking();
          submit(said);
        }
        break;
      case "error":
        addBubble("error", message.message);
        if (voice.isOn()) voice.say(message.message);
        else showProblem(message.message);
        break;
    }
  }

  // ---------- sending ----------
  function submit(value) {
    const content = value.trim();
    if (!content || busy) return;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      showProblem("Design Agent isn't running. Double-click \"Start Design Agent\" to start it.");
      return;
    }
    socket.send(JSON.stringify({ type: "chat", text: content }));
    text.value = "";
    grow();
  }

  function grow() {
    text.style.height = "auto";
    text.style.height = Math.min(text.scrollHeight, 140) + "px";
  }

  $("composer").addEventListener("submit", (event) => {
    event.preventDefault();
    submit(text.value);
  });
  text.addEventListener("input", grow);
  text.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submit(text.value);
    }
  });
  document.querySelectorAll(".suggest").forEach((button) => {
    button.addEventListener("click", () => submit(button.textContent));
  });

  // ---------- key setup ----------
  $("key-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const msg = $("key-msg");
    const save = $("key-save");
    msg.className = "form-msg";
    msg.textContent = "Checking your key…";
    save.disabled = true;
    try {
      const response = await fetch("/api/key", {
        method: "POST",
        headers: { "content-type": "application/json", "x-design-agent": "1" },
        body: JSON.stringify({ key: $("key-input").value }),
      });
      const result = await response.json();
      if (result.ok) {
        msg.className = "form-msg good";
        msg.textContent = "Saved. You're ready to talk!";
        $("key-input").value = "";
        setTimeout(() => {
          setup.hidden = true;
        }, 900);
      } else {
        msg.className = "form-msg bad";
        msg.textContent = result.error;
      }
    } catch {
      msg.className = "form-msg bad";
      msg.textContent = "Design Agent isn't running. Start it again and retry.";
    } finally {
      save.disabled = false;
    }
  });

  connect();
})();
