import GeminiTranscriberPlugin from "main";
import {
    App,
    FuzzySuggestModal,
    normalizePath,
    Notice,
    PluginSettingTab,
    Setting,
    SecretComponent,
} from "obsidian";
import {
    fetchAudioModels,
    fetchModelProviders,
    fetchTextModels,
    OpenRouterModelCache,
    OpenRouterModelInfo,
} from "./openRouterApi";
import { Statistics } from "./statistics";
import { StatusBar } from "./statusBar";
import { renderSettingsTabs } from "./settingsComponents";

export type TranscriptionProviderName = "gemini" | "openrouter";

export interface TranscriptionProfile {
    id: string;
    name: string;
    provider: TranscriptionProviderName;
    modelName: string;
    openRouterModel: string;
    openRouterModelIsStt: boolean;
    openRouterReasoningEffort: string;
    openRouterPostProcessingModel: string;
    openRouterPostProcessingProviders: string[];
    openRouterPostProcessingReasoningEffort: string;
    openRouterProviders: string[];
    enablePostProcessing: boolean;
    geminiPostProcessingModel: string;
    postProcessingPrompt: string;
    language: string;
    customPrompt: boolean;
    prompt: string;
}

export interface GeminiTranscriberSettings {
    profiles: TranscriptionProfile[];
    activeProfileId: string;
    geminiApiKeySecretName: string;
    openRouterApiKeySecretName: string;
    openRouterModelCache: OpenRouterModelCache | undefined;
    openRouterPostProcessingModelCache: OpenRouterModelCache | undefined;
    openRouterProviderCache: Record<string, string[]>;
    saveAudioFile: boolean;
    saveByNoteLocation: boolean;
    audioFileSaveLocation: string;
    transcriptSaveLocation: string;
    embedAudioFile: boolean;
    showInStatusBar: boolean;
    customStatusbarColors: boolean;
    statusbarColorReady: string;
    statusbarColorRecording: string;
    statusbarColorPause: string;
    statusbarColorProcessing: string;
    statusbarColorPostProcessing: string;
    enableStatistics: boolean;
    saveToClipBoard: boolean;
}

export const DEFAULT_PROFILE: TranscriptionProfile = {
    id: "default",
    name: "Standard",
    provider: "gemini",
    modelName: "gemini-2.0-flash",
    openRouterModel: "",
    openRouterModelIsStt: false,
    openRouterReasoningEffort: "",
    openRouterPostProcessingModel: "",
    openRouterPostProcessingProviders: [],
    openRouterPostProcessingReasoningEffort: "",
    openRouterProviders: [],
    enablePostProcessing: false,
    geminiPostProcessingModel: "gemini-2.0-flash",
    postProcessingPrompt: "",
    language: "english",
    customPrompt: false,
    prompt: "Transcribe the audio to markdown, removing filler words, be precise and don't interpret anything. Language: english",
};

export const DEFAULT_SETTINGS: Partial<GeminiTranscriberSettings> = {
    profiles: [{ ...DEFAULT_PROFILE }],
    activeProfileId: DEFAULT_PROFILE.id,
    geminiApiKeySecretName: "",
    openRouterApiKeySecretName: "",
    openRouterModelCache: undefined,
    openRouterPostProcessingModelCache: undefined,
    openRouterProviderCache: {},
    saveAudioFile: true,
    audioFileSaveLocation: "",
    transcriptSaveLocation: "",
    embedAudioFile: false,
    saveByNoteLocation: false,
    showInStatusBar: true,
    customStatusbarColors: false,
    statusbarColorReady: "#008000",
    statusbarColorRecording: "#ff0000",
    statusbarColorPause: "#ffff00",
    statusbarColorProcessing: "#ffa500",
    statusbarColorPostProcessing: "#9b59b6",
    enableStatistics: true,
    saveToClipBoard: false,
};

export class GeminiTranscriberSettingsTab extends PluginSettingTab {
    plugin: GeminiTranscriberPlugin;
    private activeTab:
        | "transcription"
        | "post-processing"
        | "output"
        | "appearance"
        | "api-keys" = "transcription";

    constructor(app: App, plugin: GeminiTranscriberPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    private get profile(): TranscriptionProfile {
        return this.plugin.getActiveProfile();
    }

    private completePrompt(): void {
        if (this.profile.customPrompt) {
            return;
        }

        this.profile.prompt =
            "Transcribe the audio to markdown, removing filler words, be precise and don't interpret anything. Language: " +
            this.profile.language;
    }

    private restoreDefaultStatusBarColors() {
        // All default colors are always set in DEFAULT_SETTINGS
        this.plugin.settings.statusbarColorReady =
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            DEFAULT_SETTINGS.statusbarColorReady!;
        this.plugin.settings.statusbarColorRecording =
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            DEFAULT_SETTINGS.statusbarColorRecording!;
        this.plugin.settings.statusbarColorPause =
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            DEFAULT_SETTINGS.statusbarColorPause!;
        this.plugin.settings.statusbarColorProcessing =
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            DEFAULT_SETTINGS.statusbarColorProcessing!;
        this.plugin.settings.statusbarColorPostProcessing =
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            DEFAULT_SETTINGS.statusbarColorPostProcessing!;
    }

    private isSttSelected(): boolean {
        return (
            this.profile.provider === "openrouter" &&
            this.profile.openRouterModelIsStt
        );
    }

    display(): void {
        const { containerEl } = this;
        const scrollTop = containerEl.scrollTop;

        containerEl.empty();
        containerEl.addClass("audio-transcriber-settings");
        this.renderProfileControls(containerEl);
        this.renderTabs(containerEl);

        const content = containerEl.createDiv({
            cls: "audio-transcriber-settings-content",
        });

        switch (this.activeTab) {
            case "transcription":
                this.renderTranscriptionTab(content);
                break;
            case "post-processing":
                this.renderPostProcessingSettings(content);
                break;
            case "output":
                this.renderOutputTab(content);
                break;
            case "appearance":
                this.renderAppearanceTab(content);
                break;
            case "api-keys":
                this.renderApiKeysTab(content);
                break;
        }

        containerEl.scrollTop = scrollTop;
    }

    private renderProfileControls(containerEl: HTMLElement) {
        new Setting(containerEl)
            .setName("Transcription profile")
            .setDesc("Profile for models, prompts, and post-processing.")
            .addDropdown((dropdown) => {
                for (const profile of this.plugin.settings.profiles) {
                    dropdown.addOption(profile.id, profile.name);
                }
                dropdown
                    .setValue(this.profile.id)
                    .onChange(async (id) => {
                        this.plugin.settings.activeProfileId = id;
                        await this.plugin.saveSettings();
                        this.display();
                    });
            })
            .addButton((button) =>
                button.setButtonText("New").onClick(async () => {
                    const newProfile = {
                        ...DEFAULT_PROFILE,
                        id: this.newProfileId(),
                        openRouterProviders: [],
                        openRouterPostProcessingProviders: [],
                    };
                    newProfile.name = `Profile ${this.plugin.settings.profiles.length + 1}`;
                    this.plugin.settings.profiles.push(newProfile);
                    this.plugin.settings.activeProfileId = newProfile.id;
                    await this.plugin.saveSettings();
                    this.display();
                }),
            )
            .addButton((button) =>
                button.setButtonText("Copy").onClick(async () => {
                    const copied = this.plugin.getProfileSnapshot();
                    copied.id = this.newProfileId();
                    copied.name = `${copied.name} (Copy)`;
                    this.plugin.settings.profiles.push(copied);
                    this.plugin.settings.activeProfileId = copied.id;
                    await this.plugin.saveSettings();
                    this.display();
                }),
            )
            .addButton((button) =>
                button
                    .setButtonText("Delete")
                    .setDisabled(this.plugin.settings.profiles.length <= 1)
                    .onClick(async () => {
                        if (this.plugin.settings.profiles.length <= 1) {
                            return;
                        }
                        this.plugin.settings.profiles =
                            this.plugin.settings.profiles.filter(
                                (profile) => profile.id !== this.profile.id,
                            );
                        this.plugin.settings.activeProfileId =
                            this.plugin.settings.profiles[0].id;
                        await this.plugin.saveSettings();
                        this.display();
                    }),
            );

        new Setting(containerEl)
            .setName("Profile name")
            .addText((text) =>
                text.setValue(this.profile.name).onChange(async (value) => {
                    this.profile.name = value.trim() || "Profile";
                    await this.plugin.saveSettings();
                }),
            );
    }

    private newProfileId(): string {
        return `profile-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    }

    private renderTabs(containerEl: HTMLElement) {
        renderSettingsTabs(
            containerEl,
            [
                { id: "transcription", label: "Transcription" },
                { id: "post-processing", label: "Post-processing" },
                { id: "output", label: "Output & audio" },
                { id: "appearance", label: "Appearance" },
                { id: "api-keys", label: "API keys" },
            ],
            this.activeTab,
            (tab) => {
                this.activeTab = tab;
                this.display();
            },
        );
    }

    private renderTranscriptionTab(containerEl: HTMLElement) {
        new Setting(containerEl)
            .setName("API provider")
            .setDesc("The selected provider is used for this profile.")
            .addDropdown((dropdown) =>
                dropdown
                    .addOption("gemini", "Gemini")
                    .addOption("openrouter", "OpenRouter")
                    .setValue(this.profile.provider)
                    .onChange(async (value) => {
                        this.profile.provider = value as TranscriptionProviderName;
                        await this.plugin.saveSettings();
                        this.display();
                    }),
            );

        if (this.profile.provider === "openrouter") {
            this.renderOpenRouterSettings(containerEl);
        } else {
            this.renderGeminiSettings(containerEl);
        }

        new Setting(containerEl)
            .setName(`Language ${this.profile.customPrompt ? "(disabled)" : ""}`)
            .setDesc("Language of the audio recording.")
            .addText((text) =>
                text
                    .setValue(this.profile.language)
                    .setPlaceholder("english")
                    .setDisabled(this.profile.customPrompt)
                    .onChange(async (value) => {
                        this.profile.language = value;
                        this.completePrompt();
                        await this.plugin.saveSettings();
                    }),
            );

        if (this.isSttSelected()) {
            new Setting(containerEl)
                .setName("Custom prompt")
                .setHeading()
                .setDesc(
                    "STT models do not support a custom prompt. The language is sent as a language parameter.",
                );
        } else {
            this.renderPromptSettings(containerEl);
        }
    }

    private renderOutputTab(containerEl: HTMLElement) {
        new Setting(containerEl)
            .setName("Copy transcripts to clipboard")
            .setDesc("Automatically copy the completed transcript.")
            .addToggle((toggle) =>
                toggle
                    .setValue(this.plugin.settings.saveToClipBoard)
                    .onChange(async (value) => {
                        this.plugin.settings.saveToClipBoard = value;
                        await this.plugin.saveSettings();
                    }),
            );

        new Setting(containerEl)
            .setName("Transcript save location")
            .setDesc("Vault path used when no editor is available for output.")
            .addText((text) =>
                text
                    .setValue(this.plugin.settings.transcriptSaveLocation)
                    .setPlaceholder("notes/transcripts")
                    .onChange(async (value) => {
                        this.plugin.settings.transcriptSaveLocation = value;
                        await this.plugin.saveSettings();
                    }),
            );

        this.renderSaveAudioSettings(containerEl);
    }

    private renderAppearanceTab(containerEl: HTMLElement) {
        new Setting(containerEl)
            .setName("Enable statistics")
            .setDesc("Collect usage statistics and view them with a command.")
            .addToggle((toggle) =>
                toggle
                    .setValue(this.plugin.settings.enableStatistics)
                    .onChange(async (value) => {
                        this.plugin.settings.enableStatistics = value;
                        await this.plugin.saveSettings();
                        if (value) {
                            this.plugin.statistics = new Statistics(this.plugin);
                            this.plugin.statistics.load();
                        } else {
                            this.plugin.statistics = undefined;
                        }
                    }),
            );
        this.renderStatusbarSettings(containerEl);
    }

    private renderApiKeysTab(containerEl: HTMLElement) {
        new Setting(containerEl)
            .setName("Gemini API key")
            .setDesc("Global key shared by all Gemini profiles.")
            .addComponent((el) =>
                new SecretComponent(this.app, el)
                    .setValue(this.plugin.settings.geminiApiKeySecretName)
                    .onChange(async (value) => {
                        this.plugin.settings.geminiApiKeySecretName = value;
                        await this.plugin.saveSettings();
                    }),
            );

        new Setting(containerEl)
            .setName("OpenRouter API key")
            .setDesc("Global key shared by all OpenRouter profiles.")
            .addComponent((el) =>
                new SecretComponent(this.app, el)
                    .setValue(this.plugin.settings.openRouterApiKeySecretName)
                    .onChange(async (value) => {
                        this.plugin.settings.openRouterApiKeySecretName = value;
                        await this.plugin.saveSettings();
                    }),
            );
    }

    private renderGeminiSettings(containerEl: HTMLElement) {
        const modelSetting = new Setting(containerEl)
            .setName("Model name")
            .setDesc(
                "Specify the gemini model that gets used for the transcriptions. The name contains '-' and no spaces.",
            )
            .addText((text) =>
                text
                    .setValue(this.profile.modelName)
                    .onChange(async (value) => {
                        this.profile.modelName = value;
                        await this.plugin.saveSettings();
                    }),
            );

        modelSetting.descEl.createEl("br");
        modelSetting.descEl.createEl("a", {
            href: "https://ai.google.dev/gemini-api/docs/models",
            text: "Available models and rate limits",
        });
    }

    private renderOpenRouterSettings(containerEl: HTMLElement) {
        const cache = this.plugin.settings.openRouterModelCache;
        const selectedModel = this.profile.openRouterModel;
        let desc = "No model selected yet.";
        if (selectedModel) {
            const info = cache?.models.find(
                (model) => model.id === selectedModel,
            );
            desc = `Selected: ${info?.name ?? selectedModel} (${selectedModel}), ${
                info?.isStt ? "STT model" : "chat model"
            }.`;
        }
        if (cache) {
            desc += ` ${cache.models.length} audio-capable models cached, last refresh ${new Date(
                cache.fetchedAt,
            ).toLocaleString()}.`;
            if (!cache.includesReasoningMetadata) {
                desc += " Refresh the model list to check reasoning support.";
            }
        }

        const modelSetting = new Setting(containerEl)
            .setName("Model")
            .setDesc(desc)
            .addButton((button) =>
                button
                    .setButtonText("Select model")
                    .setCta()
                    .onClick(() => {
                        void this.openModelModal();
                    }),
            )
            .addButton((button) =>
                button.setButtonText("Refresh model list").onClick(async () => {
                    await this.refreshModelCache();
                    this.display();
                }),
            );

        modelSetting.descEl.createEl("br");
        modelSetting.descEl.createEl("a", {
            href: "https://openrouter.ai/models",
            text: "Browse models on openrouter.ai",
        });

        if (selectedModel && !this.isSttSelected()) {
            const info = cache?.models.find(
                (model) => model.id === selectedModel,
            );
            this.renderReasoningSetting(
                containerEl,
                info,
                cache?.includesReasoningMetadata === true,
                this.profile.openRouterReasoningEffort,
                async (value) => {
                    this.profile.openRouterReasoningEffort = value;
                    await this.plugin.saveSettings();
                },
            );
        }

        this.renderProviderRanking(containerEl);
    }

    private renderPostProcessingSettings(containerEl: HTMLElement) {
        new Setting(containerEl)
            .setName("Post-processing")
            .setHeading()
            .setDesc(
                "Optionally run a text model after transcription. The post-processing prompt and transcript are sent to the selected provider.",
            )
            .addToggle((toggle) =>
                toggle
                    .setValue(this.profile.enablePostProcessing)
                    .onChange(async (value) => {
                        this.profile.enablePostProcessing = value;
                        await this.plugin.saveSettings();
                        this.display();
                    }),
            );

        if (!this.profile.enablePostProcessing) {
            return;
        }

        if (this.profile.provider === "openrouter") {
            this.renderOpenRouterPostProcessingModel(containerEl);
            const cache =
                this.plugin.settings.openRouterPostProcessingModelCache;
            if (this.profile.openRouterPostProcessingModel) {
                const model = cache?.models.find(
                    (item) =>
                        item.id === this.profile.openRouterPostProcessingModel,
                );
                this.renderReasoningSetting(
                    containerEl,
                    model,
                    cache?.includesReasoningMetadata === true,
                    this.profile.openRouterPostProcessingReasoningEffort,
                    async (value) => {
                        this.profile.openRouterPostProcessingReasoningEffort = value;
                        await this.plugin.saveSettings();
                    },
                );
            }
        } else {
            new Setting(containerEl)
                .setName("Gemini model")
                .setClass("indent-setting")
                .setDesc("Model used to post-process the transcript.")
                .addText((text) =>
                    text
                        .setValue(
                            this.profile.geminiPostProcessingModel,
                        )
                        .setPlaceholder("gemini-2.0-flash")
                        .onChange(async (value) => {
                            this.profile.geminiPostProcessingModel = value;
                            await this.plugin.saveSettings();
                        }),
                );
        }

        const promptSetting = new Setting(containerEl)
            .setName("Post-processing prompt")
            .setClass("indent-setting")
            .setDesc(
                "Instructions for transforming the raw transcript. Use {{transcript}} where the transcript should be inserted.",
            )
            .addTextArea((textArea) =>
                textArea
                    .setValue(this.profile.postProcessingPrompt)
                    .setPlaceholder(
                        "Summarize this transcript:\n\n{{transcript}}",
                    )
                    .onChange(async (value) => {
                        this.profile.postProcessingPrompt = value;
                        await this.plugin.saveSettings();
                    })
                    .inputEl.setCssStyles({
                        width: "-webkit-fill-available",
                        height: "10em",
                    }),
            );

        promptSetting.settingEl.setCssStyles({ alignItems: "initial" });
        promptSetting.infoEl.setCssStyles({ maxWidth: "30%" });

        if (this.profile.provider === "openrouter") {
            this.renderProviderRanking(containerEl, true);
        }
    }

    private renderOpenRouterPostProcessingModel(containerEl: HTMLElement) {
        const cache = this.plugin.settings.openRouterPostProcessingModelCache;
        const selectedModel = this.profile.openRouterPostProcessingModel;
        const info = cache?.models.find((model) => model.id === selectedModel);
        let desc = selectedModel
            ? `Selected: ${info?.name ?? selectedModel} (${selectedModel}).`
            : "No text model selected yet.";

        if (cache) {
            desc += ` ${cache.models.length} text models cached, last refresh ${new Date(
                cache.fetchedAt,
            ).toLocaleString()}.`;
            if (!cache.includesReasoningMetadata) {
                desc += " Refresh the model list to check reasoning support.";
            }
        }

        const modelSetting = new Setting(containerEl)
            .setName("OpenRouter model")
            .setClass("indent-setting")
            .setDesc(
                `${desc} Only text-capable models are listed; STT models are excluded.`,
            )
            .addButton((button) =>
                button
                    .setButtonText("Select model")
                    .setCta()
                    .onClick(() => {
                        void this.openPostProcessingModelModal();
                    }),
            )
            .addButton((button) =>
                button.setButtonText("Refresh model list").onClick(async () => {
                    await this.refreshPostProcessingModelCache();
                    this.display();
                }),
            );

        modelSetting.descEl.createEl("br");
        modelSetting.descEl.createEl("a", {
            href: "https://openrouter.ai/models",
            text: "Browse models on openrouter.ai",
        });

    }

    private renderReasoningSetting(
        containerEl: HTMLElement,
        model: OpenRouterModelInfo | undefined,
        metadataLoaded: boolean,
        currentEffort: string,
        onChange: (value: string) => Promise<void>,
    ) {
        if (!model) {
            new Setting(containerEl)
                .setName("Reasoning strength")
                .setClass("indent-setting")
                .setDesc(
                    metadataLoaded
                        ? "Model reasoning options are not available in the cached model list. Refresh the list and reselect the model."
                        : "Refresh the model list to load reasoning support for the selected model.",
                );
            return;
        }

        const efforts = model.reasoningEfforts;
        if (!efforts || efforts.length === 0) {
            new Setting(containerEl)
                .setName("Reasoning strength")
                .setClass("indent-setting")
                .setDesc(
                    metadataLoaded
                        ? "The selected model does not expose selectable reasoning effort levels."
                        : "Refresh the model list to load reasoning support for the selected model.",
                );
            return;
        }

        if (efforts.length === 1) {
            new Setting(containerEl)
                .setName("Reasoning strength")
                .setClass("indent-setting")
                .setDesc(`Only supported level: ${efforts[0]}.`);
            return;
        }

        const selectedEffort = efforts.includes(currentEffort)
            ? currentEffort
            : model.defaultReasoningEffort &&
                model.defaultReasoningEffort !== "none" &&
                efforts.includes(model.defaultReasoningEffort)
              ? model.defaultReasoningEffort
              : "";

        new Setting(containerEl)
            .setName("Reasoning strength")
            .setClass("indent-setting")
            .setDesc("Choose a supported reasoning effort for this model.")
            .addDropdown((dropdown) => {
                dropdown
                    .addOption("", "Use model default")
                    .setValue(selectedEffort);

                for (const effort of efforts) {
                    dropdown.addOption(
                        effort,
                        effort.charAt(0).toUpperCase() + effort.slice(1),
                    );
                }

                dropdown.onChange(onChange);
            });
    }

    private initialReasoningEffort(model: OpenRouterModelInfo): string {
        const efforts = model.reasoningEfforts;
        if (efforts?.length === 1) {
            return efforts[0];
        }

        return model.defaultReasoningEffort &&
            model.defaultReasoningEffort !== "none" &&
            efforts?.includes(model.defaultReasoningEffort)
            ? model.defaultReasoningEffort
            : "";
    }

    private async openPostProcessingModelModal() {
        if (
            !this.plugin.settings.openRouterPostProcessingModelCache
                ?.includesReasoningMetadata
        ) {
            await this.refreshPostProcessingModelCache();
        }

        const models =
            this.plugin.settings.openRouterPostProcessingModelCache?.models ??
            [];

        if (models.length === 0) {
            new Notice(
                "No OpenRouter text models available. Check your internet connection and refresh the model list.",
                0,
            );
            return;
        }

        new OpenRouterModelSuggestModal(this.app, models, async (model) => {
            this.profile.openRouterPostProcessingModel = model.id;
            this.profile.openRouterPostProcessingProviders = [];
            this.profile.openRouterPostProcessingReasoningEffort =
                this.initialReasoningEffort(model);
            await this.plugin.saveSettings();
            void this.loadProviderOptions(model.id, true);
            this.display();
        }).open();
    }

    private async refreshPostProcessingModelCache() {
        try {
            const models = await fetchTextModels();

            this.plugin.settings.openRouterPostProcessingModelCache = {
                fetchedAt: Date.now(),
                models,
                includesReasoningMetadata: true,
            };

            const selectedModel = models.find(
                (model) =>
                    model.id ===
                    this.profile.openRouterPostProcessingModel,
            );
            const currentEffort =
                this.profile.openRouterPostProcessingReasoningEffort;
            if (selectedModel?.reasoningEfforts?.length === 1) {
                this.profile.openRouterPostProcessingReasoningEffort = selectedModel.reasoningEfforts[0];
            } else if (
                currentEffort &&
                !selectedModel?.reasoningEfforts?.includes(currentEffort)
            ) {
                this.profile.openRouterPostProcessingReasoningEffort = "";
            }
            await this.plugin.saveSettings();

            new Notice(`Loaded ${models.length} OpenRouter text models.`);
        } catch (error: unknown) {
            console.log(error);
            new Notice(
                `Error loading OpenRouter text models: ${errorMessage(error)}`,
                0,
            );
        }
    }

    private renderProviderRanking(
        containerEl: HTMLElement,
        postProcessing = false,
    ) {
        const rankingSetting = new Setting(containerEl)
            .setName(
                postProcessing
                    ? "Post-processing provider ranking"
                    : "Provider ranking",
            )
            .setHeading()
            .setDesc(
                "Optional: choose which providers should serve the model and in which order (sent as provider.order). With an empty selection OpenRouter uses its default routing.",
            );

        if (!postProcessing && this.isSttSelected()) {
            rankingSetting.setDesc(
                "Provider ranking is not supported for STT models: the /audio/transcriptions endpoint does not accept provider.order, so OpenRouter routes automatically.",
            );
            return;
        }

        const selectedModel = postProcessing
            ? this.profile.openRouterPostProcessingModel
            : this.profile.openRouterModel;
        if (!selectedModel) {
            rankingSetting.setDesc(
                "Select a model first to configure the provider ranking.",
            );
            return;
        }

        const providers = postProcessing
            ? this.profile.openRouterPostProcessingProviders
            : this.profile.openRouterProviders;

        providers.forEach((provider, index) => {
            new Setting(containerEl)
                .setName(`${index + 1}. ${provider}`)
                .setClass("indent-setting")
                .addButton((button) =>
                    button
                        .setButtonText("↑")
                        .setTooltip("Move up")
                        .setDisabled(index === 0)
                        .onClick(() => {
                            this.moveProvider(index, index - 1, postProcessing);
                        }),
                )
                .addButton((button) =>
                    button
                        .setButtonText("↓")
                        .setTooltip("Move down")
                        .setDisabled(index === providers.length - 1)
                        .onClick(() => {
                            this.moveProvider(index, index + 1, postProcessing);
                        }),
                )
                .addButton((button) =>
                    button.setButtonText("Remove").onClick(async () => {
                        this.setProviderRanking(
                            providers.filter((p) => p !== provider),
                            postProcessing,
                        );
                        await this.plugin.saveSettings();
                        this.display();
                    }),
                );
        });

        if (providers.length === 0) {
            new Setting(containerEl)
                .setName("Routing")
                .setClass("indent-setting")
                .setDesc(
                    "No providers selected: OpenRouter will use its default routing.",
                );
        }

        const cachedProviders =
            this.plugin.settings.openRouterProviderCache[selectedModel];

        if (!cachedProviders) {
            new Setting(containerEl)
                .setName("Available providers")
                .setClass("indent-setting")
                .setDesc(
                    "The list of providers serving this model is not loaded yet.",
                )
                .addButton((button) =>
                    button.setButtonText("Load providers").onClick(() => {
                        void this.loadProviderOptions(
                            selectedModel,
                            postProcessing,
                        );
                    }),
                );
            return;
        }

        const remaining = cachedProviders.filter(
            (provider) => !providers.includes(provider),
        );

        new Setting(containerEl)
            .setName("Add provider")
            .setClass("indent-setting")
            .setDesc("Add a provider to the end of the ranking.")
            .addDropdown((dropdown) => {
                dropdown.addOption("", "Choose provider…");
                for (const provider of remaining) {
                    dropdown.addOption(provider, provider);
                }
                dropdown.onChange(async (value) => {
                    if (!value) {
                        return;
                    }
                    this.setProviderRanking(
                        [...providers, value],
                        postProcessing,
                    );
                    await this.plugin.saveSettings();
                    this.display();
                });
            });
    }

    private moveProvider(from: number, to: number, postProcessing = false) {
        const currentProviders = postProcessing
            ? this.profile.openRouterPostProcessingProviders
            : this.profile.openRouterProviders;
        const providers = [...currentProviders];
        const moved = providers[from];
        providers[from] = providers[to];
        providers[to] = moved;

        this.setProviderRanking(providers, postProcessing);
        void this.plugin.saveSettings().then(() => this.display());
    }

    private setProviderRanking(providers: string[], postProcessing: boolean) {
        if (postProcessing) {
            this.profile.openRouterPostProcessingProviders = providers;
        } else {
            this.profile.openRouterProviders = providers;
        }
    }

    private async openModelModal() {
        if (
            !this.plugin.settings.openRouterModelCache?.includesReasoningMetadata
        ) {
            await this.refreshModelCache();
        }

        const models = this.plugin.settings.openRouterModelCache?.models ?? [];

        if (models.length === 0) {
            new Notice(
                "No OpenRouter models available. Check your internet connection and refresh the model list.",
                0,
            );
            return;
        }

        new OpenRouterModelSuggestModal(this.app, models, async (model) => {
            this.profile.openRouterModel = model.id;
            this.profile.openRouterModelIsStt = model.isStt;
            this.profile.openRouterReasoningEffort = model.isStt
                ? ""
                : this.initialReasoningEffort(model);
            this.profile.openRouterProviders = [];
            await this.plugin.saveSettings();
            void this.loadProviderOptions(model.id);
            this.display();
        }).open();
    }

    private async refreshModelCache() {
        try {
            const models = await fetchAudioModels();

            this.plugin.settings.openRouterModelCache = {
                fetchedAt: Date.now(),
                models: models,
                includesReasoningMetadata: true,
            };

            const selectedModel = models.find(
                (model) => model.id === this.profile.openRouterModel,
            );
            const currentEffort =
                this.profile.openRouterReasoningEffort;
            if (selectedModel?.reasoningEfforts?.length === 1) {
                this.profile.openRouterReasoningEffort = selectedModel.reasoningEfforts[0];
            } else if (
                currentEffort &&
                !selectedModel?.reasoningEfforts?.includes(currentEffort)
            ) {
                this.profile.openRouterReasoningEffort = "";
            }
            await this.plugin.saveSettings();

            new Notice(
                `Loaded ${models.length} audio-capable OpenRouter models.`,
            );
        } catch (error: unknown) {
            console.log(error);
            new Notice(
                `Error loading OpenRouter models: ${errorMessage(error)}`,
                0,
            );
        }
    }

    private async loadProviderOptions(modelId: string, postProcessing = false) {
        try {
            const providers = await fetchModelProviders(modelId);

            this.plugin.settings.openRouterProviderCache[modelId] = providers;
            await this.plugin.saveSettings();

            this.display();
        } catch (error: unknown) {
            console.log(error);
            new Notice(
                `Error loading providers for ${modelId}: ${errorMessage(
                    error,
                )}`,
                0,
            );
        }
    }

    private renderStatusbarSettings(containerEl: HTMLElement) {
        new Setting(containerEl)
            .setName("Display status in the status bar")
            .setHeading()
            .addToggle((toggle) =>
                toggle
                    .setValue(this.plugin.settings.showInStatusBar)
                    .onChange(async (value) => {
                        this.plugin.settings.showInStatusBar = value;
                        await this.plugin.saveSettings();

                        if (value) {
                            this.plugin.statusBar = new StatusBar(this.plugin);
                        } else {
                            this.plugin.statusBar?.remove();
                            this.plugin.statusBar = undefined;
                        }

                        this.display();
                    }),
            );

        if (!this.plugin.settings.showInStatusBar) {
            return;
        }

        new Setting(containerEl)
            .setName("Custom status bar colors")
            .addToggle((toggle) =>
                toggle
                    .setValue(this.plugin.settings.customStatusbarColors)
                    .onChange(async (value) => {
                        this.plugin.settings.customStatusbarColors = value;

                        if (!value) {
                            this.restoreDefaultStatusBarColors();
                            this.plugin.statusBar?.reloadStatus();
                        }

                        await this.plugin.saveSettings();
                        this.display();
                    }),
            );

        if (this.plugin.settings.customStatusbarColors) {
            new Setting(containerEl)
                .setName("Ready color")
                .setClass("indent-setting")
                .addColorPicker((color) => {
                    color
                        .setValue(this.plugin.settings.statusbarColorReady)
                        .onChange(async (value) => {
                            this.plugin.settings.statusbarColorReady = value;
                            await this.plugin.saveSettings();
                            this.plugin.statusBar?.reloadStatus();
                        });
                });

            new Setting(containerEl)
                .setName("Recording color")
                .setClass("indent-setting")
                .addColorPicker((color) => {
                    color
                        .setValue(this.plugin.settings.statusbarColorRecording)
                        .onChange(async (value) => {
                            this.plugin.settings.statusbarColorRecording =
                                value;
                            await this.plugin.saveSettings();
                            this.plugin.statusBar?.reloadStatus();
                        });
                });

            new Setting(containerEl)
                .setName("Pause color")
                .setClass("indent-setting")
                .addColorPicker((color) => {
                    color
                        .setValue(this.plugin.settings.statusbarColorPause)
                        .onChange(async (value) => {
                            this.plugin.settings.statusbarColorPause = value;
                            await this.plugin.saveSettings();
                            this.plugin.statusBar?.reloadStatus();
                        });
                });

            new Setting(containerEl)
                .setName("Processing color")
                .setClass("indent-setting")
                .addColorPicker((color) => {
                    color
                        .setValue(this.plugin.settings.statusbarColorProcessing)
                        .onChange(async (value) => {
                            this.plugin.settings.statusbarColorProcessing =
                                value;
                            await this.plugin.saveSettings();
                            this.plugin.statusBar?.reloadStatus();
                        });
                });

            new Setting(containerEl)
                .setName("Post-processing color")
                .setClass("indent-setting")
                .addColorPicker((color) => {
                    color
                        .setValue(
                            this.plugin.settings.statusbarColorPostProcessing,
                        )
                        .onChange(async (value) => {
                            this.plugin.settings.statusbarColorPostProcessing =
                                value;
                            await this.plugin.saveSettings();
                            this.plugin.statusBar?.reloadStatus();
                        });
                });
        }
    }

    private renderPromptSettings(containerEl: HTMLElement) {
        const customPrompt = new Setting(containerEl)
            .setName("Custom prompt")
            .setHeading()
            .setDesc(
                "Edit the instructions sent with the audio. Enabling this setting disables the separate language field, which can then be specified in the prompt.",
            )
            .addToggle((toggle) =>
                toggle
                    .setValue(this.profile.customPrompt)
                    .onChange(async (value) => {
                        this.profile.customPrompt = value;
                        this.completePrompt();
                        await this.plugin.saveSettings();
                        this.display();
                    }),
            );

        if (this.profile.customPrompt) {
            customPrompt.descEl.createEl("br");
            customPrompt.descEl.createEl("br");
            customPrompt.descEl
                .createEl("span", {
                    text: "\nDisabeling this option after changing the prompt manually will reset the promt to the default prompt.",
                })
                .setCssStyles({ color: "red" });
        }

        if (this.profile.customPrompt) {
            const promptSetting = new Setting(containerEl)
                .setName("Prompt")
                .setClass("indent-setting")
                .setDesc(
                    "This is the prompt that gets passed to gemini with your audiofile. You can edit it manually however you like it.",
                )
                .addTextArea((textArea) =>
                    textArea
                        .setValue(this.profile.prompt)
                        .onChange(async (value) => {
                            this.profile.prompt = value;
                            await this.plugin.saveSettings();
                        })
                        .inputEl.setCssStyles({
                            width: "-webkit-fill-available",
                            height: "15em",
                        }),
                );

            promptSetting.settingEl.setCssStyles({
                alignItems: "initial",
            });
            promptSetting.infoEl.setCssStyles({ maxWidth: "30%" });
        }
    }

    private renderSaveAudioSettings(containerEl: HTMLElement) {
        new Setting(containerEl)
            .setName("Save audio file")
            .setHeading()
            .setDesc("Save the recorded audiofiles in the vault.")
            .addToggle((toggle) =>
                toggle
                    .setValue(this.plugin.settings.saveAudioFile)
                    .onChange(async (value) => {
                        this.plugin.settings.saveAudioFile = value;
                        await this.plugin.saveSettings();
                        this.display();
                    }),
            );

        if (this.plugin.settings.saveAudioFile) {
            new Setting(containerEl)
                .setName("Save audio file at note location")
                .setDesc(
                    "If a note is open, the audio file for the transcription will be saved with that note, instead of the default audio file save location.",
                )
                .setClass("indent-setting")
                .addToggle((toggle) =>
                    toggle
                        .setValue(this.plugin.settings.saveByNoteLocation)
                        .onChange(async (value) => {
                            this.plugin.settings.saveByNoteLocation = value;
                            await this.plugin.saveSettings();
                        }),
                );

            new Setting(containerEl)
                .setName("Save location for audio files")
                .setDesc(
                    "Enter a location inside your vault where the audio files should be saved.",
                )
                .setClass("indent-setting")
                .addText((text) =>
                    text
                        .setValue(this.plugin.settings.audioFileSaveLocation)
                        .setPlaceholder("attachment/audio")
                        .onChange(async (value) => {
                            this.plugin.settings.audioFileSaveLocation =
                                normalizePath(value);
                            await this.plugin.saveSettings();
                        }),
                );

            new Setting(containerEl)
                .setName("Embed audio file in current note")
                .setDesc(
                    "If enabled the recorded audio file will be embedded before the transcription.",
                )
                .setClass("indent-setting")
                .addToggle((toggle) =>
                    toggle
                        .setValue(this.plugin.settings.embedAudioFile)
                        .onChange(async (value) => {
                            this.plugin.settings.embedAudioFile = value;
                            await this.plugin.saveSettings();
                        }),
                );
        }
    }
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

class OpenRouterModelSuggestModal extends FuzzySuggestModal<OpenRouterModelInfo> {
    private models: OpenRouterModelInfo[];
    private onChoose: (model: OpenRouterModelInfo) => void;

    constructor(
        app: App,
        models: OpenRouterModelInfo[],
        onChoose: (model: OpenRouterModelInfo) => void,
    ) {
        super(app);
        this.models = models;
        this.onChoose = onChoose;
        this.setPlaceholder("Search OpenRouter models…");
    }

    getItems(): OpenRouterModelInfo[] {
        return this.models;
    }

    getItemText(model: OpenRouterModelInfo): string {
        const kind = model.isStt ? "STT" : "Chat";
        return `${model.name} (${model.id}) [${kind}]`;
    }

    onChooseItem(model: OpenRouterModelInfo): void {
        this.onChoose(model);
    }
}
