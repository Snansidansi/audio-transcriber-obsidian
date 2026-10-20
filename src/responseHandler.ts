import GeminiTranscriberPlugin from "main";
import { MarkdownView, normalizePath, Notice } from "obsidian";
import type { InsertionTarget } from "./insertionTarget";

export class ResponseHandler {
    private plugin: GeminiTranscriberPlugin;

    constructor(plugin: GeminiTranscriberPlugin) {
        this.plugin = plugin;
    }

    async handleResponse(
        transcript: string,
        audioFilename: string | undefined,
        target: InsertionTarget,
        statisticsTranscript = transcript,
    ) {
        if (!transcript) {
            await this.removeAnchor(target);
            return;
        }

        this.plugin.statistics?.addWordsRecieved(statisticsTranscript);
        await this.plugin.statistics?.save();

        if (target.kind === "clipboard") {
            this.saveTranscriptInClipboard(transcript);
            new Notice("Stored transcription in clipboard");
            return;
        }

        if (target.kind === "editor-anchor") {
            const inserted = await this.replaceAnchor(
                target,
                this.getAudioEmbed(audioFilename) + transcript,
            );

            if (inserted) {
                new Notice("Finished transcription");
                return;
            }

            await this.createTranscriptFile(transcript, audioFilename);
            new Notice(
                "Original insertion point was unavailable. Saved transcription as a new file.",
            );
            return;
        }

        await this.createTranscriptFile(transcript, audioFilename);

        new Notice("Finished transcription");
    }

    async handleTranscriptionFailure(
        audioFilename: string | undefined,
        target: InsertionTarget,
    ) {
        if (target.kind === "clipboard") {
            return;
        }

        const audioEmbed = this.getAudioEmbed(audioFilename);
        if (target.kind === "editor-anchor") {
            if (audioEmbed && (await this.replaceAnchor(target, audioEmbed))) {
                return;
            }

            await this.removeAnchor(target);
        }

        if (audioEmbed) {
            await this.createTranscriptFile("", audioFilename);
        }
    }

    private saveTranscriptInClipboard(text: string) {
        navigator.clipboard.writeText(text);
    }

    private async replaceAnchor(
        target: Extract<InsertionTarget, { kind: "editor-anchor" }>,
        replacement: string,
    ): Promise<boolean> {
        let replaced = false;
        let hasOpenView = false;

        for (const leaf of this.plugin.app.workspace.getLeavesOfType("markdown")) {
            const view = leaf.view;
            if (!(view instanceof MarkdownView) || view.file?.path !== target.file.path) {
                continue;
            }

            hasOpenView = true;
            const editor = view.editor;
            const markerIndex = editor.getValue().indexOf(target.marker);
            if (markerIndex >= 0) {
                editor.replaceRange(
                    replacement,
                    editor.offsetToPos(markerIndex),
                    editor.offsetToPos(markerIndex + target.marker.length),
                );
                return true;
            }
        }

        if (hasOpenView) {
            return false;
        }

        try {
            await this.plugin.app.vault.process(target.file, (content) => {
                const markerIndex = content.indexOf(target.marker);
                if (markerIndex < 0) {
                    return content;
                }

                replaced = true;
                return (
                    content.slice(0, markerIndex) +
                    replacement +
                    content.slice(markerIndex + target.marker.length)
                );
            });
        } catch (error) {
            console.error("Could not replace transcription insertion anchor", error);
        }

        return replaced;
    }

    async removeAnchor(target: InsertionTarget) {
        if (target.kind !== "editor-anchor") {
            return;
        }

        await this.replaceAnchor(target, "");
    }

    /**
     * @returns {string} is empty if no audio should be embedded or save audio
     * file is turned off, or the audioFilename is undefined.
     */
    private getAudioEmbed(audioFilename: string | undefined): string {
        if (
            this.plugin.settings.embedAudioFile &&
            this.plugin.settings.saveAudioFile &&
            audioFilename
        ) {
            return `![[${audioFilename}]]\n`;
        }

        return "";
    }

    private async createTranscriptFile(
        text: string,
        audioFilename: string | undefined,
    ) {
        const content = this.getAudioEmbed(audioFilename) + text;
        const filename = `transcript-${Date.now()}.md`;

        let filepath = this.plugin.settings.transcriptSaveLocation;
        if (
            !this.plugin.app.vault.getFolderByPath(filepath) &&
            this.plugin.settings.transcriptSaveLocation !== ""
        ) {
            try {
                await this.plugin.app.vault.createFolder(filepath);
            } catch (error) {
                console.log(error);
                new Notice(error, 0);
            }
        }

        filepath = normalizePath(filepath + "/" + filename);

        const file = await this.plugin.app.vault.create(filepath, content);
        const recentLeaf = this.plugin.app.workspace.getMostRecentLeaf();
        if (recentLeaf && recentLeaf.view.getViewType() === "empty") {
            await recentLeaf.openFile(file);
            return;
        }

        const leaf = this.plugin.app.workspace.getLeaf("tab");
        await leaf.openFile(file);
    }
}
