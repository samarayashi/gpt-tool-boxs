# ChatGPT Batch Delete

A small Chrome extension for deleting many ChatGPT conversations at once.

## What It Does

- Shows your recent ChatGPT conversations.
- Lets you select one, many, or all loaded conversations.
- Deletes selected conversations in a batch.
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
3. Select the conversations you want to delete.
4. Click `Delete Selected`.
5. Confirm the delete action.

Use `Load All` if you want to load more conversations before deleting.

## Privacy

This extension only talks to `chatgpt.com`.

It gets your ChatGPT session token from ChatGPT so it can list and delete your conversations. The token is only used in memory and is not saved to storage.

The extension does not send your conversations, token, or account data to any third-party server.

## Notes

Deleted conversations cannot be restored from this extension. Review your selection before confirming.
