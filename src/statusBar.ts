import GeminiTranscriberPlugin from "main";
import { RecorderControlPanel } from "./recorderControlPanel";
import { Stopwatch } from "./stopwatch";

type RecorderStatus = "ready" | "recording" | "pause";

export class StatusBar {
    private statusBarItem: HTMLElement;
    private recordingElem: HTMLSpanElement;
    private processingElem: HTMLSpanElement;
    private postProcessingElem: HTMLSpanElement;
    private readyElem: HTMLSpanElement;
    private recordingSeparator: HTMLSpanElement;
    private postProcessingSeparator: HTMLSpanElement;
    private stopwatch: Stopwatch;
    private recorderStatus: RecorderStatus = "ready";
    private plugin: GeminiTranscriberPlugin;

    constructor(plugin: GeminiTranscriberPlugin) {
        this.plugin = plugin;
        this.stopwatch = new Stopwatch(() => this.render(), plugin);
        const recorderState = plugin.audioRecorder.getState();
        if (recorderState === "recording" || recorderState === "paused") {
            this.recorderStatus = recorderState === "paused" ? "pause" : "recording";
            if (this.recorderStatus === "recording") {
                this.stopwatch.start();
            }
        }

        this.statusBarItem = plugin.addStatusBarItem();
        const container = this.statusBarItem.createEl("span");
        this.recordingElem = container.createEl("span");
        this.recordingSeparator = container.createEl("span", { text: " | " });
        this.processingElem = container.createEl("span");
        this.postProcessingSeparator = container.createEl("span", { text: " | " });
        this.postProcessingElem = container.createEl("span");
        this.readyElem = container.createEl("span");

        this.statusBarItem.onClickEvent(() => {
            new RecorderControlPanel(this.plugin).open();
        });

        this.render();
    }

    remove() {
        this.stopwatch.stop();
        this.statusBarItem.remove();
    }

    reloadStatus() {
        this.render();
    }

    setStatus(status: RecorderStatus) {
        if (status === this.recorderStatus) {
            return;
        }

        if (status === "recording") {
            this.recorderStatus = status;
            this.stopwatch.start();
        } else if (status === "pause") {
            this.recorderStatus = status;
            this.stopwatch.stop();
        } else {
            this.recorderStatus = status;
            this.stopwatch.resetTimerOnly();
        }

        this.render();
    }

    private render() {
        const { processing: processingCount, postProcessing: postProcessingCount } =
            this.plugin.transcriber.getTranscriptionCounts();
        const hasRecording = this.recorderStatus !== "ready";
        const hasProcessing = processingCount > 0;
        const hasPostProcessing = postProcessingCount > 0;
        const hasActivity = hasRecording || hasProcessing || hasPostProcessing;

        this.recordingElem.hidden = !hasRecording;
        this.recordingElem.textContent =
            this.recorderStatus === "recording"
                ? `rec: ${this.stopwatch.formatTime()}`
                : "paused";
        this.recordingElem.style.color =
            this.recorderStatus === "pause"
                ? this.plugin.settings.statusbarColorPause
                : this.plugin.settings.statusbarColorRecording;

        this.recordingSeparator.hidden =
            !hasRecording || !(hasProcessing || hasPostProcessing);

        this.processingElem.hidden = !hasProcessing;
        this.processingElem.textContent = `processing (${processingCount})`;
        this.processingElem.style.color = this.plugin.settings.statusbarColorProcessing;

        this.postProcessingSeparator.hidden = !hasProcessing || !hasPostProcessing;

        this.postProcessingElem.hidden = !hasPostProcessing;
        this.postProcessingElem.textContent = `post-processing (${postProcessingCount})`;
        this.postProcessingElem.style.color =
            this.plugin.settings.statusbarColorPostProcessing;

        this.readyElem.hidden = hasActivity;
        this.readyElem.textContent = "transcriber ready";
        this.readyElem.style.color = this.plugin.settings.statusbarColorReady;
    }
}
