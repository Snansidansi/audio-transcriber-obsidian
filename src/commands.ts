import GeminiTranscriberPlugin from "main";
import { Notice } from "obsidian";
import { openFilePicker } from "./filePicker";
import { StatisticsModal } from "./statistics";
import { Transcriber } from "./transcriber";

export function addCommands(plugin: GeminiTranscriberPlugin): void {
    plugin.addCommand({
        id: "start-stop-recording",
        name: "Start/Stop Recording",
        icon: "mic",
        callback: () => {
            if (plugin.audioRecorder.getState() === undefined) {
                plugin.audioRecorder.startRecording();
                return;
            }

            if (plugin.audioRecorder.getState() !== "inactive") {
                plugin.audioRecorder.stopRecording();
                return;
            }
        },
    });

    plugin.addCommand({
        id: "pause-resume-recording",
        name: "Pause/Resume recording",
        icon: "mic-off",
        checkCallback: (checking: boolean) => {
            if (plugin.audioRecorder.getState() === "recording") {
                if (!checking) {
                    plugin.audioRecorder.pauseRecording();
                    new Notice("Recording paused");
                }

                return true;
            }

            if (plugin.audioRecorder.getState() === "paused") {
                if (!checking) {
                    plugin.audioRecorder.resumeRecording();
                    new Notice("Recording resumed");
                }

                return true;
            }

            return false;
        },
    });

    plugin.addCommand({
        id: "abort-recording",
        name: "Abort recording",
        icon: "octagon-x",
        checkCallback: (checking: boolean) => {
            if (
                plugin.audioRecorder.getState() === "recording" ||
                plugin.audioRecorder.getState() === "paused"
            ) {
                if (!checking) {
                    plugin.audioRecorder.abortRecording();
                    new Notice("aborted recording");
                }

                return true;
            }

            return false;
        },
    });

    plugin.addCommand({
        id: "show-statistics",
        name: "Show statistics",
        icon: "chart-no-axes-combined",
        checkCallback: (checking: boolean) => {
            if (plugin.settings.enableStatistics) {
                if (!checking) {
                    new StatisticsModal(plugin).open();
                }
                return true;
            }
            return false;
        },
    });

    plugin.addCommand({
        id: "open-file-picker",
        name: "Select audio file from system",
        icon: "folder-open",
        callback: async () => {
            const validFileTypes = Transcriber.validFileFormats.map(
                (fileType) => "." + fileType,
            );

            const selectedFile = await openFilePicker(validFileTypes);

            if (!selectedFile) {
                return;
            }

            const profile = plugin.getProfileSnapshot();
            const target = plugin.transcriber.captureInsertionTarget(
                false,
                profile,
            );

            const extension = selectedFile.name
                .slice(selectedFile.name.lastIndexOf(".") + 1)
                .toLowerCase();

            const arrayBuffer = await selectedFile.arrayBuffer();
            const blob = new Blob([arrayBuffer], {
                type: "audio/" + extension,
            });

            plugin.transcriber.transcribe(blob, selectedFile.name, target, profile);
        },
    });
}
