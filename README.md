# Audio Transcriber Plugin for Obsidian

The Audio Transcriber plugin for Obsidian converts audio files or live recordings into text using either the Gemini API or OpenRouter. Choose the provider in the plugin settings; prompts can be customized for transcription and other audio tasks supported by the selected model.

## Features

- Record audio and transcribe it directly (optionally save the recordings)
- Insert the transcription at the cursor in Edit mode, or create a new file if in Reading mode
- Create a custom prompt for supported providers
- Transcribe audio files from your vault and anywhere from disk
- Embed recordings above the transcription
- Choose Gemini or OpenRouter models
- Create transcription profiles with their own models, prompts, and post-processing settings
- View plugin usage statistics (can be completely disabled in the settings)

## Installation

1. Download the `manifest.json`, `main.js` and `styles.css` from the latest release.
2. Navigate to the `.obsidian/plugins/` directory. Create a new folder for the plugin if it doesn’t already exist, and move the downloaded files into it.
3. Open Obsidian and navigate to the community plugins and activate the plugin under _Community Plugins_.

## Setup

1. Select Gemini or OpenRouter in the plugin settings and enter the corresponding API key. [Generate a Gemini key](https://aistudio.google.com/apikey) or [create an OpenRouter key](https://openrouter.ai/keys).
2. Select a model and enter the language of your audio.
3. Optionally, add hotkeys for available plugin commands, including a dedicated start command for each transcription profile.
4. Press your hotkey for start/stop or use the command from the command palette to use the plugin.

## Compatible file types

- wav
- mp3
- aiff
- aac
- ogg
- flac
- webm
- m4a

## General information about Gemini

### Model

You can change the API model depending on whether you want faster or more accurate responses (e.g. if you have a complex prompt). To change the model, check the list of available models on the official [Google website](https://ai.google.dev/gemini-api/docs/models). For example, valid model names for the plugin are:

- `gemini-2.5-flash`
- `gemini-2.5-flash-lite`

### Limits

You can check the rate limits for your selected Gemini API model on the [Google website](https://ai.google.dev/gemini-api/docs/rate-limits?hl=de). Gemini is free unless you explicitly sign up for a paid plan. For normal transcription usage, the free plan should be more than enough. If you need more daily requests but don’t want to upgrade to a paid plan, consider using a lighter API model like `gemini-2.5-flash-lite` instead of `gemini-2.5-flash`.
