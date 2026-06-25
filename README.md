# ChatGPT Batch Tools

A small Chrome (MV3) extension for managing many ChatGPT conversations at once —
batch delete, batch move into a project, build reusable context from past chats,
and quick inline rename.

> 🇹🇼 **中文使用說明（給非工程背景朋友的詳細下載與操作教學）：[README.zh-TW.md](./README.zh-TW.md)**

## What it does

- **Delete** — batch-delete selected conversations (with a confirm step).
- **Move to Project** — batch-move selected conversations into an existing project
  or a new one you create from the extension.
- **Build Context** — pick conversations, then cherry-pick individual message
  exchanges across them and assemble them into a single block (Markdown / XML /
  Plain), with optional prompt templates (Summarize / Outline / Reorganize). Output via:
  - **Copy** to clipboard, or
  - **Send to New Chat** — opens a background ChatGPT tab and types the assembled
    prompt into the page's own composer (so ChatGPT computes its own
    sentinel/proof-of-work; a direct API `POST /conversation` would 403).
- **Inline rename** — hover a conversation row and click the ✎ to rename in place
  (`PATCH /conversation/{id}` with `{ title }`).
- Filter loaded conversations by title; tag rows already in a project; optionally
  hide in-project conversations; preview a conversation inline or in a popup.

## Install (load unpacked)

```bash
git clone <this-repo-url>
cd gpt-tool-boxs
```

1. Open `chrome://extensions`.
2. Enable **Developer mode** (top-right).
3. Click **Load unpacked** and select the project folder.
4. Pin the extension and open `https://chatgpt.com` (logged in).

To update: `git pull`, then hit **Reload** on the extension card. New permissions
(e.g. `scripting`) may require re-confirming.

## Usage

1. Open `https://chatgpt.com` and make sure you're logged in.
2. Click the extension icon. It loads your recent conversations (use **Load All**
   for the full list).
3. Switch mode at the top: **Delete** / **Move to Project** / **Build Context**.
4. Select conversations (per-row checkbox, or **Select All**).
5. Run the action:
   - **Delete** → `Delete Selected` → confirm.
   - **Move to Project** → `Move to Project` → pick/create a project → confirm.
   - **Build Context** → `Build Context` → expand a conversation, check the
     exchanges you want, choose format/template → **Copy** or **Send to New Chat**.

## Architecture

| File | Responsibility |
|------|----------------|
| `popup.html` / `popup.css` | UI shell and styles |
| `popup.js` | State machine + event wiring (all modes) |
| `popup-view.js` | DOM rendering helpers |
| `chatgpt-api.js` | ChatGPT backend calls (`fetch*`, `patchConversation`, projects) |
| `task-queue.js` | Generic concurrent queue (cancel + progress) for delete/move |
| `inject-prompt.js` | Opens a tab and injects the prompt into ChatGPT's composer |
| `tab-navigation.js` | Open a conversation in a background tab |
| `background.js` | Service worker |

All write actions to a conversation (`delete` / `move` / `rename`) share one
`PATCH /backend-api/conversation/{id}` call; they differ only in the body field.
See `SPEC.md` for the full API spec and reverse-engineering notes.

## Notes

- Deleting is **not** undoable from here — review before confirming.
- Moving is reversible (move back out on chatgpt.com). Moved chats leave the recent list.
- DOM selectors used by **Send to New Chat** may break if ChatGPT redesigns its
  composer; the injector tries several fallbacks.

## Privacy

Talks only to `chatgpt.com`. Reads your session token from ChatGPT to list/delete/
move/rename conversations and list/create projects. The token is kept in memory
only — never written to storage, never sent to any third-party server.
