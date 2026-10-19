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

export type TranscriptionProviderName = "gemini" | "openrouter";

export interface GeminiTranscriberSettings {
    provider: TranscriptionProviderName;
    geminiApiKeySecretName: string;
    modelName: string;
    openRouterApiKeySecretName: string;
    openRouterModel: string;
    openRouterModelIsStt: boolean;
    openRouterReasoningEffort: string;
    openRouterPostProcessingModel: string;
    openRouterPostProcessingProviders: string[];
    openRouterPostProcessingReasoningEffort: string;
    openRouterProviders: string[];
    openRouterModelCache: OpenRouterModelCache | undefined;
    openRouterPostProcessingModelCache: OpenRouterModelCache | undefined;
    openRouterProviderCache: Record<string, string[]>;
    enablePostProcessing: boolean;
    geminiPostProcessingModel: string;
    postProcessingPrompt: string;
    language: string;
    customPrompt: boolean;
    prompt: string;
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

export const DEFAULT_SETTINGS: Partial<GeminiTranscriberSettings> = {
    provider: "gemini",
    geminiApiKeySecretName: "",
    modelName: "gemini-2.0-flash",
    openRouterApiKeySecretName: "",
    openRouterModel: "",
    openRouterModelIsStt: false,
    openRouterReasoningEffort: "",
    openRouterPostProcessingModel: "",
    openRouterPostProcessingProviders: [],
    openRouterPostProcessingReasoningEffort: "",
    openRouterProviders: [],
    openRouterModelCache: undefined,
    openRouterPostProcessingModelCache: undefined,
    openRouterProviderCache: {},
    enablePostProcessing: false,
    geminiPostProcessingModel: "gemini-2.0-flash",
    postProcessingPrompt: "",
    language: "english",
    customPrompt: false,
    prompt: "Transcribe the audio to markdown, removing filler words, be precise and don't interpret anything. Language: ",
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

    constructor(app: App, plugin: GeminiTranscriberPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    private completePrompt(): void {
        if (this.plugin.settings.customPrompt) {
            return;
        }

        this.plugin.settings.prompt =
            // Prompt is always set in DEFAULT_SETTINGS
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            DEFAULT_SETTINGS.prompt! + this.plugin.settings.language;
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
            this.plugin.settings.provider === "openrouter" &&
            this.plugin.settings.openRouterModelIsStt
        );
    }

    display(): void {
        const { containerEl } = this;
        const scrollTop = containerEl.scrollTop;

        containerEl.empty();

        new Setting(containerEl)
            .setName("Provider")
            .setDesc("Choose the backend used for transcription.")
            .addDropdown((dropdown) =>
                dropdown
                    .addOption("gemini", "Gemini")
                    .addOption("openrouter", "OpenRouter")
                    .setValue(this.plugin.settings.provider)
                    .onChange(async (value) => {
                        this.plugin.settings.provider =
                            value as TranscriptionProviderName;
                        this.plugin.transcriber.reloadProvider();
                        await this.plugin.saveSettings();
                        this.display();
                    }),
            );

        if (this.plugin.settings.provider === "openrouter") {
            this.renderOpenRouterSettings(containerEl);
        } else {
            this.renderGeminiSettings(containerEl);
        }

        this.renderPostProcessingSettings(containerEl);

        new Setting(containerEl)
            .setName("Transcription and output")
            .setHeading();

        new Setting(containerEl)
            .setName(
                `Language ${
                    this.plugin.settings.customPrompt ? "(disabled)" : ""
                }`,
            )
            .setDesc("Specify the language of the input audio.")
            .addText((text) =>
                text
                    .setValue(this.plugin.settings.language)
                    .setPlaceholder("english")
                    .onChange(async (value) => {
                        this.plugin.settings.language = value;
                        this.completePrompt();
                        await this.plugin.saveSettings();
                    })
                    .setDisabled(
                        this.plugin.settings.customPrompt ? true : false,
                    ),
            );

        new Setting(containerEl)
            .setName("Copy transcripts to clipboard")
            .setDesc(
                "Enable this option to automatically copy transcripts to your clipboard, so you can paste them (e.g., using Ctrl + V).",
            )
            .addToggle((toggle) => {
                toggle
                    .setValue(this.plugin.settings.saveToClipBoard)
                    .onChange(async (value) => {
                        this.plugin.settings.saveToClipBoard = value;
                        await this.plugin.saveSettings();
                    });
            });

        new Setting(containerEl)
            .setName("Save location for transcripts")
            .setDesc(
                "Enter a location inside your vault where the transcripts should be saved if no editor is opened.",
            )
            .addText((text) =>
                text
                    .setValue(this.plugin.settings.transcriptSaveLocation)
                    .setPlaceholder("notes/transcripts")
                    .onChange(async (value) => {
                        this.plugin.settings.transcriptSaveLocation = value;
                        await this.plugin.saveSettings();
                    }),
            );

        new Setting(containerEl)
            .setName("Enable statistics")
            .setDesc(
                "Collect plugin usage statistics and view them with a command.",
            )
            .addToggle((toggle) =>
                toggle
                    .setValue(this.plugin.settings.enableStatistics)
                    .onChange(async (value) => {
                        this.plugin.settings.enableStatistics = value;
                        await this.plugin.saveSettings();

                        if (value) {
                            this.plugin.statistics = new Statistics(
                                this.plugin,
                            );
                            this.plugin.statistics.load();
                        } else {
                            this.plugin.statistics = undefined;
                        }
                    }),
            );

        this.renderStatusbarSettings(containerEl);

        if (this.isSttSelected()) {
            new Setting(containerEl)
                .setName("Custom prompt")
                .setHeading()
                .setDesc(
                    "For STT models no custom prompt is supported. The selected language is sent as the language parameter instead.",
                );
        } else {
            this.renderPromptSettings(containerEl);
        }

        this.renderSaveAudioSettings(containerEl);
        containerEl.scrollTop = scrollTop;
    }

    private renderGeminiSettings(containerEl: HTMLElement) {
        new Setting(containerEl)
            .setName("API key")
            .setDesc("Select your Gemini api key.")
            .addComponent((el) =>
                new SecretComponent(this.app, el)
                    .setValue(this.plugin.settings.geminiApiKeySecretName)
                    .onChange(async (value) => {
                        this.plugin.settings.geminiApiKeySecretName = value;
                        this.plugin.transcriber.reloadApiKey();
                        await this.plugin.saveSettings();
                    }),
            );

        const modelSetting = new Setting(containerEl)
            .setName("Model name")
            .setDesc(
                "Specify the gemini model that gets used for the transcriptions. The name contains '-' and no spaces.",
            )
            .addText((text) =>
                text
                    .setValue(this.plugin.settings.modelName)
                    .onChange(async (value) => {
                        this.plugin.settings.modelName = value;
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
        new Setting(containerEl)
            .setName("API key")
            .setDesc("Select your OpenRouter api key.")
            .addComponent((el) =>
                new SecretComponent(this.app, el)
                    .setValue(this.plugin.settings.openRouterApiKeySecretName)
                    .onChange(async (value) => {
                        this.plugin.settings.openRouterApiKeySecretName = value;
                        this.plugin.transcriber.reloadApiKey();
                        await this.plugin.saveSettings();
                    }),
            );

        const cache = this.plugin.settings.openRouterModelCache;
        const selectedModel = this.plugin.settings.openRouterModel;
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
                this.plugin.settings.openRouterReasoningEffort,
                async (value) => {
                    this.plugin.settings.openRouterReasoningEffort = value;
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
                    .setValue(this.plugin.settings.enablePostProcessing)
                    .onChange(async (value) => {
                        this.plugin.settings.enablePostProcessing = value;
                        await this.plugin.saveSettings();
                        this.display();
                    }),
            );

        if (!this.plugin.settings.enablePostProcessing) {
            return;
        }

        if (this.plugin.settings.provider === "openrouter") {
            this.renderOpenRouterPostProcessingModel(containerEl);
            const cache =
                this.plugin.settings.openRouterPostProcessingModelCache;
            if (this.plugin.settings.openRouterPostProcessingModel) {
                const model = cache?.models.find(
                    (item) =>
                        item.id ===
                        this.plugin.settings.openRouterPostProcessingModel,
                );
                this.renderReasoningSetting(
                    containerEl,
                    model,
                    cache?.includesReasoningMetadata === true,
                    this.plugin.settings
                        .openRouterPostProcessingReasoningEffort,
                    async (value) => {
                        this.plugin.settings.openRouterPostProcessingReasoningEffort =
                            value;
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
                            this.plugin.settings.geminiPostProcessingModel,
                        )
                        .setPlaceholder("gemini-2.0-flash")
                        .onChange(async (value) => {
                            this.plugin.settings.geminiPostProcessingModel =
                                value;
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
                    .setValue(this.plugin.settings.postProcessingPrompt)
                    .setPlaceholder(
                        "Summarize this transcript:\n\n{{transcript}}",
                    )
                    .onChange(async (value) => {
                        this.plugin.settings.postProcessingPrompt = value;
                        await this.plugin.saveSettings();
                    })
                    .inputEl.setCssStyles({
                        width: "-webkit-fill-available",
                        height: "10em",
                    }),
            );

        promptSetting.settingEl.setCssStyles({ alignItems: "initial" });
        promptSetting.infoEl.setCssStyles({ maxWidth: "30%" });

        if (this.plugin.settings.provider === "openrouter") {
            this.renderProviderRanking(containerEl, true);
        }
    }

    private renderOpenRouterPostProcessingModel(containerEl: HTMLElement) {
        const cache = this.plugin.settings.openRouterPostProcessingModelCache;
        const selectedModel =
            this.plugin.settings.openRouterPostProcessingModel;
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
            this.plugin.settings.openRouterPostProcessingModel = model.id;
            this.plugin.settings.openRouterPostProcessingProviders = [];
            this.plugin.settings.openRouterPostProcessingReasoningEffort =
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
                    this.plugin.settings.openRouterPostProcessingModel,
            );
            const currentEffort =
                this.plugin.settings.openRouterPostProcessingReasoningEffort;
            if (selectedModel?.reasoningEfforts?.length === 1) {
                this.plugin.settings.openRouterPostProcessingReasoningEffort =
                    selectedModel.reasoningEfforts[0];
            } else if (
                currentEffort &&
                !selectedModel?.reasoningEfforts?.includes(currentEffort)
            ) {
                this.plugin.settings.openRouterPostProcessingReasoningEffort =
                    "";
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
            ? this.plugin.settings.openRouterPostProcessingModel
            : this.plugin.settings.openRouterModel;
        if (!selectedModel) {
            rankingSetting.setDesc(
                "Select a model first to configure the provider ranking.",
            );
            return;
        }

        const providers = postProcessing
            ? this.plugin.settings.openRouterPostProcessingProviders
            : this.plugin.settings.openRouterProviders;

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
            ? this.plugin.settings.openRouterPostProcessingProviders
            : this.plugin.settings.openRouterProviders;
        const providers = [...currentProviders];
        const moved = providers[from];
        providers[from] = providers[to];
        providers[to] = moved;

        this.setProviderRanking(providers, postProcessing);
        void this.plugin.saveSettings().then(() => this.display());
    }

    private setProviderRanking(providers: string[], postProcessing: boolean) {
        if (postProcessing) {
            this.plugin.settings.openRouterPostProcessingProviders = providers;
        } else {
            this.plugin.settings.openRouterProviders = providers;
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
            this.plugin.settings.openRouterModel = model.id;
            this.plugin.settings.openRouterModelIsStt = model.isStt;
            this.plugin.settings.openRouterReasoningEffort = model.isStt
                ? ""
                : this.initialReasoningEffort(model);
            this.plugin.settings.openRouterProviders = [];
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
                (model) => model.id === this.plugin.settings.openRouterModel,
            );
            const currentEffort =
                this.plugin.settings.openRouterReasoningEffort;
            if (selectedModel?.reasoningEfforts?.length === 1) {
                this.plugin.settings.openRouterReasoningEffort =
                    selectedModel.reasoningEfforts[0];
            } else if (
                currentEffort &&
                !selectedModel?.reasoningEfforts?.includes(currentEffort)
            ) {
                this.plugin.settings.openRouterReasoningEffort = "";
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
                "Show and edit the prompt that gets passed to gemini with your audio file. Enabling this setting will disable the language setting (you can set it manually in the prompt).",
            )
            .addToggle((toggle) =>
                toggle
                    .setValue(this.plugin.settings.customPrompt)
                    .onChange(async (value) => {
                        this.plugin.settings.customPrompt = value;
                        this.completePrompt();
                        await this.plugin.saveSettings();
                        this.display();
                    }),
            );

        if (this.plugin.settings.customPrompt) {
            customPrompt.descEl.createEl("br");
            customPrompt.descEl.createEl("br");
            customPrompt.descEl
                .createEl("span", {
                    text: "\nDisabeling this option after changing the prompt manually will reset the promt to the default prompt.",
                })
                .setCssStyles({ color: "red" });
        }

        if (this.plugin.settings.customPrompt) {
            const promptSetting = new Setting(containerEl)
                .setName("Prompt")
                .setClass("indent-setting")
                .setDesc(
                    "This is the prompt that gets passed to gemini with your audiofile. You can edit it manually however you like it.",
                )
                .addTextArea((textArea) =>
                    textArea
                        .setValue(this.plugin.settings.prompt)
                        .onChange(async (value) => {
                            this.plugin.settings.prompt = value;
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
