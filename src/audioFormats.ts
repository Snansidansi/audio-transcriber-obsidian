export interface RecordingAudioFormat {
    id: string;
    name: string;
    mimeType: string;
    extension: string;
}

interface RecordingAudioFormatCandidate extends RecordingAudioFormat {
    fallbackMimeTypes?: string[];
}

const AUDIO_FORMAT_CANDIDATES: RecordingAudioFormatCandidate[] = [
    {
        id: "webm-opus",
        name: "WebM (Opus)",
        mimeType: "audio/webm;codecs=opus",
        fallbackMimeTypes: ["audio/webm"],
        extension: "webm",
    },
    {
        id: "m4a-aac",
        name: "M4A (AAC)",
        mimeType: "audio/mp4;codecs=mp4a.40.2",
        fallbackMimeTypes: ["audio/mp4"],
        extension: "m4a",
    },
    {
        id: "ogg-opus",
        name: "Ogg (Opus)",
        mimeType: "audio/ogg;codecs=opus",
        fallbackMimeTypes: ["audio/ogg"],
        extension: "ogg",
    },
    {
        id: "mp3",
        name: "MP3",
        mimeType: "audio/mpeg",
        extension: "mp3",
    },
    {
        id: "wav",
        name: "WAV",
        mimeType: "audio/wav",
        fallbackMimeTypes: ["audio/wave", "audio/x-wav"],
        extension: "wav",
    },
    {
        id: "aac",
        name: "AAC",
        mimeType: "audio/aac",
        extension: "aac",
    },
];

export function getSupportedRecordingFormats(): RecordingAudioFormat[] {
    if (typeof MediaRecorder === "undefined") {
        return [];
    }

    return AUDIO_FORMAT_CANDIDATES.flatMap((candidate) => {
        const mimeType = [
            candidate.mimeType,
            ...(candidate.fallbackMimeTypes ?? []),
        ].find((type) => MediaRecorder.isTypeSupported(type));

        return mimeType ? [{ ...candidate, mimeType }] : [];
    });
}

export function resolveRecordingFormat(preference: string): {
    format?: RecordingAudioFormat;
    usedFallback: boolean;
} {
    const supportedFormats = getSupportedRecordingFormats();
    if (preference === "auto") {
        return { format: supportedFormats[0], usedFallback: false };
    }

    const selectedFormat = supportedFormats.find(
        (format) => format.id === preference,
    );
    if (selectedFormat) {
        return { format: selectedFormat, usedFallback: false };
    }

    return { format: supportedFormats[0], usedFallback: true };
}

export function audioExtensionFromMimeType(mimeType: string): string | undefined {
    const mediaType = mimeType.split(";")[0].trim().toLowerCase();

    return AUDIO_FORMAT_CANDIDATES.find((candidate) =>
        [candidate.mimeType, ...(candidate.fallbackMimeTypes ?? [])].some(
            (supportedType) => supportedType.split(";")[0] === mediaType,
        ),
    )?.extension;
}
