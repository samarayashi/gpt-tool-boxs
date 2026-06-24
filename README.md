# ChatGPT Batch Tools

A small Chrome extension for managing many ChatGPT conversations at once.

## What It Does

- Shows your recent ChatGPT conversations.
- Lets you select one, many, or all loaded conversations.
- Two modes (switch at the top):
  - **Delete** — batch delete the selected conversations.
  - **Move to Project** — batch move the selected conversations into a project
    (an existing one, or a new one you create from the extension).
- Opens a conversation in a background tab when you click its row.
- Lets you filter loaded conversations by title.

## Install

1. Download or clone this repo.
2. Open Chrome and go to `chrome://extensions`.
3. Turn on `Developer mode`.
4. Click `Load unpacked`.
5. Select this project folder.

## Usage

1. Open `https://chatgpt.com` and make sure you are logged in.
2. Click the extension icon.
3. Pick a mode at the top: `Delete` or `Move to Project`.
4. Select the conversations you want to act on.
5. **Delete**: click `Delete Selected`, then confirm.
   **Move to Project**: click `Move to Project`, then pick an existing project
   or create a new one, and confirm.

Use `Load All` if you want to load more conversations first.

## Notes

- Deleting cannot be undone from this extension. Review your selection before confirming.
- Moving is reversible — you can move a conversation back out of a project on chatgpt.com.
- Moved conversations leave the recent list (they now live under their project).

## Privacy

This extension only talks to `chatgpt.com`.

It reads your ChatGPT session token from ChatGPT so it can list, delete, and move
your conversations and list/create projects. The token is only used in memory and is
not saved to storage. The extension does not send your conversations, token, or
account data to any third-party server.
