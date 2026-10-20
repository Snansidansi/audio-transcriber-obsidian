import GeminiTranscriberPlugin from "main";
import { Menu } from "obsidian";
import { Transcriber } from "./transcriber";

export function addContextMenus(plugin: GeminiTranscriberPlugin) {
    plugin.registerEvent(
        plugin.app.workspace.on("file-menu", (menu, file) => {
            const filetypes = Transcriber.validFileFormats.join("|");
            const regex = new RegExp(`.+\\.(${filetypes})`);
            if (!regex.test(file.name)) {
                return;
            }

            menu.setUseNativeMenu(false);
            const profileMenu = new Menu().setUseNativeMenu(false);
            let closeTimeout: number | undefined;
            let isPointerOverProfileMenu = false;

            const clearCloseTimeout = () => {
                if (closeTimeout !== undefined) {
                    window.clearTimeout(closeTimeout);
                    closeTimeout = undefined;
                }
            };
            const scheduleClose = () => {
                clearCloseTimeout();
                closeTimeout = window.setTimeout(() => profileMenu.hide(), 250);
            };

            profileMenu.onHide(() => {
                isPointerOverProfileMenu = false;
                clearCloseTimeout();
            });
            menu.onHide(() => {
                if (!isPointerOverProfileMenu) {
                    profileMenu.hide();
                }
            });

            const activeProfile = plugin.getActiveProfile();
            menu.addItem((item) => {
                const label = createHoverLabel(
                    `Transcribe audio (${activeProfile.name})`,
                    (event) => {
                        clearCloseTimeout();
                        const bounds = (
                            event.currentTarget as HTMLElement
                        ).getBoundingClientRect();
                        profileMenu.showAtPosition({
                            x: Math.max(0, bounds.right - 4),
                            y: bounds.top,
                        });
                    },
                    scheduleClose,
                    ">",
                );

                item.setTitle(label)
                    .setIcon("microphone-filled")
                    .onClick(() => {
                        void transcribeFileWithProfile(
                            plugin,
                            file,
                            activeProfile.id,
                        );
                    });
            });

            for (const profile of plugin.settings.profiles) {
                const isActive = profile.id === plugin.settings.activeProfileId;
                profileMenu.addItem((item) => {
                    item.setTitle(
                        createHoverLabel(
                            `${profile.name}${isActive ? " (active)" : ""}`,
                            () => {
                                isPointerOverProfileMenu = true;
                                clearCloseTimeout();
                            },
                            () => {
                                isPointerOverProfileMenu = false;
                                scheduleClose();
                            },
                        ),
                    )
                        .setChecked(isActive)
                        .onClick(() => {
                            clearCloseTimeout();
                            isPointerOverProfileMenu = false;
                            profileMenu.hide();
                            menu.hide();
                            void transcribeFileWithProfile(plugin, file, profile.id);
                        });
                });
            }
        }),
    );
}

function createHoverLabel(
    text: string,
    onEnter: (event: MouseEvent) => void,
    onLeave: () => void,
    trailingText?: string,
): DocumentFragment {
    const label = document.createElement("span");
    label.style.display = "flex";
    label.style.alignItems = "center";
    label.style.justifyContent = "space-between";
    label.style.width = "100%";
    label.textContent = text;
    if (trailingText) {
        const trailing = document.createElement("span");
        trailing.textContent = trailingText;
        trailing.setAttribute("aria-hidden", "true");
        label.append(trailing);
    }
    label.addEventListener("mouseenter", onEnter);
    label.addEventListener("mouseleave", onLeave);

    const fragment = document.createDocumentFragment();
    fragment.append(label);
    return fragment;
}

async function transcribeFileWithProfile(
    plugin: GeminiTranscriberPlugin,
    file: { name: string; path: string },
    profileId: string,
): Promise<void> {
    const profile = plugin.settings.profiles.find((item) => item.id === profileId);
    if (!profile) {
        return;
    }

    const tfile = plugin.app.vault.getFileByPath(file.path);
    if (!tfile) {
        return;
    }

    const profileSnapshot = plugin.getProfileSnapshot(profile);
    const target = plugin.transcriber.captureInsertionTarget(true, profileSnapshot);
    const extension = file.name.split(".").pop();
    const arrayBuffer = await plugin.app.vault.readBinary(tfile);
    const blob = new Blob([arrayBuffer], { type: "audio/" + extension });

    plugin.transcriber.transcribe(blob, file.name, target, profileSnapshot);
}
