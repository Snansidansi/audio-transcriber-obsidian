import GeminiTranscriberPlugin from "main";
import { Notice } from "obsidian";
import { GeminiProvider } from "./providers/geminiProvider";
import { OpenRouterProvider } from "./providers/openRouterProvider";
import { TranscriptionProvider } from "./providers/transcriptionProvider";
import { ResponseHandler } from "./responseHandler";
import type { InsertionTarget } from "./insertionTarget";

type TranscriptionPhase = "processing" | "post-processing";

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
    private provider: TranscriptionProvider;
    private responseHandler: ResponseHandler;
    private nextTranscriptionId = 0;
    private transcriptionPhases = new Map<number, TranscriptionPhase>();

    constructor(plugin: GeminiTranscriberPlugin) {
        this.plugin = plugin;
        this.provider = this.createProvider();
        this.responseHandler = new ResponseHandler(plugin);
    }

    reloadApiKey() {
        this.provider.reloadApiKey();
    }

    reloadProvider() {
        this.provider = this.createProvider();
    }

    getProvider(): TranscriptionProvider {
        return this.provider;
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

    captureInsertionTarget(toClipboard: boolean): InsertionTarget {
        if (toClipboard) {
            return { kind: "clipboard" };
        }

        const activeEditor = this.plugin.app.workspace.activeEditor;
        const file = this.plugin.app.workspace.getActiveFile();
        if (!this.provider.isConfigured() || !activeEditor?.editor || !file) {
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
    ) {
        if (!this.provider.isConfigured()) {
            await this.responseHandler.removeAnchor(target);
            new Notice(
                `Error: No API key configured for ${this.provider.displayName}.`,
                0,
            );
            return;
        }

        const transcriptionId = this.beginTranscription();
        let targetHandled = target.kind !== "editor-anchor";

        try {
            const transcript = await this.provider.transcribe(blob);
            let finalTranscript = transcript;
            let statisticsTranscript = transcript;

            if (this.plugin.settings.enablePostProcessing && transcript.trim()) {
                this.beginPostProcessing(transcriptionId);
                try {
                    finalTranscript = await this.provider.postProcess(transcript);
                    statisticsTranscript = finalTranscript;
                    this.plugin.statistics?.addPostProcessingWords(
                        finalTranscript,
                    );
                } catch (error: unknown) {
                    console.log(error);
                    finalTranscript = this.appendPostProcessingFailure(
                        transcript,
                        error,
                    );
                }
            }

            await this.responseHandler.handleResponse(
                finalTranscript,
                filename,
                target,
                statisticsTranscript,
            );
            targetHandled = true;

            await this.plugin.statistics?.addTranscribedDuration(blob);
            this.plugin.statistics?.incrementTranscribed();
            this.plugin.statistics?.save();
        } catch (error: unknown) {
            if (error instanceof Error) {
                if (error.message.contains("API key not valid")) {
                    new Notice(
                        `Error: Your API key for ${this.provider.displayName} is invalid.`,
                        0,
                    );
                    return;
                } else {
                    console.log(error);
                    new Notice(error.message, 0);
                }
            }
        } finally {
            if (!targetHandled) {
                await this.responseHandler.removeAnchor(target);
            }
            this.endTranscription(transcriptionId);
        }
    }

    private createProvider(): TranscriptionProvider {
        if (this.plugin.settings.provider === "openrouter") {
            return new OpenRouterProvider(this.plugin);
        }

        return new GeminiProvider(this.plugin);
    }

    private appendPostProcessingFailure(
        transcript: string,
        error: unknown,
    ): string {
        const message =
            (error instanceof Error ? error.message : String(error)) ||
            "Unknown post-processing error.";
        const quotedError = message
            .replace(/\r\n?/g, "\n")
            .split("\n")
            .map((line) => `> ${line}`)
            .join("\n");

        return `${transcript}\n\n> [!failure] Failure\n${quotedError}`;
    }
}
