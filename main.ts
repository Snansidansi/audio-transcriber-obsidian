import { addCommands } from "src/commands";
import { Plugin } from "obsidian";
import { AudioRecorder } from "src/audioRecorder";
import {
    GeminiTranscriberSettings,
    GeminiTranscriberSettingsTab,
    DEFAULT_SETTINGS,
    DEFAULT_PROFILE,
    TranscriptionProfile,
} from "src/settings";
import { StatusBar } from "src/statusBar";
import { Transcriber } from "src/transcriber";
import { addContextMenus } from "./src/contextMenus";
import { RecorderControlPanel } from "src/recorderControlPanel";
import { Statistics } from "src/statistics";

export default class GeminiTranscriberPlugin extends Plugin {
    statusBar: StatusBar | undefined;
    audioRecorder: AudioRecorder;
    settings: GeminiTranscriberSettings;
    transcriber: Transcriber;
    statistics: Statistics | undefined;

    async onload() {
        await this.loadSettings();

        this.audioRecorder = new AudioRecorder(this);
        this.transcriber = new Transcriber(this);

        if (this.settings.showInStatusBar) {
            this.statusBar = new StatusBar(this);
        }

        if (this.settings.enableStatistics) {
            this.statistics = new Statistics(this);
            this.statistics.load();
        }

        this.addSettingTab(new GeminiTranscriberSettingsTab(this.app, this));
        this.addRibbonIcons();
        addCommands(this);
        addContextMenus(this);
    }

    onunload() {}

    async loadSettings() {
        const stored = (await this.loadData()) as
            | (Partial<GeminiTranscriberSettings> & Record<string, unknown>)
            | null;
        this.settings = Object.assign(
            {},
            DEFAULT_SETTINGS,
            stored,
        ) as GeminiTranscriberSettings;

        const legacyProfileFields: (keyof TranscriptionProfile)[] = [
            "provider",
            "modelName",
            "openRouterModel",
            "openRouterModelIsStt",
            "openRouterReasoningEffort",
            "openRouterPostProcessingModel",
            "openRouterPostProcessingProviders",
            "openRouterPostProcessingReasoningEffort",
            "openRouterProviders",
            "enablePostProcessing",
            "geminiPostProcessingModel",
            "postProcessingPrompt",
            "language",
            "customPrompt",
            "prompt",
        ];

        if (!stored || !Array.isArray(stored.profiles) || stored.profiles.length === 0) {
            const profile = { ...DEFAULT_PROFILE } as TranscriptionProfile;
            for (const field of legacyProfileFields) {
                if (stored && field in stored) {
                    (profile[field] as unknown) = stored[field];
                }
            }

            this.settings.profiles = [profile];
            this.settings.activeProfileId = profile.id;
        }

        this.settings.profiles = this.settings.profiles.map((profile) => ({
            ...DEFAULT_PROFILE,
            ...profile,
            openRouterProviders: [...(profile.openRouterProviders ?? [])],
            openRouterPostProcessingProviders: [
                ...(profile.openRouterPostProcessingProviders ?? []),
            ],
        }));

        const settingsWithLegacyFields = this.settings as GeminiTranscriberSettings &
            Record<string, unknown>;
        for (const field of legacyProfileFields) {
            delete settingsWithLegacyFields[field];
        }

        if (
            !this.settings.profiles.some(
                (profile) => profile.id === this.settings.activeProfileId,
            )
        ) {
            this.settings.activeProfileId = this.settings.profiles[0].id;
        }
    }

    getActiveProfile(): TranscriptionProfile {
        return (
            this.settings.profiles.find(
                (profile) => profile.id === this.settings.activeProfileId,
            ) ?? this.settings.profiles[0]
        );
    }

    getProfileSnapshot(profile = this.getActiveProfile()): TranscriptionProfile {
        return {
            ...profile,
            openRouterProviders: [...profile.openRouterProviders],
            openRouterPostProcessingProviders: [
                ...profile.openRouterPostProcessingProviders,
            ],
        };
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }

    private addRibbonIcons() {
        this.addRibbonIcon("mic-vocal", "Open recorder controls", () => {
            new RecorderControlPanel(this).open();
        });
    }
}
