// Helper window: shows the conversation and sends what you type to the local server.
(function () {
  const $ = (id) => document.getElementById(id);
  const chat = $("chat");
  const empty = $("empty");
  const text = $("text");
  const send = $("send");
  const setup = $("setup");

  let socket = null;
  let current = null; // the agent bubble being streamed
  let busy = false;
  let hasKey = true;

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
    hasKey = status.hasKey;
    setup.hidden = hasKey;
    $("st-ai").classList.toggle("on", hasKey);
    $("st-ai").textContent = hasKey ? "AI ready" : "AI: needs key";
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
        break;
      case "agent_delta":
        if (!current) current = addBubble("agent", "");
        current.classList.remove("thinking");
        current.textContent += message.text;
        scrollDown();
        break;
      case "agent_done":
        if (current && !current.textContent) current.remove();
        current = null;
        setBusy(false);
        break;
      case "error":
        addBubble("error", message.message);
        break;
    }
  }

  // ---------- typing ----------
  function submit(value) {
    const content = value.trim();
    if (!content || busy) return;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      addBubble("error", "Design Agent isn't running. Double-click \"Start Design Agent\" to start it.");
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
  $("new-chat").addEventListener("click", () => {
    if (socket && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "reset" }));
  });

  // ---------- key setup ----------
  $("key-btn").addEventListener("click", () => {
    setup.hidden = !setup.hidden;
    if (!setup.hidden) $("key-input").focus();
  });

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
        msg.textContent = "Saved. You're ready to chat!";
        $("key-input").value = "";
        setTimeout(() => {
          setup.hidden = true;
          text.focus();
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
  text.focus();
})();
