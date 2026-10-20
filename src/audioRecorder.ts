import GeminiTranscriberPlugin from "main";
import { normalizePath, Notice } from "obsidian";
import {
    audioExtensionFromMimeType,
    resolveRecordingFormat,
} from "./audioFormats";
import type { InsertionTarget } from "./insertionTarget";
import type { TranscriptionProfile } from "./settings";

export class AudioRecorder {
    private plugin: GeminiTranscriberPlugin;
    private chunks: Blob[] = [];
    private mediaRecorder: MediaRecorder | null = null;
    private abort = false;
    private starting = false;
    private insertionTarget: InsertionTarget | null = null;
    private recordingProfile: TranscriptionProfile | null = null;
    private recordingMimeType = "";
    private recordingExtension = "";

    constructor(plugin: GeminiTranscriberPlugin) {
        this.plugin = plugin;
    }

    getState(): RecordingState | undefined {
        if (this.mediaRecorder) {
            return this.mediaRecorder.state;
        }
    }

    isStarting(): boolean {
        return this.starting;
    }

    async startRecording(profile = this.plugin.getActiveProfile()) {
        if (this.abort || this.starting || this.mediaRecorder) {
            return;
        }

        this.starting = true;
        const profileSnapshot = this.plugin.getProfileSnapshot(profile);
        this.recordingProfile = profileSnapshot;

        let stream: MediaStream;
        try {
            stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        } catch (error) {
            const message = `Could not access the microphone: ${error}`;
            console.error(message);
            new Notice(message, 0);
            this.starting = false;
            this.recordingProfile = null;
            return;
        }

        const { format, usedFallback } = resolveRecordingFormat(
            this.plugin.settings.recordingAudioFormat,
        );
        try {
            this.mediaRecorder = format
                ? new MediaRecorder(stream, { mimeType: format.mimeType })
                : new MediaRecorder(stream);
            this.recordingMimeType =
                this.mediaRecorder.mimeType || format?.mimeType || "";
            this.recordingExtension =
                audioExtensionFromMimeType(this.recordingMimeType) ??
                format?.extension ??
                "";
            if (!this.recordingExtension) {
                throw new Error(
                    `The browser reported an unsupported recording format: ${this.recordingMimeType || "unknown"}.`,
                );
            }
        } catch (error) {
            stream.getTracks().forEach((track) => track.stop());
            const message = `Could not start audio recording: ${error}`;
            console.error(message);
            new Notice(message, 0);
            this.mediaRecorder = null;
            this.recordingMimeType = "";
            this.recordingExtension = "";
            this.starting = false;
            this.recordingProfile = null;
            return;
        }

        if (usedFallback) {
            new Notice(
                "The selected recording format is unavailable. Using an available format instead.",
            );
        }

        this.starting = false;
        this.mediaRecorder.ondataavailable = (e) => {
            this.chunks.push(e.data);
        };

        this.mediaRecorder.onstop = async () => {
            this.stop();
        };

        this.chunks = [];
        this.mediaRecorder.start();
        this.insertionTarget = this.plugin.transcriber.captureInsertionTarget(
            this.plugin.settings.saveToClipBoard,
            profileSnapshot,
        );
        this.plugin.statusBar?.setStatus("recording");
    }

    pauseRecording() {
        if (!this.mediaRecorder) {
            return;
        }

        this.mediaRecorder.pause();
        this.plugin.statusBar?.setStatus("pause");
    }

    resumeRecording() {
        if (!this.mediaRecorder) {
            return;
        }

        this.mediaRecorder.resume();
        this.plugin.statusBar?.setStatus("recording");
    }

    stopRecording() {
        if (!this.mediaRecorder) {
            return;
        }

        this.plugin.statusBar?.setStatus("ready");
        this.mediaRecorder.stop();
    }

    abortRecording() {
        if (!this.mediaRecorder) {
            return;
        }

        this.abort = true;
        void this.plugin.transcriber.discardInsertionTarget(this.insertionTarget);
        this.insertionTarget = null;
        this.recordingProfile = null;
        this.mediaRecorder.stop();
    }

    private async stop() {
        if (!this.mediaRecorder) {
            return;
        }

        const recorder = this.mediaRecorder;
        const mimeType = recorder.mimeType || this.recordingMimeType;
        const extension = this.recordingExtension;
        recorder.stream.getTracks().forEach((track) => track.stop());
        this.mediaRecorder = null;
        this.recordingMimeType = "";
        this.recordingExtension = "";

        if (this.abort) {
            this.insertionTarget = null;
            this.recordingProfile = null;
            this.plugin.statusBar?.setStatus("ready");
            this.abort = false;
            return;
        }

        const insertionTarget = this.insertionTarget;
        this.insertionTarget = null;
        const profile = this.recordingProfile ?? this.plugin.getProfileSnapshot();
        this.recordingProfile = null;

        let handedOff = false;
        try {
            const blob = new Blob(this.chunks, {
                type: mimeType,
            });

            const [filePath, fileName] =
                await this.getAndCreateSavePath(extension);
            const saveAudio = async () => {
                await this.plugin.app.vault.createBinary(
                    filePath,
                    await blob.arrayBuffer(),
                );
            };
            const saveAudioOnlyOnError =
                this.plugin.settings.saveAudioFile &&
                this.plugin.settings.saveAudioOnlyOnError;

            if (this.plugin.settings.saveAudioFile && !saveAudioOnlyOnError) {
                await saveAudio();
            }

            await this.plugin.statistics?.addAudioFileDuration(blob);
            this.plugin.statistics?.incrementRecorded();
            await this.plugin.statistics?.save();

            this.plugin.transcriber.transcribe(
                blob,
                fileName,
                insertionTarget ?? { kind: "transcript-file" },
                profile,
                saveAudioOnlyOnError ? saveAudio : undefined,
            );
            handedOff = true;
        } catch (error) {
            console.error(error);
            new Notice(error instanceof Error ? error.message : String(error), 0);
        } finally {
            if (!handedOff) {
                await this.plugin.transcriber.discardInsertionTarget(
                    insertionTarget,
                );
            }
        }
    }

    private async getAndCreateSavePath(extension: string): Promise<
        readonly [filePath: string, fileName: string]
    > {
        if (!this.plugin.settings.saveAudioFile) {
            return ["", ""];
        }

        const fileName = `recording-${Date.now()}.${extension}`;

        if (this.plugin.settings.saveByNoteLocation) {
            const activeFile = this.plugin.app.workspace.getActiveFile();
            if (activeFile) {
                const parent = activeFile.parent;
                const filePath = parent ? parent.path : "";
                return [normalizePath(filePath + "/" + fileName), fileName];
            }
        }

        const filePath = this.plugin.settings.audioFileSaveLocation;

        if (!this.plugin.app.vault.getFolderByPath(filePath)) {
            try {
                await this.plugin.app.vault.createFolder(filePath);
            } catch (error) {
                console.log(error);
                new Notice(error, 0);
            }
        }

        return [normalizePath(filePath + "/" + fileName), fileName];
    }
}
