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
  let lastSaid = ""; // your last spoken request (joined with the next part if you kept talking)

  const STATE_LABEL = {
    off: "Tap me to talk",
    listening: "I'm listening…",
    hearing: "Listening…",
    thinking: "Thinking…",
    speaking: "Speaking… (talk to interrupt)",
  };

  // ---------- voice ----------
  const voice = window.createVoice({
    onUserSaid: (said, { continues } = {}) => {
      // Talking over it (even while it's still thinking) stops the old answer; the helper
      // answers your new words. If it hadn't said anything yet, both parts go together.
      if (continues && lastSaid) said = `${lastSaid} ${said}`;
      lastSaid = said;
      submit(said, true);
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
    $("text-toggle").title = visible ? "Hide the conversation" : "Show the conversation";
    $("text-toggle").setAttribute("aria-pressed", String(visible));
    if (visible) closeSheets("chat");
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

  /** Only one sheet (conversation, settings, key) is open at a time. */
  function closeSheets(except) {
    if (except !== "settings") {
      settingsPanel.hidden = true;
      $("settings-btn").setAttribute("aria-expanded", "false");
    }
    if (except !== "setup") setup.hidden = true;
    if (except !== "chat" && !document.body.classList.contains("text-hidden")) setTextVisible(false);
  }
  $("settings-btn").addEventListener("click", () => {
    const open = settingsPanel.hidden;
    closeSheets(open ? "settings" : "");
    settingsPanel.hidden = !open;
    $("settings-btn").setAttribute("aria-expanded", String(open));
  });
  $("settings-close").addEventListener("click", () => closeSheets(""));
  $("setup-close").addEventListener("click", () => closeSheets(""));
  $("key-btn").addEventListener("click", () => {
    closeSheets("setup");
    setup.hidden = false;
    $("key-input").focus();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeSheets("");
  });

  // ---------- the character's picture ----------
  function showAvatar(has) {
    orb.classList.toggle("custom", Boolean(has));
    $("avatar-img").hidden = !has;
    if (has) $("avatar-img").src = "/avatar?v=" + Date.now();
  }
  async function sendAvatar(body) {
    const msg = $("avatar-msg");
    try {
      const response = await fetch("/api/avatar", {
        method: "POST",
        headers: { "content-type": "application/json", "x-design-agent": "1" },
        body: JSON.stringify(body),
      });
      const result = await response.json();
      msg.className = "form-msg " + (result.ok ? "good" : "bad");
      msg.textContent = result.ok ? (body.remove ? "Back to the penguin." : "Saved.") : result.error;
      if (result.ok) showAvatar(!body.remove);
    } catch {
      msg.className = "form-msg bad";
      msg.textContent = "Design Agent isn't running. Start it again and retry.";
    }
  }
  $("avatar-file").addEventListener("change", (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    if (file.size > 3 * 1024 * 1024) {
      $("avatar-msg").className = "form-msg bad";
      $("avatar-msg").textContent = "That picture is too big (over 3 MB). Try a smaller one.";
      return;
    }
    const reader = new FileReader();
    reader.onload = () => sendAvatar({ image: reader.result });
    reader.readAsDataURL(file);
  });
  $("avatar-reset").addEventListener("click", () => sendAvatar({ remove: true }));

  $("set-ask").addEventListener("change", (e) => {
    if (socket && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "setting", askBeforeChanges: e.target.checked }));
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
  function showSettings(settings) {
    if (!settings) return;
    $("autostart-row").hidden = !settings.autoStartSupported;
    $("set-autostart").checked = settings.autoStartFigma;
    $("set-ask").checked = Boolean(settings.askBeforeChanges);
    if (settings.hasAvatar !== undefined && settings.hasAvatar !== orb.classList.contains("custom")) showAvatar(settings.hasAvatar);
  }
  $("set-autostart").addEventListener("change", (e) => {
    if (socket && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "setting", autoStartFigma: e.target.checked }));
  });

  function showStatus(status) {
    showSettings(status.settings);
    backupStatus = status.backups || {};
    renderBackupStates();
    if (!status.hasKey) setup.hidden = false; // first start: ask for the key
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
      case "notice":
        if (message.quiet) {
          $("caption").textContent = message.message;
          $("caption").dataset.who = "agent";
        } else {
          showProblem(message.message);
          if (voice.isOn()) voice.say(message.message);
        }
        break;
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
  function submit(value, interrupt = false) {
    const content = value.trim();
    if (!content || (busy && !interrupt)) return;
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

  // ---------- backup AI keys ----------
  let backupStatus = {};

  function renderBackupStates() {
    document.querySelectorAll(".backup").forEach((row) => {
      const model = backupStatus[row.dataset.id];
      const state = row.querySelector(".backup-state");
      state.textContent = model ? "Ready ✓" + (model !== "ready" ? ` (${model})` : "") : "No key yet";
      state.classList.toggle("on", Boolean(model));
    });
  }

  async function buildBackups() {
    let list = [];
    try {
      list = await (await fetch("/api/backups")).json();
    } catch {
      return;
    }
    const box = $("backup-list");
    box.innerHTML = "";
    list.forEach((b, i) => {
      const row = document.createElement("form");
      row.className = "backup";
      row.dataset.id = b.id;
      row.innerHTML =
        `<div class="backup-head"><span class="backup-name">${i + 1}. ${b.name}</span><span class="backup-state"></span></div>` +
        `<div class="row"><input type="password" autocomplete="off" spellcheck="false" id="key-${b.id}" aria-label="${b.name} key" placeholder="Paste your ${b.name} key">` +
        `<button type="submit" class="icon-btn">Save</button></div>` +
        `<p class="small">Free key: <a href="${b.keysUrl}" target="_blank" rel="noopener">${b.keysUrl.replace("https://", "")}</a></p>` +
        `<p class="form-msg" role="status"></p>`;
      row.addEventListener("submit", async (event) => {
        event.preventDefault();
        const msg = row.querySelector(".form-msg");
        const input = row.querySelector("input");
        const button = row.querySelector("button");
        msg.className = "form-msg";
        msg.textContent = "Checking the key…";
        button.disabled = true;
        try {
          const response = await fetch("/api/key", {
            method: "POST",
            headers: { "content-type": "application/json", "x-design-agent": "1" },
            body: JSON.stringify({ key: input.value, provider: b.id }),
          });
          const result = await response.json();
          msg.className = "form-msg " + (result.ok ? "good" : "bad");
          msg.textContent = result.ok ? `Saved. ${b.name} is ready (${result.model}).` : result.error;
          if (result.ok) input.value = "";
        } catch {
          msg.className = "form-msg bad";
          msg.textContent = "Design Agent isn't running. Start it again and retry.";
        } finally {
          button.disabled = false;
        }
      });
      box.appendChild(row);
    });
    renderBackupStates();
  }
  buildBackups();

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

  // ---------- gentle snow ----------
  (function snow() {
    const canvas = $("snow");
    const ctx = canvas.getContext && canvas.getContext("2d");
    if (!ctx || (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches)) return;
    let flakes = [];
    function size() {
      canvas.width = innerWidth;
      canvas.height = innerHeight;
      flakes = Array.from({ length: Math.round((innerWidth * innerHeight) / 9000) }, () => ({
        x: Math.random() * innerWidth, y: Math.random() * innerHeight,
        r: Math.random() * 1.8 + 0.6, s: Math.random() * 0.35 + 0.15, d: Math.random() * 6.28,
      }));
    }
    function frame() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = "rgba(235, 244, 255, 0.55)";
      for (const f of flakes) {
        f.y += f.s;
        f.d += 0.01;
        f.x += Math.sin(f.d) * 0.2;
        if (f.y > canvas.height + 4) { f.y = -4; f.x = Math.random() * canvas.width; }
        ctx.beginPath();
        ctx.arc(f.x, f.y, f.r, 0, 6.283);
        ctx.fill();
      }
      requestAnimationFrame(frame);
    }
    size();
    addEventListener("resize", size);
    requestAnimationFrame(frame);
  })();

  connect();
})();
