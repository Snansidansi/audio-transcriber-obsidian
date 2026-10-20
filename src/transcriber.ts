import GeminiTranscriberPlugin from "main";
import { App, Modal, Notice } from "obsidian";
import { GeminiProvider } from "./providers/geminiProvider";
import { OpenRouterProvider } from "./providers/openRouterProvider";
import { TranscriptionProvider } from "./providers/transcriptionProvider";
import { ResponseHandler } from "./responseHandler";
import type { InsertionTarget } from "./insertionTarget";
import type { TranscriptionProfile } from "./settings";

type TranscriptionPhase = "processing" | "post-processing";

class TranscriptionErrorModal extends Modal {
    private message: string;

    constructor(app: App, message: string) {
        super(app);
        this.message = message;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.createEl("h2", { text: "Transcription failed" });
        const details = contentEl.createEl("pre", { text: this.message });
        details.setCssStyles({
            maxHeight: "50vh",
            overflow: "auto",
            whiteSpace: "pre-wrap",
            overflowWrap: "anywhere",
        });
        const buttons = contentEl.createDiv({ cls: "modal-button-container" });
        buttons
            .createEl("button", { text: "Copy error" })
            .addEventListener("click", async () => {
                try {
                    await navigator.clipboard.writeText(this.message);
                    new Notice("Error copied to clipboard.");
                } catch {
                    new Notice("Could not copy error to clipboard.", 0);
                }
            });
        buttons
            .createEl("button", { text: "OK", cls: "mod-cta" })
            .addEventListener("click", () => this.close());
    }
}

export class Transcriber {
    static validFileFormats = [
        "wav",
        "mp3",
        "aiff",
        "aac",
        "ogg",
        "flac",
        "webm",
        "m4a",
    ] as const;

    private plugin: GeminiTranscriberPlugin;
    private responseHandler: ResponseHandler;
    private nextTranscriptionId = 0;
    private transcriptionPhases = new Map<number, TranscriptionPhase>();

    constructor(plugin: GeminiTranscriberPlugin) {
        this.plugin = plugin;
        this.responseHandler = new ResponseHandler(plugin);
    }

    getTranscriptionCounts() {
        let processing = 0;
        let postProcessing = 0;

        for (const phase of this.transcriptionPhases.values()) {
            if (phase === "processing") {
                processing++;
            } else {
                postProcessing++;
            }
        }

        return { processing, postProcessing };
    }

    private beginTranscription(): number {
        const id = ++this.nextTranscriptionId;
        this.transcriptionPhases.set(id, "processing");
        this.plugin.statusBar?.reloadStatus();
        return id;
    }

    private beginPostProcessing(id: number) {
        if (this.transcriptionPhases.has(id)) {
            this.transcriptionPhases.set(id, "post-processing");
            this.plugin.statusBar?.reloadStatus();
        }
    }

    private endTranscription(id: number) {
        if (this.transcriptionPhases.delete(id)) {
            this.plugin.statusBar?.reloadStatus();
        }
    }

    captureInsertionTarget(
        toClipboard: boolean,
        profile = this.plugin.getProfileSnapshot(),
    ): InsertionTarget {
        if (toClipboard) {
            return { kind: "clipboard" };
        }

        const activeEditor = this.plugin.app.workspace.activeEditor;
        const file = this.plugin.app.workspace.getActiveFile();
        if (
            !this.createProvider(profile).isConfigured() ||
            !activeEditor?.editor ||
            !file
        ) {
            return { kind: "transcript-file" };
        }

        const marker = `<!-- audio-transcriber-anchor:${Date.now().toString(36)}-${Math.random().toString(36).slice(2)} -->`;
        activeEditor.editor.replaceRange(marker, activeEditor.editor.getCursor());

        return { kind: "editor-anchor", file, marker };
    }

    async discardInsertionTarget(target: InsertionTarget | null) {
        if (target) {
            await this.responseHandler.removeAnchor(target);
        }
    }

    async transcribe(
        blob: Blob,
        filename: string | undefined,
        target: InsertionTarget,
        profile = this.plugin.getProfileSnapshot(),
        saveAudioOnFailure?: () => Promise<void>,
    ) {
        const provider = this.createProvider(profile);
        const transcriptionId = this.beginTranscription();
        let targetHandled = target.kind !== "editor-anchor";
        let transcriptionCompleted = false;
        let audioSaved = !saveAudioOnFailure;

        try {
            if (!provider.isConfigured()) {
                throw new Error(
                    `No API key configured for ${provider.displayName}.`,
                );
            }

            const transcript = await provider.transcribe(blob);
            transcriptionCompleted = true;
            let finalTranscript = transcript;
            let statisticsTranscript = transcript;

            if (profile.enablePostProcessing && transcript.trim()) {
                this.beginPostProcessing(transcriptionId);
                try {
                    finalTranscript = await provider.postProcess(transcript);
                    statisticsTranscript = finalTranscript;
                    this.plugin.statistics?.addPostProcessingWords(
                        finalTranscript,
                    );
                } catch (error: unknown) {
                    console.log(error);
                    if (saveAudioOnFailure && !audioSaved) {
                        try {
                            await saveAudioOnFailure();
                            audioSaved = true;
                        } catch (saveError) {
                            console.error(
                                "Could not save audio after post-processing failure",
                                saveError,
                            );
                            new Notice(
                                "Could not save audio after post-processing failure.",
                                0,
                            );
                        }
                    }
                    finalTranscript = this.appendPostProcessingFailure(
                        transcript,
                        error,
                    );
                }
            }

            await this.responseHandler.handleResponse(
                finalTranscript,
                audioSaved ? filename : undefined,
                target,
                statisticsTranscript,
            );
            targetHandled = true;

            await this.plugin.statistics?.addTranscribedDuration(blob);
            this.plugin.statistics?.incrementTranscribed();
            this.plugin.statistics?.save();
        } catch (error: unknown) {
            if (!transcriptionCompleted) {
                try {
                    if (saveAudioOnFailure) {
                        await saveAudioOnFailure();
                        audioSaved = true;
                    }
                    await this.responseHandler.handleTranscriptionFailure(
                        audioSaved ? filename : undefined,
                        target,
                    );
                    if (target.kind === "editor-anchor") {
                        targetHandled = true;
                    }
                } catch (handlingError) {
                    console.error(
                        "Could not embed audio after transcription failure",
                        handlingError,
                    );
                }
            }

            const message =
                error instanceof Error ? error.message : String(error);
            if (message.contains("API key not valid")) {
                new TranscriptionErrorModal(
                    this.plugin.app,
                    `Your API key for ${provider.displayName} is invalid.`,
                ).open();
                return;
            }

            console.error(error);
            new TranscriptionErrorModal(
                this.plugin.app,
                message || `Unknown error from ${provider.displayName}.`,
            ).open();
        } finally {
            if (!targetHandled) {
                await this.responseHandler.removeAnchor(target);
            }
            this.endTranscription(transcriptionId);
        }
    }

    private createProvider(profile: TranscriptionProfile): TranscriptionProvider {
        if (profile.provider === "openrouter") {
            return new OpenRouterProvider(this.plugin, profile);
        }

        return new GeminiProvider(this.plugin, profile);
    }

    private appendPostProcessingFailure(
        transcript: string,
        error: unknown,
    ): string {
        const message =
            (error instanceof Error ? error.message : String(error)) ||
            "Unknown post-processing error.";
        const quotedTranscript = transcript
            .replace(/\r\n?/g, "\n")
            .split("\n")
            .map((line) => `> ${line}`)
            .join("\n");
        const quotedError = message
            .replace(/\r\n?/g, "\n")
            .split("\n")
            .map((line) => `> ${line}`)
            .join("\n");

        return `> [!note]- Raw Transcription\n${quotedTranscript}\n\n> [!failure] Post-processing failed\n${quotedError}`;
    }
}
