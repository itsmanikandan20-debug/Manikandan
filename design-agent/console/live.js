// Phone-call voice (Gemini Live): streams your microphone to Design Agent and plays the
// answer's audio as it arrives. Google hears when you start talking and stops by itself,
// so you can interrupt any time. The browser's echo cancellation keeps it from hearing itself.
(function () {
  // Runs in the audio thread: turns the microphone into small 16-bit chunks (40 ms each).
  const WORKLET = `
    class PcmCapture extends AudioWorkletProcessor {
      constructor() { super(); this.chunk = new Int16Array(640); this.filled = 0; }
      process(inputs) {
        const input = inputs[0] && inputs[0][0];
        if (!input) return true;
        for (let i = 0; i < input.length; i++) {
          const s = Math.max(-1, Math.min(1, input[i]));
          this.chunk[this.filled++] = s < 0 ? s * 0x8000 : s * 0x7fff;
          if (this.filled === this.chunk.length) {
            this.port.postMessage(this.chunk.buffer, [this.chunk.buffer]);
            this.chunk = new Int16Array(640);
            this.filled = 0;
          }
        }
        return true;
      }
    }
    registerProcessor("pcm-capture", PcmCapture);`;

  window.createLiveVoice = function ({ send, sendAudio, onState, onCaption, onProblem, onFallback }) {
    let on = false;
    let connecting = false;
    let stream = null;
    let micContext = null;
    let playContext = null;
    let nextTime = 0;
    const playing = new Set();

    const supported = Boolean(navigator.mediaDevices && window.AudioContext && window.AudioWorkletNode);

    function setState(state) {
      onState(state);
    }

    async function start(voiceName) {
      if (on || connecting) return;
      connecting = true;
      setState("thinking");
      onCaption("Connecting the call…", "agent");
      try {
        // Made right after your tap, so the browser allows sound.
        playContext = new AudioContext({ sampleRate: 24000 });
        stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
        });
        micContext = new AudioContext({ sampleRate: 16000 });
        const url = URL.createObjectURL(new Blob([WORKLET], { type: "text/javascript" }));
        await micContext.audioWorklet.addModule(url);
        const source = micContext.createMediaStreamSource(stream);
        const node = new AudioWorkletNode(micContext, "pcm-capture");
        node.port.onmessage = (event) => {
          if (on) sendAudio(event.data);
        };
        const silent = micContext.createGain();
        silent.gain.value = 0;
        source.connect(node);
        node.connect(silent).connect(micContext.destination);
      } catch (error) {
        connecting = false;
        cleanUp();
        setState("off");
        if (error && error.name === "NotAllowedError") {
          onProblem("The microphone is blocked. Click the microphone icon in the address bar and allow it for localhost, then tap me again.");
        } else if (error && error.name === "NotFoundError") {
          onProblem("I can't find a microphone. Plug one in (or check Windows sound settings) and tap me again.");
        } else {
          onFallback("this browser can't do the call voice");
        }
        return;
      }
      send({ type: "live_start", voice: voiceName || "" });
    }

    function stopPlayback() {
      for (const source of playing) {
        try {
          source.stop();
        } catch {
          // already stopped
        }
      }
      playing.clear();
      nextTime = 0;
    }

    function cleanUp() {
      on = false;
      stopPlayback();
      if (stream) stream.getTracks().forEach((t) => t.stop());
      stream = null;
      if (micContext) micContext.close().catch(() => {});
      if (playContext) playContext.close().catch(() => {});
      micContext = null;
      playContext = null;
    }

    function stop() {
      if (!on && !connecting) return;
      connecting = false;
      send({ type: "live_stop" });
      cleanUp();
      setState("off");
    }

    /** Audio of the answer (16-bit, 24 kHz), played in order without gaps. */
    function playAudio(arrayBuffer) {
      if (!on || !playContext) return;
      const pcm = new Int16Array(arrayBuffer);
      if (!pcm.length) return;
      const buffer = playContext.createBuffer(1, pcm.length, 24000);
      const channel = buffer.getChannelData(0);
      for (let i = 0; i < pcm.length; i++) channel[i] = pcm[i] / 0x8000;
      const source = playContext.createBufferSource();
      source.buffer = buffer;
      source.connect(playContext.destination);
      const startAt = Math.max(nextTime, playContext.currentTime + 0.02);
      source.start(startAt);
      nextTime = startAt + buffer.duration;
      playing.add(source);
      setState("speaking");
      source.onended = () => {
        playing.delete(source);
        if (!playing.size && on) setState("listening");
      };
    }

    /** A quiet two-note "on it" sound. */
    function chime() {
      if (!playContext) return;
      const now = playContext.currentTime;
      [660, 880].forEach((freq, i) => {
        const osc = playContext.createOscillator();
        const gain = playContext.createGain();
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0, now + i * 0.12);
        gain.gain.linearRampToValueAtTime(0.06, now + i * 0.12 + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.12 + 0.25);
        osc.connect(gain).connect(playContext.destination);
        osc.start(now + i * 0.12);
        osc.stop(now + i * 0.12 + 0.3);
      });
    }

    /** Messages about the call from Design Agent. Returns true if it was one. */
    function handle(message) {
      switch (message.type) {
        case "live_ready":
          connecting = false;
          on = true;
          setState("listening");
          onCaption("I'm here. Just talk to me.", "agent");
          return true;
        case "live_interrupted":
          stopPlayback(); // you started talking: stop straight away
          if (on) setState("hearing");
          return true;
        case "live_heard":
          if (on && !playing.size) setState("hearing");
          onCaption(message.text, "you");
          return true;
        case "live_said":
          onCaption(message.text, "agent");
          return true;
        case "live_working": {
          // It's doing something (looking, searching, designing): show it, with a soft sound.
          const label = {
            look_at_webpage: "Looking at the page…",
            look_at_figma: "Looking at your Figma design…",
            search_web: "Searching…",
            propose_design: "Designing it…",
            propose_figma_changes: "Changing it…",
            take_screenshot: "Taking a screenshot…",
            open_websites: "Opening the websites…",
          }[message.tool] || "Working on it…";
          onCaption(label, "agent");
          if (on && !playing.size) {
            setState("thinking");
            chime();
          }
          return true;
        }
        case "live_reconnecting":
          stopPlayback();
          onCaption("One sec, reconnecting…", "agent");
          setState("thinking");
          return true;
        case "live_turn_done":
          if (on && !playing.size) setState("listening");
          return true;
        case "live_failed": {
          const wasStarting = connecting;
          cleanUp();
          connecting = false;
          setState("off");
          if (message.fallback || wasStarting) onFallback(message.reason || "");
          else onProblem("The call dropped. Tap me to call again.");
          return true;
        }
        default:
          return false;
      }
    }

    return { supported, start, stop, handle, playAudio, isOn: () => on || connecting };
  };
})();
