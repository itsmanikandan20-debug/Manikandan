# Design Agent

An AI UX/UI design partner that sits beside you while you work. It runs on
**your own computer**, and it's free.

> **Where we are:** you can **talk** to your design partner, it **talks back**,
> it can **see the website open in Chrome** and **your design in Figma**, and it
> **points** at what it's talking about with its own orange arrow, and it can
> **change your Figma design after you say yes**. It also takes **screenshots**
> of websites and puts them into Figma. Finding and moving screenshots comes next. The full plan is in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Talking to it

1. Tap the big **orange circle** once. Chrome asks to use your microphone: click **Allow**.
2. Just talk. When you pause, it answers out loud.
3. Talk while it's speaking to interrupt it.
4. Tap the circle again to stop listening.

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

## Changing your Figma design (only after you say yes)

It can change text, font size, font, line height, colours, auto-layout spacing
and padding, position, size, corner radius and layer names, and it can
duplicate, group or turn layers into components. It **never changes anything on
its own**:

1. It suggests a change and asks, e.g. "I can make that gap 24. Want me to?"
2. An **approval card** shows exactly what will change (for example
   "Homepage gap 40 → 24").
3. Say **"yes"** (or click **Apply**) to do it. Say **"no"** (or click **Not
   now**) to leave it. Anything else just continues the conversation.
4. It makes the change, looks at the result and tells you how it turned out.
5. Changed your mind? Say **"undo"** (or click **Undo**), or press **Ctrl + Z** in Figma.

Only your own "yes" or click can approve a change: the AI can't approve its own
suggestions.

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

To start it in a file: **Plugins → Development → Design Agent** (or press
**Ctrl + /** and type "Design Agent"). A small window says **Connected**, and the
**Figma** light in the helper window turns green. Keep that small window open
while you work.

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
| "The free Gemini limit was reached" | Wait a minute. The free plan allows a limited number of messages per minute and per day. |
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
