// Voice: listens to you and speaks the answers, using the free voice built into Chrome.
// - Listening: Web Speech API (SpeechRecognition). Chrome sends the audio to Google to turn it into text.
// - Speaking:  speechSynthesis, using a voice installed on this computer.
// Answers are spoken sentence by sentence while they arrive, so it starts talking quickly.
// If you start talking while it speaks (or while it's still thinking), it stops and listens ("barge-in").
// So it never feels silent, a short "Mm-hm" plays if the answer takes more than a moment.
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

  // The AI marks what it's talking about with silent markers like [[w12]] or [[w4-w5]].
  const MARKER = /\[\[([^\]\s]{1,40})\]\]/g;
  window.markerTargets = (text) => [...String(text).matchAll(MARKER)].map((m) => m[1]);
  window.stripMarkers = (text) => String(text).replace(MARKER, "").replace(/ {2,}/g, " ").replace(/\[\[[^\]]*$/, "");

  /** Makes written text sound right when read aloud. */
  function speakable(text) {
    return window.stripMarkers(text)
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")   // [link](url) -> link
      .replace(/https?:\/\/\S+/g, "")             // don't read out web addresses
      .replace(/[*_`#>]+/g, "")                   // markdown symbols
      .replace(/^\s*(?:[-•]|\d+[.)])\s+/gm, "")   // list markers
      .replace(/\s+/g, " ")
      .trim();
  }

  window.createVoice = function ({ onUserSaid, onState, onCaption, onProblem, onPoint = () => {} }) {
    const settings = loadSettings();
    const supported = Boolean(Recognition && window.speechSynthesis);

    let recognition = null;
    let active = false;
    let finalText = "";
    let sendTimer = null;
    let networkErrors = 0;

    let speaking = false;
    let pending = 0;          // sentences queued or playing
    let buffer = "";          // text waiting for the end of its sentence
    let muted = false;        // true after you interrupt, until the next answer
    let spokenWords = new Set();
    let carryTargets = [];    // pointer targets waiting for the next spoken sentence
    let echoUntil = 0;        // ignore our own voice for a moment after speaking
    const utterances = [];    // keep references so Chrome doesn't drop them mid-sentence

    let waiting = false;      // you said something and its answer hasn't started yet
    let heardAnswer = false;  // part of the current answer has been spoken
    let startedAnswer = false; // the first words of this answer were already sent to the voice
    let fillerTimer = null;
    let cutOffUnheard = false; // you kept talking before it answered: join your words together
    const FILLERS = ["Mm-hm.", "Okay.", "Sure.", "Right.", "Got it."];
    const FILLER_AFTER_MS = 700;

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
      if (!text) {
        if (active && !speaking) setState("listening");
        return;
      }
      // If the last thing you said hasn't been answered out loud yet, this continues it.
      const continues = (waiting && !heardAnswer) || cutOffUnheard;
      cutOffUnheard = false;
      waiting = true;
      heardAnswer = false;
      startedAnswer = false;
      setState("thinking");
      // A tiny "Mm-hm" if the answer takes more than a moment, so it feels like a call.
      clearTimeout(fillerTimer);
      fillerTimer = setTimeout(() => {
        if (waiting && !startedAnswer && !speaking) queueSentence(FILLERS[Math.floor(Math.random() * FILLERS.length)], true);
      }, FILLER_AFTER_MS);
      onUserSaid(text, { continues });
    }

    function startRecognition() {
      if (!active) return;
      recognition = new Recognition();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = settings.lang;

      recognition.onresult = (event) => {
        networkErrors = 0; // it's working
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
        } else if (waiting && (words(heard).length >= 2 || (finalText.trim() && !interim))) {
          // You're still talking while it thinks: don't talk over you. Your new words
          // will be sent together with what you said before.
          stopSpeaking();
        }

        setState("hearing");
        onCaption(heard, "you");
        clearTimeout(sendTimer);
        if (finalText.trim() && !interim) sendTimer = setTimeout(flush, 250);
        else if (interim.trim()) {
          // Edge can take seconds to confirm the last words. If nothing new is heard for
          // 0.7 s, take what we have and restart listening (which drops the late copy).
          sendTimer = setTimeout(() => {
            finalText = (finalText + interim).trim();
            try {
              recognition.abort(); // restarts by itself a moment later
            } catch {
              // ignore
            }
            flush();
          }, 700);
        }
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
          networkErrors++;
          if (networkErrors >= 2) {
            stop(); // don't keep retrying and failing
            const edge = /Edg\//.test(navigator.userAgent);
            onProblem(
              edge
                ? "Edge can't listen yet: turn on Windows' online speech recognition. Open Windows Settings → Privacy & security → Speech → turn on \"Online speech recognition\", then tap the circle again. (Or open http://localhost:3456 in Chrome instead.)"
                : "Listening needs the internet (Chrome sends your voice to Google to turn it into text). Check your connection, then tap the circle again.",
            );
          }
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
    function queueSentence(text, filler = false) {
      if (muted && !filler) return; // (the little "Mm-hm" still plays right after you interrupt)
      if (!filler) {
        startedAnswer = true;
        clearTimeout(fillerTimer);
      }
      const targets = carryTargets.concat(window.markerTargets(text));
      carryTargets = [];
      const clean = speakable(text);
      if (!clean) {
        carryTargets = targets; // a marker on its own: point when the next sentence starts
        return;
      }
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
        targets.forEach(onPoint); // move the pointer as this sentence starts
        if (!filler) {
          heardAnswer = true;
          waiting = false;
        }
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
          if (active) setState(waiting ? "thinking" : "listening");
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
      clearTimeout(fillerTimer);
      if (waiting && !heardAnswer) cutOffUnheard = true;
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
      waiting = false;
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
        startedAnswer = false;
        carryTargets = [];
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
        // Start talking as early as possible: the first few words don't wait for the full sentence.
        if (!startedAnswer && buffer.trim()) {
          const comma = buffer.search(/[,;:—](?=\s)/);
          if (comma > 0 && words(buffer.slice(0, comma)).length >= 3) {
            queueSentence(buffer.slice(0, comma + 1));
            buffer = buffer.slice(comma + 1);
          } else if (words(window.stripMarkers(buffer)).length >= 8 && !/\[\[[^\]]*$/.test(buffer)) {
            const cut = buffer.lastIndexOf(" ");
            if (cut > 0) {
              queueSentence(buffer.slice(0, cut));
              buffer = buffer.slice(cut);
            }
          }
        }
      },

      /** Call when the answer is complete, to speak what's left. */
      finishAnswer() {
        if (muted) {
          // An answer you talked over: nothing to say, and your new words are on their way.
          buffer = "";
          carryTargets = [];
          return;
        }
        clearTimeout(fillerTimer);
        waiting = false;
        if (buffer.trim()) queueSentence(buffer);
        buffer = "";
        if (carryTargets.length) carryTargets.forEach(onPoint);
        carryTargets = [];
        if (active && pending === 0 && !speaking) setState("listening");
      },

      /** Speak a short message now (used for errors). */
      say(text) {
        muted = false;
        clearTimeout(fillerTimer);
        queueSentence(text, true);
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
