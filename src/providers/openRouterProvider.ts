import GeminiTranscriberPlugin from "main";
import { requestUrl, RequestUrlResponse } from "obsidian";
import { OPENROUTER_API_BASE } from "../openRouterApi";
import type { TranscriptionProfile } from "../settings";
import {
    createPostProcessingPrompt,
    TranscriptionProvider,
} from "./transcriptionProvider";

const WAV_SAMPLE_RATE = 16000;

// Formats accepted by the OpenRouter STT endpoint (see STTInlineInputAudio).
const STT_AUDIO_FORMATS = [
    "wav",
    "mp3",
    "flac",
    "m4a",
    "ogg",
    "webm",
    "aac",
];

const MIME_FORMAT_ALIASES: Record<string, string> = {
    mpeg: "mp3",
    "x-wav": "wav",
    "x-m4a": "m4a",
    "x-flac": "flac",
    "x-aiff": "aiff",
    "x-pn-aiff": "aiff",
};

// Maps the free-text language setting to ISO-639-1 codes, which are required
// by the "language" parameter of /audio/transcriptions.
const LANGUAGE_TO_ISO: Record<string, string> = {
    arabic: "ar",
    chinese: "zh",
    croatian: "hr",
    czech: "cs",
    danish: "da",
    dutch: "nl",
    english: "en",
    finnish: "fi",
    french: "fr",
    german: "de",
    greek: "el",
    hebrew: "he",
    hindi: "hi",
    hungarian: "hu",
    indonesian: "id",
    italian: "it",
    japanese: "ja",
    korean: "ko",
    malay: "ms",
    norwegian: "no",
    persian: "fa",
    polish: "pl",
    portuguese: "pt",
    romanian: "ro",
    russian: "ru",
    serbian: "sr",
    slovak: "sk",
    slovenian: "sl",
    spanish: "es",
    swedish: "sv",
    tagalog: "tl",
    tamil: "ta",
    thai: "th",
    turkish: "tr",
    ukrainian: "uk",
    vietnamese: "vi",
};

interface ChatCompletionResponse {
    choices?: {
        message?: {
            content?: string | null;
        };
    }[];
}

interface TranscriptionResponse {
    text?: string;
}

interface OpenRouterErrorBody {
    error?: {
        code?: number;
        message?: string;
        metadata?: {
            raw?: string;
        };
    };
}

function languageToIsoCode(language: string): string | undefined {
    const normalized = language.trim().toLowerCase();

    if (/^[a-z]{2}$/.test(normalized)) {
        return normalized;
    }

    return LANGUAGE_TO_ISO[normalized];
}

function audioFormatFromMime(mimeType: string): string | undefined {
    const subtype = mimeType
        .split(";")[0]
        .trim()
        .toLowerCase()
        .replace("audio/", "");

    if (!subtype) {
        return undefined;
    }

    return STT_AUDIO_FORMATS.includes(subtype)
        ? subtype
        : STT_AUDIO_FORMATS.find(
              (format) => MIME_FORMAT_ALIASES[subtype] === format,
          );
}

function blobToArrayBuffer(blob: Blob): Promise<ArrayBuffer> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as ArrayBuffer);
        reader.onerror = () => reject(reader.error);
        reader.readAsArrayBuffer(blob);
    });
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    const chunkSize = 0x8000;
    let binary = "";

    for (let i = 0; i < bytes.length; i += chunkSize) {
        const chunk = bytes.subarray(i, i + chunkSize);
        for (let j = 0; j < chunk.length; j++) {
            binary += String.fromCharCode(chunk[j]);
        }
    }

    return btoa(binary);
}

function encodeWav16BitMono(buffer: AudioBuffer): ArrayBuffer {
    const samples = buffer.getChannelData(0);
    const dataSize = samples.length * 2;
    const wav = new ArrayBuffer(44 + dataSize);
    const view = new DataView(wav);

    const writeString = (offset: number, text: string) => {
        for (let i = 0; i < text.length; i++) {
            view.setUint8(offset + i, text.charCodeAt(i));
        }
    };

    writeString(0, "RIFF");
    view.setUint32(4, 36 + dataSize, true);
    writeString(8, "WAVE");
    writeString(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true); // PCM
    view.setUint16(22, 1, true); // mono
    view.setUint32(24, buffer.sampleRate, true);
    view.setUint32(28, buffer.sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeString(36, "data");
    view.setUint32(40, dataSize, true);

    let offset = 44;
    for (let i = 0; i < samples.length; i++) {
        const clamped = Math.max(-1, Math.min(1, samples[i]));
        view.setInt16(
            offset,
            clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff,
            true,
        );
        offset += 2;
    }

    return wav;
}

/**
 * Decodes the given audio blob and re-encodes it as 16 kHz mono 16-bit WAV,
 * a format that the chat completions endpoint accepts (input_audio.format).
 */
async function convertToWav(blob: Blob): Promise<ArrayBuffer> {
    const raw = await blobToArrayBuffer(blob);

    const decoder = new OfflineAudioContext(1, 1, WAV_SAMPLE_RATE);
    const decoded = await decoder.decodeAudioData(raw);

    const frames = Math.max(1, Math.ceil(decoded.duration * WAV_SAMPLE_RATE));
    const converter = new OfflineAudioContext(1, frames, WAV_SAMPLE_RATE);

    const source = converter.createBufferSource();
    source.buffer = decoded;
    source.connect(converter.destination);
    source.start(0);

    const rendered = await converter.startRendering();

    return encodeWav16BitMono(rendered);
}

function errorFromResponse(response: RequestUrlResponse): Error {
    let error: OpenRouterErrorBody["error"];

    try {
        error = (response.json as OpenRouterErrorBody)?.error;
    } catch {
        error = undefined;
    }

    const details = [
        error?.message,
        error?.code === undefined ? undefined : `code ${error.code}`,
        error?.metadata?.raw,
    ].filter(Boolean);

    return new Error(
        details.length > 0
            ? `OpenRouter request failed (HTTP ${response.status}): ${details.join("\n")}`
            : `OpenRouter request failed (HTTP ${response.status}).`,
    );
}

export class OpenRouterProvider implements TranscriptionProvider {
    readonly displayName = "OpenRouter";

    private plugin: GeminiTranscriberPlugin;
    private profile: TranscriptionProfile;
    private apiKey: string | undefined;

    constructor(plugin: GeminiTranscriberPlugin, profile: TranscriptionProfile) {
        this.plugin = plugin;
        this.profile = profile;
        const apiKey = this.plugin.app.secretStorage.getSecret(
            this.plugin.settings.openRouterApiKeySecretName,
        );

        if (apiKey) {
            this.apiKey = apiKey;
        } else {
            this.apiKey = undefined;
        }
    }

    isConfigured(): boolean {
        return this.apiKey !== undefined;
    }

    async transcribe(blob: Blob): Promise<string> {
        if (!this.profile.openRouterModel) {
            throw new Error(
                "No OpenRouter model selected. Choose one in the settings.",
            );
        }

        if (this.profile.openRouterModelIsStt) {
            return await this.transcribeWithSttModel(blob);
        }

        return await this.transcribeWithChatModel(blob);
    }

    async postProcess(transcript: string): Promise<string> {
        const model = this.profile.openRouterPostProcessingModel.trim();
        if (!model) {
            throw new Error("No OpenRouter post-processing model selected.");
        }

        const prompt = createPostProcessingPrompt(
            this.profile.postProcessingPrompt,
            transcript,
        );
        const request: Record<string, unknown> = {
            model,
            messages: [{ role: "user", content: prompt }],
        };

        if (this.profile.openRouterPostProcessingProviders.length > 0) {
            request.provider = {
                order: this.profile.openRouterPostProcessingProviders,
            };
        }

        const reasoningEffort =
            this.profile.openRouterPostProcessingReasoningEffort;
        if (reasoningEffort) {
            request.reasoning = { effort: reasoningEffort };
        }

        const response = await this.postJson(
            `${OPENROUTER_API_BASE}/chat/completions`,
            request,
        );
        const data = response.json as ChatCompletionResponse;
        const output = data.choices?.[0]?.message?.content ?? "";
        if (!output.trim()) {
            throw new Error("The post-processing model returned no text.");
        }

        return output;
    }

    /**
     * Chat models are called via /chat/completions with the audio as an
     * input_audio content part (base64 wav) plus the prompt as text part.
     * The provider ranking is sent as provider.order.
     */
    private async transcribeWithChatModel(blob: Blob): Promise<string> {
        const wav = await convertToWav(blob);

        const request: Record<string, unknown> = {
            model: this.profile.openRouterModel,
            messages: [
                {
                    role: "user",
                    content: [
                        {
                            type: "input_audio",
                            input_audio: {
                                data: arrayBufferToBase64(wav),
                                format: "wav",
                            },
                        },
                        {
                            type: "text",
                            text: this.profile.prompt,
                        },
                    ],
                },
            ],
        };

        const reasoningEffort =
            this.profile.openRouterReasoningEffort;
        if (reasoningEffort) {
            request.reasoning = { effort: reasoningEffort };
        }

        if (this.profile.openRouterProviders.length > 0) {
            request.provider = {
                order: this.profile.openRouterProviders,
            };
        }

        const response = await this.postJson(
            `${OPENROUTER_API_BASE}/chat/completions`,
            request,
        );

        const data = response.json as ChatCompletionResponse;
        return data.choices?.[0]?.message?.content ?? "";
    }

    /**
     * Dedicated STT models are called via /audio/transcriptions. These models
     * do not accept a prompt; the audio is sent as base64 input_audio and the
     * language as ISO-639-1 parameter when it can be mapped. provider.order
     * is not supported on this endpoint (see docs).
     */
    private async transcribeWithSttModel(blob: Blob): Promise<string> {
        const format = audioFormatFromMime(blob.type);

        let audio: ArrayBuffer;
        let audioFormat: string;

        if (format) {
            audio = await blobToArrayBuffer(blob);
            audioFormat = format;
        } else {
            audio = await convertToWav(blob);
            audioFormat = "wav";
        }

        const request: Record<string, unknown> = {
            model: this.profile.openRouterModel,
            input_audio: {
                data: arrayBufferToBase64(audio),
                format: audioFormat,
            },
        };

        const language = languageToIsoCode(this.profile.language);
        if (language) {
            request.language = language;
        }

        const response = await this.postJson(
            `${OPENROUTER_API_BASE}/audio/transcriptions`,
            request,
        );

        const data = response.json as TranscriptionResponse;
        return data.text ?? "";
    }

    private async postJson(
        url: string,
        body: Record<string, unknown>,
    ): Promise<RequestUrlResponse> {
        const response = await requestUrl({
            url: url,
            method: "POST",
            headers: {
                Authorization: `Bearer ${this.apiKey}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify(body),
            throw: false,
        });

        if (response.status < 200 || response.status >= 300) {
            throw errorFromResponse(response);
        }

        return response;
    }
}
