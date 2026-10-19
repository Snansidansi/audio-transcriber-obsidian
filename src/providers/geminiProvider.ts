import {
    createPartFromUri,
    createUserContent,
    File,
    GoogleGenAI,
} from "@google/genai";
import GeminiTranscriberPlugin from "main";
import { Notice } from "obsidian";
import type { TranscriptionProfile } from "../settings";
import {
    createPostProcessingPrompt,
    TranscriptionProvider,
} from "./transcriptionProvider";

export class GeminiProvider implements TranscriptionProvider {
    readonly displayName = "Gemini";

    private plugin: GeminiTranscriberPlugin;
    private profile: TranscriptionProfile;
    private ai: GoogleGenAI | undefined;

    constructor(plugin: GeminiTranscriberPlugin, profile: TranscriptionProfile) {
        this.plugin = plugin;
        this.profile = profile;
        const apiKey = this.plugin.app.secretStorage.getSecret(
            this.plugin.settings.geminiApiKeySecretName,
        );

        if (apiKey) {
            this.ai = new GoogleGenAI({
                apiKey: apiKey,
            });
        } else {
            this.ai = undefined;
        }
    }

    isConfigured(): boolean {
        return this.ai !== undefined;
    }

    async transcribe(blob: Blob): Promise<string> {
        let uploadedFile: File | undefined = undefined;
        try {
            uploadedFile = await this.uploadAudio(blob, blob.type);
            const response = await this.getResponse(uploadedFile);
            return response.text ?? "";
        } finally {
            if (uploadedFile) {
                try {
                    await this.deleteAudio(uploadedFile);
                } catch (error) {
                    console.log(error);
                    new Notice(error instanceof Error ? error.message : String(error), 0);
                }
            }
        }
    }

    async postProcess(transcript: string): Promise<string> {
        const model = this.profile.geminiPostProcessingModel.trim();
        if (!model) {
            throw new Error("No Gemini post-processing model selected.");
        }

        const prompt = createPostProcessingPrompt(
            this.profile.postProcessingPrompt,
            transcript,
        );
        const response = await this.ai!.models.generateContent({
            model,
            contents: createUserContent([prompt]),
        });
        const output = response.text ?? "";
        if (!output.trim()) {
            throw new Error("The post-processing model returned no text.");
        }

        return output;
    }

    private async getResponse(uploadedFile: File) {
        return await this.ai!.models.generateContent({
            model: this.profile.modelName,
            contents: createUserContent([
                // file was uploaded before so it has a uri and mimeType
                // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                createPartFromUri(uploadedFile.uri!, uploadedFile.mimeType!),
                this.profile.prompt,
            ]),
        });
    }

    private async uploadAudio(file: string | Blob, mimeType: string) {
        const myfile = await this.ai!.files.upload({
            file: file,
            config: { mimeType: mimeType },
        });

        return myfile;
    }

    private async deleteAudio(file: File) {
        // Uploaded files always have a name generated for them
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        await this.ai!.files.delete({ name: file.name! });
    }
}
