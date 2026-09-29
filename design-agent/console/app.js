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
  let currentRaw = ""; // its text including silent pointer markers like [[w12]]
  let pointedCount = 0; // markers already acted on (when voice is off)
  let pointing = false;
  let clearPointerTimer = null;
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
      if (state === "listening" || state === "off") clearPointerSoon(4000);
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
    onPoint: pointAt,
  });

  // ---------- the orange pointer on the web page ----------
  function pointAt(target) {
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    clearTimeout(clearPointerTimer);
    pointing = true;
    socket.send(JSON.stringify({ type: "point", target }));
  }

  function clearPointerSoon(ms) {
    if (!pointing) return;
    clearTimeout(clearPointerTimer);
    clearPointerTimer = setTimeout(() => {
      pointing = false;
      if (socket && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "point_clear" }));
    }, ms);
  }

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
    // Human-sounding "Natural" voices first in the list.
    const natural = list.filter((v) => /natural/i.test(v.name));
    const others = list.filter((v) => !/natural/i.test(v.name));
    natural.concat(others).forEach((v) => select.add(new Option(`${v.name} (${v.lang})`, v.name)));
    select.value = voice.settings.voice || "";

    const hint = $("voice-hint");
    if (!list.length) hint.textContent = "";
    else if (voice.hasNaturalVoice()) hint.textContent = "Using: " + voice.currentVoiceName();
    else {
      hint.textContent = "For a much more human voice, open Design Agent in Microsoft Edge: it has free \"Natural\" voices. " +
        "Close this window and start Design Agent again; it opens in Edge automatically.";
      if (!hintShown) showProblem(hint.textContent);
      hintShown = true;
    }
  }
  let hintShown = false;
  if (window.speechSynthesis) window.speechSynthesis.onvoiceschanged = fillVoices;
  fillVoices();

  $("set-lang").value = voice.settings.lang;
  if (!$("set-lang").value) $("set-lang").value = "en-US";
  $("set-rate").value = voice.settings.rate;
  $("rate-value").textContent = Number(voice.settings.rate).toFixed(2) + "×";

  $("set-lang").addEventListener("change", (e) => {
    voice.saveSettings({ lang: e.target.value });
    fillVoices();
  });
  $("set-voice").addEventListener("change", (e) => {
    voice.saveSettings({ voice: e.target.value });
    fillVoices();
  });
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

  // ---------- approval card ----------
  let approvalId = null;

  function showApproval(message) {
    approvalId = message.id;
    const card = $("approval");
    card.classList.remove("done");
    $("approval-kind").textContent = "Change needs your OK";
    $("approval-summary").textContent = message.summary;
    const list = $("approval-lines");
    list.innerHTML = "";
    (message.lines || []).forEach((line) => {
      const li = document.createElement("li");
      li.textContent = line;
      list.appendChild(li);
    });
    const problems = message.problems || [];
    $("approval-problems").textContent = problems.length ? "Can't do: " + problems.join("; ") : "";
    $("approval-problems").hidden = !problems.length;
    $("approval-actions").hidden = false;
    $("approve-btn").disabled = false;
    $("approve-btn").textContent = "Apply";
    $("reject-btn").textContent = "Not now";
    $("reject-btn").hidden = false;
    $("approval-state").hidden = true;
    $("approval-hint").hidden = false;
    card.hidden = false;
  }

  function updateApproval(message) {
    if (message.id && message.id !== approvalId && message.state !== "undone") return;
    const card = $("approval");
    const state = $("approval-state");
    const setDone = (text, withUndo) => {
      card.classList.add("done");
      $("approval-kind").textContent = withUndo ? "Change applied" : "Change";
      state.textContent = text;
      state.hidden = false;
      $("approval-hint").hidden = true;
      $("approval-actions").hidden = !withUndo;
      $("approve-btn").hidden = withUndo;
      $("reject-btn").hidden = !withUndo;
      $("reject-btn").textContent = "Undo";
    };
    if (message.state === "applying") {
      $("approve-btn").disabled = true;
      $("approve-btn").textContent = "Applying…";
    } else if (message.state === "applied") {
      setDone(message.failed ? `Applied, but ${message.failed} part(s) failed` : "Applied ✓", true);
      approvalId = "undo";
    } else if (message.state === "rejected" || message.state === "replaced" || message.state === "expired") {
      card.hidden = true;
      approvalId = null;
    } else if (message.state === "failed") {
      setDone("Couldn't apply it", false);
    } else if (message.state === "undone") {
      setDone("Put back ✓", false);
      approvalId = null;
      setTimeout(() => {
        if (!approvalId) card.hidden = true;
      }, 4000);
    }
  }

  $("approve-btn").addEventListener("click", () => {
    if (approvalId && approvalId !== "undo" && socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: "approve", id: approvalId }));
    }
  });
  $("reject-btn").addEventListener("click", () => {
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    if (approvalId === "undo") socket.send(JSON.stringify({ type: "undo" }));
    else if (approvalId) socket.send(JSON.stringify({ type: "reject", id: approvalId }));
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
    const chromeOn = Boolean(status.connections && status.connections.browser);
    $("st-browser").classList.toggle("on", chromeOn);
    if (status.connections && status.connections.browserNeedsReload) {
      showProblem("The Chrome add-on has an update. In Chrome, open chrome://extensions and click the reload arrow ↻ on Design Agent.");
    }
    $("st-browser").title = chromeOn ? "Chrome add-on connected: ask about the page you're looking at" : "Chrome add-on not connected (see the setup guide)";
    const figmaOn = Boolean(status.connections && status.connections.figma);
    $("st-figma").classList.toggle("on", figmaOn);
    $("st-figma").title = figmaOn ? "Figma plugin connected: ask about your design" : "In Figma: Plugins → Development → Design Agent";
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
        message.messages.forEach((m) => addBubble(m.role, window.stripMarkers(m.text).trim()));
        break;
      case "message":
        addBubble(message.role, message.text);
        break;
      case "agent_start":
        setBusy(true);
        current = addBubble("agent thinking", "");
        currentRaw = "";
        pointedCount = 0;
        clearTimeout(clearPointerTimer);
        voice.beginAnswer();
        if (!voice.isOn()) $("caption").textContent = "Thinking…";
        break;
      case "agent_delta":
        if (!current) current = addBubble("agent", "");
        current.classList.remove("thinking");
        currentRaw += message.text;
        current.textContent = window.stripMarkers(currentRaw).trim();
        scrollDown();
        if (voice.isOn()) voice.speakPiece(message.text);
        else {
          $("caption").textContent = current.textContent;
          // Without voice, move the pointer as soon as each marker arrives.
          const targets = window.markerTargets(currentRaw);
          targets.slice(pointedCount).forEach(pointAt);
          pointedCount = targets.length;
        }
        break;
      case "agent_done":
        if (current && !current.textContent) current.remove();
        current = null;
        setBusy(false);
        if (voice.isOn()) voice.finishAnswer();
        else clearPointerSoon(8000);
        if (waitingToSend) {
          const said = waitingToSend;
          waitingToSend = null;
          voice.stopSpeaking();
          submit(said);
        }
        break;
      case "looking": {
        const phrases = ["Let me take a look.", "Okay, let me look.", "One sec, looking at it.", "Let me see."];
        const phrase = phrases[Math.floor(Math.random() * phrases.length)];
        if (voice.isOn()) voice.say(phrase);
        $("caption").textContent = message.surface === "figma" ? "Looking at your Figma design…" : "Looking at the page…";
        $("caption").dataset.who = "agent";
        break;
      }
      case "open_url":
        window.open(message.url, "_blank", "noopener");
        break;
      case "capturing":
        $("caption").textContent = message.fullPage ? "Taking a full-page screenshot (scrolling the page)…" : "Taking a screenshot…";
        $("caption").dataset.who = "agent";
        break;
      case "captured":
        $("shot-img").src = message.thumb;
        $("shot-name").textContent = message.name;
        $("shot").hidden = false;
        break;
      case "approval":
        showApproval(message);
        break;
      case "approval_update":
        updateApproval(message);
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
