// Voice: listens to you and speaks the answers, using the free voice built into Chrome.
// - Listening: Web Speech API (SpeechRecognition). Chrome sends the audio to Google to turn it into text.
// - Speaking:  speechSynthesis, using a voice installed on this computer.
// Answers are spoken sentence by sentence while they arrive, so it starts talking quickly.
// If you start talking while it speaks, it stops and listens ("barge-in").
(function () {
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  const SETTINGS_KEY = "design-agent-voice";

  function loadSettings() {
    const defaults = { lang: navigator.language && navigator.language.startsWith("en") ? navigator.language : "en-US", voice: "", rate: 1.05 };
    try {
      return Object.assign(defaults, JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}"));
    } catch {
      return defaults;
    }
  }

  function words(text) {
    return (text.toLowerCase().match(/[a-z0-9']+/g) || []);
  }

  /** Makes written text sound right when read aloud. */
  function speakable(text) {
    return text
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")   // [link](url) -> link
      .replace(/https?:\/\/\S+/g, "")             // don't read out web addresses
      .replace(/[*_`#>]+/g, "")                   // markdown symbols
      .replace(/^\s*(?:[-•]|\d+[.)])\s+/gm, "")   // list markers
      .replace(/\s+/g, " ")
      .trim();
  }

  window.createVoice = function ({ onUserSaid, onState, onCaption, onProblem }) {
    const settings = loadSettings();
    const supported = Boolean(Recognition && window.speechSynthesis);

    let recognition = null;
    let active = false;
    let finalText = "";
    let sendTimer = null;

    let speaking = false;
    let pending = 0;          // sentences queued or playing
    let buffer = "";          // text waiting for the end of its sentence
    let muted = false;        // true after you interrupt, until the next answer
    let spokenWords = new Set();
    let echoUntil = 0;        // ignore our own voice for a moment after speaking
    const utterances = [];    // keep references so Chrome doesn't drop them mid-sentence

    function setState(state) {
      onState(state);
    }

    // ---------- choosing a voice ----------
    function voices() {
      return window.speechSynthesis.getVoices().filter((v) => v.lang && v.lang.toLowerCase().startsWith("en"));
    }

    // Most human-sounding first: Edge's "Natural" voices, then Chrome's Google voices,
    // then the older Windows voices (David, Zira, Mark), which sound robotic.
    function pickVoice() {
      const all = voices();
      if (!all.length) return null;
      const natural = (v) => /natural/i.test(v.name);
      const sameLang = (v) => v.lang.toLowerCase() === String(settings.lang).toLowerCase();
      return (
        all.find((v) => v.name === settings.voice) ||
        all.find((v) => natural(v) && sameLang(v)) ||
        all.find((v) => natural(v) && /^(Microsoft (Ava|Andrew|Emma|Brian|Jenny|Aria|Guy))\b/i.test(v.name)) ||
        all.find(natural) ||
        all.find((v) => /google/i.test(v.name) && sameLang(v)) ||
        all.find((v) => /google/i.test(v.name)) ||
        all.find(sameLang) ||
        all[0]
      );
    }

    function hasNaturalVoice() {
      return voices().some((v) => /natural/i.test(v.name));
    }

    // ---------- listening ----------
    function isEcho(heard) {
      const list = words(heard);
      if (!list.length) return true;
      if (!speaking && Date.now() > echoUntil) return false;
      const matches = list.filter((w) => spokenWords.has(w)).length;
      return matches / list.length >= 0.6;
    }

    function flush() {
      const text = finalText.trim();
      finalText = "";
      if (text) onUserSaid(text);
      else if (active && !speaking) setState("listening");
    }

    function startRecognition() {
      if (!active) return;
      recognition = new Recognition();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = settings.lang;

      recognition.onresult = (event) => {
        let interim = "";
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const result = event.results[i];
          if (result.isFinal) finalText += result[0].transcript + " ";
          else interim += result[0].transcript;
        }
        const heard = (finalText + interim).trim();
        if (!heard) return;

        if (speaking || Date.now() < echoUntil) {
          if (isEcho(heard)) {
            finalText = "";
            return; // that was our own voice coming back through the speakers
          }
          const isFinal = Boolean(finalText.trim()) && !interim;
          if (words(heard).length < 2 && !isFinal) return; // wait until a short word is certain
          stopSpeaking(); // you started talking: stop and listen
        }

        setState("hearing");
        onCaption(heard, "you");
        clearTimeout(sendTimer);
        if (finalText.trim() && !interim) sendTimer = setTimeout(flush, 700);
      };

      recognition.onerror = (event) => {
        if (event.error === "no-speech" || event.error === "aborted") return;
        if (event.error === "not-allowed" || event.error === "service-not-allowed") {
          stop();
          onProblem("The microphone is blocked. Click the microphone icon in Chrome's address bar (or Chrome Settings → Privacy → Site settings → Microphone) and allow it for localhost.");
        } else if (event.error === "audio-capture") {
          stop();
          onProblem("I can't find a microphone. Plug one in (or check Windows sound settings) and tap the circle again.");
        } else if (event.error === "network") {
          onProblem("Voice listening needs an internet connection.");
        }
      };

      recognition.onend = () => {
        // Chrome stops listening after a while; start again while voice is on.
        if (active) setTimeout(startRecognition, 250);
      };

      try {
        recognition.start();
      } catch {
        // already started
      }
    }

    // ---------- speaking ----------
    function queueSentence(text) {
      const clean = speakable(text);
      if (!clean || muted) return;
      words(clean).forEach((w) => spokenWords.add(w));

      const utterance = new SpeechSynthesisUtterance(clean);
      const voice = pickVoice();
      try {
        if (voice) {
          utterance.voice = voice;
          utterance.lang = voice.lang;
        }
      } catch {
        // fall back to the default voice
      }
      utterance.rate = Number(settings.rate) || 1;
      utterance.onstart = () => {
        speaking = true;
        setState("speaking");
        onCaption(clean, "agent");
      };
      const done = () => {
        utterances.splice(utterances.indexOf(utterance), 1);
        pending = Math.max(0, pending - 1);
        if (pending === 0) {
          speaking = false;
          echoUntil = Date.now() + 1200;
          if (active) setState("listening");
          else setState("off");
        }
      };
      utterance.onend = done;
      utterance.onerror = done;
      utterances.push(utterance);
      pending++;
      window.speechSynthesis.speak(utterance);
    }

    function stopSpeaking() {
      muted = true;
      buffer = "";
      pending = 0;
      speaking = false;
      utterances.length = 0;
      window.speechSynthesis.cancel();
      echoUntil = Date.now() + 600;
    }

    // Safety net: Chrome sometimes never reports that it finished speaking.
    // If nothing is actually playing, stop waiting for it, so listening never gets stuck.
    setInterval(() => {
      if (!window.speechSynthesis) return;
      if (pending > 0 && !window.speechSynthesis.speaking && !window.speechSynthesis.pending) {
        pending = 0;
        utterances.length = 0;
        speaking = false;
        echoUntil = Date.now() + 800;
        setState(active ? "listening" : "off");
      }
      // Chrome can get stuck "paused" after the window was in the background.
      if (window.speechSynthesis.paused) window.speechSynthesis.resume();
    }, 1000);

    // ---------- start / stop ----------
    function start() {
      if (!supported) {
        onProblem("Voice needs Google Chrome or Microsoft Edge.");
        return;
      }
      active = true;
      window.speechSynthesis.cancel(); // also "unlocks" speaking after this click
      setState("listening");
      startRecognition();
    }

    function stop() {
      active = false;
      clearTimeout(sendTimer);
      finalText = "";
      if (recognition) {
        recognition.onend = null;
        try {
          recognition.abort();
        } catch {
          // ignore
        }
      }
      stopSpeaking();
      muted = false;
      setState("off");
    }

    return {
      supported,
      settings,
      voices,
      hasNaturalVoice,
      currentVoiceName: () => (pickVoice() || {}).name || "",
      isOn: () => active,
      start,
      stop,
      stopSpeaking,

      /** Call when a new answer begins. */
      beginAnswer() {
        muted = false;
        buffer = "";
        spokenWords = new Set();
        if (active) setState("thinking");
      },

      /** Feed answer text as it streams in; whole sentences are spoken right away. */
      speakPiece(text) {
        if (muted) return;
        buffer += text;
        let match;
        while ((match = buffer.match(/[.!?](?=\s)|\n/))) {
          const end = match.index + 1;
          queueSentence(buffer.slice(0, end));
          buffer = buffer.slice(end);
        }
      },

      /** Call when the answer is complete, to speak what's left. */
      finishAnswer() {
        if (buffer.trim()) queueSentence(buffer);
        buffer = "";
        if (active && pending === 0 && !speaking) setState("listening");
      },

      /** Speak a short message now (used for errors). */
      say(text) {
        muted = false;
        queueSentence(text);
      },

      saveSettings(changes) {
        Object.assign(settings, changes);
        try {
          localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
        } catch {
          // settings just won't be remembered
        }
        if (recognition && active && changes.lang) {
          try {
            recognition.stop(); // restarts with the new language
          } catch {
            // ignore
          }
        }
      },
    };
  };
})();
