# Design Agent

An AI UX/UI design partner that sits beside you while you work. It runs on
**your own computer**, and it's free.

> **Where we are:** you can **talk** to your design partner, it **talks back**,
> it can **see the website open in Chrome** and **your design in Figma**, and it
> **points** at what it's talking about with its own orange arrow, and it can
> **change your Figma design after you say yes**. It also takes **screenshots**
> of websites and puts them into Figma. Finding and moving screenshots comes next. The full plan is in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## The helper window

A small window in the bottom-right corner with a penguin in a snowy ice cave.
**Tap the penguin** to start or stop talking. It dozes when off, listens with a
warm glow, blinks its hard-hat light while thinking and moves its beak when it
talks. The 💬 icon shows the conversation as text; the ⚙ icon opens Settings,
where you can also use **your own picture** instead of the penguin.

It does what you ask straight away ("make the title bigger", "create a login
wireframe", "put it in Figma") and tells you in a few words; say **"undo"** to
put it back. Prefer to be asked first? Settings → **Ask me before changing my
Figma design**.

## Search and open websites

- **"Search for the latest web design trends"**: it searches the internet and
  tells you the answer.
- **"Open the top 10 SEO agencies"**: it searches, picks real company sites and
  opens them as tabs in your Chrome.
- **"Take full screenshots of all the opened pages and put them in Figma"**: it
  goes through each tab (you'll see Chrome switch tabs), takes a full-page
  screenshot of each, and puts them all in your Figma file **side by side**, one
  frame per site. It works in the background (about 5 to 15 seconds per page) and
  tells you when it's done. Say **"all my tabs"** for every tab in the window, or
  name a Figma file that isn't open and they'll appear when you open it.

## Talking to it

**Phone-call voice (on by default).** When you tap the penguin, Design Agent starts a
live voice call with Google's AI (Gemini Live, free with the same key). You hear a
clear, human-sounding voice, it answers in about a second, and you can talk over it
any time: it stops and listens, like a real call. Pick the voice you like in
**Settings → Call voice**. If the call voice isn't available (for example the free
limit is used up), it switches to the standard voice by itself.

Use **headphones** or keep the speaker volume moderate: the helper cancels its own
echo, but headphones are always clearest.

The standard voice (used as a backup, or if you untick **Phone-call voice** in Settings):

1. Tap the **penguin** once. The first time, it asks to use your microphone: click **Allow**.
2. Just talk. When you pause, it answers out loud, like a phone call. If the answer
   takes more than a moment, it says a quick "Mm-hm" or "Okay" so you know it heard you.
3. **Interrupt any time**: just start talking while it speaks and it stops and
   listens. If you pause mid-sentence and carry on before it answers, it joins
   both parts together instead of answering half your sentence.
4. Tap the penguin again to stop listening.

**Fastest answers:** Design Agent asks Gemini first. If Gemini hasn't started
answering within **half a second**, it also asks your next backup AI (Groq is the
fastest), and half a second later the next one; whichever answers first is used.
So add the free **Groq** key (Settings → Backup AIs).

Tips: **headphones** work best, so it doesn't hear its own voice. In **Settings**
you can pick your accent, its voice and its speed. **Show text** shows the
conversation in writing.

## Asking about a website

Open any website in Chrome and say things like **"Review this page"**, **"What
font are they using?"**, **"What's wrong with this section?"** or **"How can I
improve this?"** It looks at the page (text, fonts, sizes, colours, spacing and a
screenshot) and answers.

While it talks, its **orange arrow** moves to the heading, button or gap it's
talking about, in time with its voice. The arrow is separate from your mouse,
never blocks your clicks, and disappears a few seconds after it finishes.

This needs the **Chrome add-on**, installed once (below).

## Find similar designs on the internet

Select a frame in Figma and say **"Find similar designs on the internet and paste
them in Figma"**. It looks at your frame, searches **Dribbble** for designs like it
(in a hidden Chrome tab, so your screen doesn't change), and pastes them **one by
one** next to your frame in rows of three, each named "Inspiration – Dribbble – …".
Say **"find 10"** for more, or **"on Behance"** / **"on Pinterest"** for another site.
They're for inspiration: don't copy other people's work into your final designs.

## Reviews: it marks the problems on your screen

Say **"Review this page"**, **"Any UX corrections?"**, **"Check the content"** or
**"What's wrong with this design?"**. It looks, then draws **numbered, coloured
boxes** right on the website or Figma design, each with a short label:

- **Purple = UX**: usability, flow, clarity, accessibility
- **Blue = UI**: spacing, alignment, fonts, colours, contrast
- **Green = Content**: wording, spelling, labels, tone

Then it talks you through them in order ("Number 1, a UX issue: …"), with its
pointer on each. Say **"fix number 2"** or **"fix all of them"** and it changes your
Figma design straight away. Websites can't be edited, so for a website it tells
you the exact fix (new text, colour or size). Say **"clear the marks"** to remove
them. In Figma the marks are one locked group, "Design Agent review notes", that
you can also delete yourself.

## Designing new screens and wireframes

Say what you want, for example **"Create a wireframe for a mobile login screen"**,
**"Design a pricing section for desktop"** or **"Sketch a dashboard"**.

1. It builds it straight away in Figma as a new frame with auto-layout (so it's
   easy to edit), next to what you're looking at, and says what it made.
2. Ask for changes ("make the button bigger", "add a sign-up link"): done at once.
3. **Undo** removes the whole new frame.

"Wireframe", "sketch" or "low-fi" gives greyscale boxes; "design", "mockup" or
"hi-fi" uses real colours and your file's own font. Mobile is 390 wide unless you
say desktop (1440) or tablet (768). It never changes your existing layers when
creating something new.

## Screenshots

- Say **"Take a screenshot"** for exactly what's on screen, or **"Take a
  full-page screenshot"** for the whole page (it scrolls and stitches; very long
  pages stop at 16,000 px). Its orange pointer and the page's scrollbar are left
  out, and sticky headers appear only once.
- Screenshots are saved on your computer in **design-agent\data\captures**.
- Say **"Put it in my Portfolio file"** (any file name). If that file isn't
  open, Design Agent remembers it and adds the screenshot **the moment you open
  that file** (with the plugin running) and tells you where it is. Figma only
  lets plugins change the file that's open, which is why it waits.
- Say **"Where did you put it?"**: it switches to the right page, selects the
  screenshot, zooms to it and points at it. If it's in another file, it tells
  you which file and page (and can open it when Figma shares the file's link).
- Say **"Where's the screenshot I uploaded earlier?"**: it searches every page
  for images and takes you to it. **"Move it next to the hero section"** moves
  it after your yes.
- Say **"Put it in my Figma file"**. The approval card shows where it goes (to
  the right of your selected or visible frame, unless you say where). After your
  **yes** it's added as a frame named "Screenshot – site – date". Long pages are
  split into stacked parts because Figma images max out at 4,096 px.

## Asking about your Figma design

With a design open in **Figma Desktop** and the **Design Agent plugin** running,
say things like **"Review this frame"**, **"Is this spacing correct?"**, **"Is
this typography good?"** or **"How can I improve this section?"** It reads your
real layers (auto-layout gaps and padding, text styles, colours, components)
and a picture of the frame. Select a layer or frame to focus on it; with nothing
selected it looks at the frames on screen. Its orange arrow appears on the
canvas too.

## Changing your Figma design

It can change text, font size, font, line height, colours, auto-layout spacing
and padding, position, size, corner radius and layer names, and it can
duplicate, group or turn layers into components.

When you ask ("make the title bigger", "make these changes"), **it just does it**,
no questions, and tells you in a few words. Changed your mind? Say **"undo"** (or
press **Ctrl + Z** in Figma).

Prefer to approve each change first? Turn on **Settings → Ask me before changing
my Figma design**. Then an approval card shows what will change, and only your
own "yes" or click can approve it.

It knows whether you mean the website or Figma from what you used last, or say
"on the website" / "in Figma". When it's connected,
the **Chrome** light in the helper window is green.

---

## First-time setup on Windows (about 10 minutes, only once)

You only need **Node.js** (https://nodejs.org, the LTS version). No Git or VS Code needed.

### 1. Get the project onto your computer

You only do this once. After that, Design Agent **updates itself** every time you start it.

1. Open this link in Chrome. A ZIP file downloads:
   https://github.com/itsmanikandan20-debug/Manikandan/archive/refs/heads/claude/gallant-shannon-egv9lb.zip
2. Open your **Downloads** folder, **right-click** the ZIP → **Extract All…** → **Extract**.
3. Open the new folder (and the folder with the same name inside it, if there is one),
   then open **design-agent**.

### 2. Start Design Agent

1. In the **design-agent** folder, double-click **Start Design Agent** (the file may show as `Start Design Agent.bat`).
2. A black window opens. **The first time only**, it installs things for about a minute.
3. The **helper window** opens by itself.

> Keep the black window open while you work. Closing it stops Design Agent.
>
> If Windows shows **"The publisher could not be verified"** or **"Windows
> protected your PC"**, click **Run** (or **More info → Run anyway**). Windows
> shows this for any file downloaded from the internet. Untick **"Always ask
> before opening this file"** so it doesn't ask again.

### 3. Add your free AI key (only once)

1. Go to **https://aistudio.google.com/apikey** and sign in with your Google account.
2. Click **Create API key**, then **Copy**.
3. In the helper window, paste the key into the box and click **Save key**.

You'll see **"Saved. You're ready to chat!"**

### Optional: add free backup AIs (recommended)

Gemini's free plan has a daily limit. Add free keys from other AI services and
Design Agent switches to them **by itself, in this order**, whenever Gemini runs
out, is busy or refuses a request. They're all optional: add as many as you like.

| # | Service | Get a free key | Notes |
|---|---|---|---|
| 1 | **Groq** | https://console.groq.com/keys | Very fast; can see screenshots |
| 2 | **Cerebras** | https://cloud.cerebras.ai (API Keys) | Very fast; reads the page/layer details instead of pictures |
| 3 | **Mistral** | https://console.mistral.ai/api-keys (free "Experiment" plan) | Can see screenshots |
| 4 | **NVIDIA** | https://build.nvidia.com (Get API Key) | Free credits |
| 5 | **OpenRouter** | https://openrouter.ai/keys | Free models, small daily limit |

In the helper window: **Settings → Backup AIs** → paste a key in its row →
**Save**. Each row shows **"Ready ✓"** when it works. The helper briefly says
which backup is answering. A key that stops working is skipped for an hour.

### 4. Try it

Type: **How do I make a call-to-action button stand out?** and press **Enter**.

Then ask **"Why?"** It remembers the conversation.

### 5. Install the Chrome add-on (once, about 2 minutes)

1. In Chrome, type **chrome://extensions** in the address bar and press **Enter**.
2. Turn on **Developer mode** (switch at the top right).
3. Click **Load unpacked** (top left).
4. Go to your **design-agent** folder, click the **extension** folder inside it
   once, then click **Select Folder**.
5. **Design Agent** appears in the list. Done. The **Chrome** light in the helper
   window turns green within a few seconds.

Chrome says the add-on can "read and change all your data on all websites". It
needs that to look at whichever page you ask about. It only reads a page when you
ask a question about it, and it sends it only to Design Agent on your computer
(and from there to Gemini to get the answer).

Don't move or delete the design-agent folder afterwards: Chrome runs the add-on
from there.

### 6. Add the Figma plugin (once, about 2 minutes)

1. Open **Figma Desktop** and open any design file.
2. Click the **Figma menu** (top left) → **Plugins** → **Development** →
   **Import plugin from manifest…**
3. Go to your **design-agent** folder → **figma-plugin** → choose **manifest.json**.

**Starting it:** the first time, run **Plugins → Development → Design Agent**
(or press **Ctrl + /** and type "Design Agent"). Figma shows a short message
**"Design Agent connected"** and the **Figma** light in the helper window turns
green. The plugin has no window, so it doesn't get in your way.

**After that it starts by itself (Windows):** whenever you open a Figma file, or
ask about Figma, Design Agent presses **Ctrl + Alt + P** ("run last plugin") in
Figma for you. If you used a different plugin last, that one would start
instead: then Design Agent asks you to run Design Agent once from the Plugins
menu, and it works automatically again. You can switch this off in
**Settings** in the helper window.

The orange arrow in Figma is a temporary, locked layer called "Design Agent
pointer (temporary)". It removes itself; people in the file may see it briefly.

---

## Every day after that

Double-click **Start Design Agent**. That's all.

Tip: right-click **Start Design Agent** → **Send to** → **Desktop (create shortcut)**,
so you can start it from your Desktop.

## Getting the newest version (after each new step)

Nothing to do. Every time you double-click **Start Design Agent**, it checks for
the newest version and downloads it by itself. You'll see
**"Checking for updates…"** in the black window. Your key and screenshots are
kept.

If a new step is ready while Design Agent is running, close the black window
and double-click **Start Design Agent** again.

---

## If something goes wrong

| What you see | What to do |
|---|---|
| "Node.js is not installed" | Install the **LTS** version from https://nodejs.org, then try again. |
| "That Gemini key doesn't work" | Copy the key again from aistudio.google.com/apikey. In the helper window, open **Settings → Change AI key** and paste it. |
| "The free Gemini per-minute limit was reached" | Design Agent waits and retries by itself (up to 45 seconds). If you still see it, wait a minute. |
| "Today's free Gemini allowance is used up" | The free plan allows a limited number of requests per day, per model. Design Agent already switches between free models. It resets at midnight Pacific time. Add a free Groq backup key (Settings) to keep going. |
| The helper window says **Not running** | The black window was closed. Double-click **Start Design Agent** again. |
| The helper window didn't open | Open Edge or Chrome and go to **http://localhost:3456** |
| The **Chrome** light stays grey | Check the add-on is on in **chrome://extensions**. Then close and reopen Chrome. |
| "The Chrome add-on has an update" | Open **chrome://extensions** and click the reload arrow ↻ on Design Agent. |
| The **Figma** light stays grey | In Figma, run **Plugins → Development → Design Agent**, and keep its small window open. |
| "Couldn't look at the page" | Chrome doesn't let add-ons read its own pages (chrome://…) or the Chrome Web Store. Open a normal website. |

Still stuck? Take a screenshot of the black window and the helper window and send it to me.

---

## Privacy

- Everything runs on your computer. Nothing is hosted online.
- Your key is saved only in the `.env` file in this folder. It is never uploaded to GitHub.
- What you type is sent to Google Gemini to get an answer. On the free plan,
  Google may use it to improve their products, so don't paste anything secret.
