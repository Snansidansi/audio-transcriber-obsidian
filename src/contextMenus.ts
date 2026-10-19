import GeminiTranscriberPlugin from "main";
import { Transcriber } from "./transcriber";

export function addContextMenus(plugin: GeminiTranscriberPlugin) {
    plugin.registerEvent(
        plugin.app.workspace.on("file-menu", (menu, file) => {
            const filetypes = Transcriber.validFileFormats.join("|");
            const regex = new RegExp(`.+\\.(${filetypes})`);
            if (!regex.test(file.name)) {
                return;
            }

            menu.addItem((item) => {
                item.setTitle("Transcribe audio")
                    .setIcon("microphone-filled")
                    .onClick(async () => {
                        const target = plugin.transcriber.captureInsertionTarget(
                            true,
                        );
                        const fileExtension = file.name.split(".").pop();
                        const mimeType = "audio/" + fileExtension;

                        const tfile = plugin.app.vault.getFileByPath(file.path);
                        if (!tfile) {
                            return;
                        }

                        const arrayBuffer =
                            await plugin.app.vault.readBinary(tfile);
                        const blob = new Blob([arrayBuffer], {
                            type: mimeType,
                        });

                        plugin.transcriber.transcribe(blob, file.name, target);
                    });
            });
        }),
    );
}
