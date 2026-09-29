# Design Agent

An AI UX/UI design partner that sits beside you while you work. It runs on
**your own computer**, and it's free.

> **Where we are: Step 1 of 8.** You can **type** to your design partner and it
> answers. Seeing Chrome (Step 2), voice (Step 3), the orange pointer (Step 4)
> and Figma (Steps 5–8) come next. The full plan is in
> [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

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
| "That Gemini key doesn't work" | Copy the key again from aistudio.google.com/apikey. Click **Key** at the top of the helper window to paste it. |
| "The free Gemini limit was reached" | Wait a minute. The free plan allows a limited number of messages per minute and per day. |
| The helper window says **Not running** | The black window was closed. Double-click **Start Design Agent** again. |
| The helper window didn't open | Open Chrome and go to **http://localhost:3456** |

Still stuck? Take a screenshot of the black window and the helper window and send it to me.

---

## Privacy

- Everything runs on your computer. Nothing is hosted online.
- Your key is saved only in the `.env` file in this folder. It is never uploaded to GitHub.
- What you type is sent to Google Gemini to get an answer. On the free plan,
  Google may use it to improve their products, so don't paste anything secret.
