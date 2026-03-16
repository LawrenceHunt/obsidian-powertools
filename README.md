# Obsidian Power Tools

AI-powered commands and an agent chat that operate on your vault. Responses and operations stay in your markdown; you can widen context with more files (e.g. skills).

## What it does

- **Selection → response**: Use selected text as a prompt; stream the reply into the same note or into a new note with a backlink.
- **Agent chat**: A chat panel that can create notes, append to notes, move notes, search the vault, and list folders via tool calls. Optionally use the current note as context.
- **Local-first**: No telemetry; your API key and content go only to the provider you configure (OpenAI today). Everything the agent does is reflected in your vault.

## Commands (Command Palette: `Cmd/Ctrl + P`)

| Command                                | Description                                                                                                                    |
|----------------------------------------|--------------------------------------------------------------------------------------------------------------------------------|
| **Use selection as prompt**            | Stream an AI response to the selected text and insert it below the selection in the same note.                                 |
| **Use selection as prompt (new note)** | Create a new note, stream the response there, add a backlink from the source note, and rename the new note to a short summary. |
| **Open agent chat**                    | Open the Power Tools chat view (also available from the ribbon).                                                               |

## Agent chat

The chat view is a harness around an LLM that can call tools against your vault. You can ask it to create notes, append to existing notes, move notes, search, and list folders. Replies are rendered as markdown (including Obsidian wiki-links).

### Tools the agent can use

- **Create note** – Create a new note in a folder with optional content.
- **Append to note** – Append content to an existing note by path.
- **Move note** – Move a note from one path to another.
- **Search vault** – Search note content (optional folder scope, configurable max results).
- **List folders** – List folders under a path (or the vault root).

### Examples

- “Make a note in Projects called Weekly Review.”
- “Summarise this week’s daily notes and save to a suitable adjacent file.” (with “Use current note as context” enabled, the agent can see the current note.)

### Chat UI

- Toggle **Use current note as context** to include the active note’s content in the context window.
- From assistant messages you can **Insert into note** (append to the active note) or **New note from message** (create a note from the message and open it).

## Settings

Go to Settings → Community plugins → Power Tools

- **API key** – Your OpenAI API key ([create one](https://platform.openai.com/api-keys)). Required for all AI features.
- **Model** – Model used for completions and the agent (e.g. `gpt-4o-mini`). The list is loaded from the API when an API key is set.

Only OpenAI is supported today (via the official SDK).

## Installation

1. Copy `main.js`, `manifest.json`, and `styles.css` into your vault’s `.obsidian/plugins/obsidian-powertools/` folder.
2. Enable **Power Tools** under **Settings → Community plugins**.

## Contributing

Issues, ideas and pull requests are welcome.
See the [docs](https://docs.obsidian.md/Plugins/Getting+started/Anatomy+of+a+plugin) and clone this project to get started.
