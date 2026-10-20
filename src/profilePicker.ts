import GeminiTranscriberPlugin from "main";
import { Modal, Setting } from "obsidian";
import type { TranscriptionProfile } from "./settings";

export function chooseTranscriptionProfile(
    plugin: GeminiTranscriberPlugin,
): Promise<TranscriptionProfile | null> {
    return new Promise((resolve) => {
        new ProfilePickerModal(plugin, resolve).open();
    });
}

class ProfilePickerModal extends Modal {
    private plugin: GeminiTranscriberPlugin;
    private resolveChoice: (profile: TranscriptionProfile | null) => void;
    private selectedProfile: TranscriptionProfile;
    private settled = false;

    constructor(
        plugin: GeminiTranscriberPlugin,
        resolveChoice: (profile: TranscriptionProfile | null) => void,
    ) {
        super(plugin.app);
        this.plugin = plugin;
        this.resolveChoice = resolveChoice;
        this.selectedProfile = plugin.getActiveProfile();
    }

    onOpen(): void {
        this.setTitle("Select transcription profile");
        this.contentEl.empty();

        new Setting(this.contentEl)
            .setName("Profile")
            .setDesc(`Currently active: ${this.plugin.getActiveProfile().name}`)
            .addDropdown((dropdown) => {
                for (const profile of this.plugin.settings.profiles) {
                    dropdown.addOption(profile.id, profile.name);
                }

                dropdown
                    .setValue(this.selectedProfile.id)
                    .onChange((profileId) => {
                        const profile = this.plugin.settings.profiles.find(
                            (item) => item.id === profileId,
                        );
                        if (profile) {
                            this.selectedProfile = profile;
                        }
                    });
            });

        new Setting(this.contentEl)
            .addButton((button) =>
                button
                    .setButtonText("Transcribe")
                    .setCta()
                    .onClick(() => this.finish(this.selectedProfile)),
            )
            .addButton((button) =>
                button.setButtonText("Cancel").onClick(() => this.close()),
            );
    }

    onClose(): void {
        this.contentEl.empty();
        this.finish(null);
    }

    private finish(profile: TranscriptionProfile | null): void {
        if (this.settled) {
            return;
        }

        this.settled = true;
        this.resolveChoice(
            profile ? this.plugin.getProfileSnapshot(profile) : null,
        );
        this.close();
    }
}
