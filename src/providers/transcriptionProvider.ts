export interface TranscriptionProvider {
    readonly displayName: string;

    isConfigured(): boolean;

    /**
     * Transcribes the given audio blob and returns the transcript as plain text.
     * Implementations must handle their own resource cleanup (e.g. deleting
     * uploaded files) before resolving or rejecting.
     */
    transcribe(blob: Blob): Promise<string>;

    /** Runs the configured text model over a completed transcript. */
    postProcess(transcript: string): Promise<string>;
}

export function createPostProcessingPrompt(
    prompt: string,
    transcript: string,
): string {
    if (!prompt.trim()) {
        throw new Error("Post-processing prompt is required.");
    }

    if (prompt.includes("{{transcript}}")) {
        return prompt.split("{{transcript}}").join(transcript);
    }

    return `${prompt.trim()}\n\nTranscript:\n${transcript}`;
}
