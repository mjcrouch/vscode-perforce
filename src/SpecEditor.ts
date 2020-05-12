import * as vscode from "vscode";
import * as p4 from "./api/PerforceApi";
import * as Path from "path";
import { TextEncoder } from "util";
import { Display } from "./Display";
import { PerforceSCMProvider } from "./ScmProvider";

type SpecInstance = { resource: string; lastAccessed: number };
type SpecStore = { [key: string]: SpecInstance };

abstract class SpecEditor {
    private _state: vscode.Memento;
    private _store: vscode.Uri;
    private _hasUnresolvedPrompt: boolean;
    private _subscriptions: vscode.Disposable[];
    private _suppressNextSave?: vscode.TextDocument;

    constructor(context: vscode.ExtensionContext, private _type: string) {
        this._state = context.globalState;
        this._store = vscode.Uri.file(context.globalStoragePath);
        this._hasUnresolvedPrompt = false;
        this._subscriptions = [];
        this._subscriptions.push(
            vscode.workspace.onWillSaveTextDocument((doc) => {
                // DON'T AWAIT - WILL PREVENT SAVE
                this.checkSavedDoc(doc);
            })
        );
    }

    dispose() {
        this._subscriptions.forEach((sub) => sub.dispose());
    }

    protected abstract getSpecText(resource: vscode.Uri, item: string): Promise<string>;
    protected abstract inputSpecText(
        resource: vscode.Uri,
        item: string,
        text: string
    ): Promise<string | undefined>;

    private get mapName() {
        return this._type + "Map";
    }

    private async setResource(specFile: vscode.Uri, resource: vscode.Uri) {
        const cur = this._state.get<SpecStore>(this.mapName) ?? {};
        cur[specFile.fsPath] = {
            resource: resource.fsPath,
            lastAccessed: new Date().getTime(),
        };
        await this._state.update(this.mapName, cur);
    }

    private getResource(file: vscode.Uri): vscode.Uri | undefined {
        const cur = this._state.get<SpecStore>(this.mapName);
        const fsPath = cur?.[file.fsPath]?.resource;
        if (fsPath) {
            return vscode.Uri.file(fsPath);
        }
    }

    private clearCached(olderThan: number) {
        const cur = this._state.get<SpecStore>(this.mapName) ?? {};
        Object.keys(cur).forEach((file) => {
            try {
                if (cur[file].lastAccessed < olderThan) {
                    vscode.workspace.fs.delete(vscode.Uri.file(file));
                    delete cur[file];
                }
            } catch {}
        });
        this._state.update(this.mapName, cur);
    }

    public archiveOldItems() {
        // ms sec min hours days
        const timeAgo = 1000 * 60 * 60 * 24 * 5;
        const olderThan = new Date().getTime() - timeAgo;
        this.clearCached(olderThan);
    }

    private static async checkTabSettings() {
        const check = vscode.workspace
            .getConfiguration("perforce")
            .get("specEditor.showIndentWarning");

        if (
            check &&
            vscode.workspace.getConfiguration("editor").get("insertSpaces") &&
            !vscode.workspace.getConfiguration("editor").get("detectIndentation")
        ) {
            const enable = "Enable tab detection in this workspace";
            const ignore = "Don't show this warning";
            const chosen = await vscode.window.showWarningMessage(
                "WARNING - your editor is configured to use spaces and never tabs, which causes strange indentation when editing perforce spec files. Consider enabling the `editor.detectIndentation` setting",
                enable,
                ignore
            );
            if (chosen === enable) {
                await vscode.workspace
                    .getConfiguration("editor")
                    .update("detectIndentation", true);
            }
            if (chosen === ignore) {
                await vscode.workspace
                    .getConfiguration("perforce")
                    .update(
                        "specEditor.showIndentWarning",
                        false,
                        vscode.ConfigurationTarget.Global
                    );
            }
        }
    }

    private async createSpecFile(item: string, content: string): Promise<vscode.Uri> {
        await vscode.workspace.fs.createDirectory(this._store);
        const fileName = item + "." + this._type + "spec";
        const fullFile = vscode.Uri.file(Path.join(this._store.fsPath, fileName));
        const encoded = new TextEncoder().encode(content);
        await vscode.workspace.fs.writeFile(fullFile, encoded);
        return fullFile;
    }

    async editSpecImpl(resource: vscode.Uri, item: string) {
        const text = await this.getSpecText(resource, item);
        const withMessage =
            text +
            "\n\n# When you are done editing, click the 'apply spec' button\n# on this editor's toolbar to apply the edit to the perforce server";
        const file = await this.createSpecFile(item, withMessage);
        await this.setResource(file, resource);
        await vscode.window.showTextDocument(file, { preview: item === "new" });
        SpecEditor.checkTabSettings();
    }

    async editSpec(resource: vscode.Uri, item: string) {
        await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Window,
                title: "Retrieving spec for " + this._type + " " + item,
            },
            () => this.editSpecImpl(resource, item)
        );
    }

    private get specSuffix() {
        return this._type + "spec";
    }

    private isValidSpecFilename(file: string) {
        return file.endsWith("." + this.specSuffix);
    }

    private getSpecItemName(file: string) {
        return Path.basename(file).split(".")[0];
    }

    async validateAndGetResource(doc: vscode.TextDocument) {
        const file = doc.uri;
        const filename = Path.basename(file.fsPath);
        if (!this.isValidSpecFilename(filename)) {
            throw new Error(
                "Filename " + filename + " does not end in ." + this.specSuffix
            );
        }
        const item = this.getSpecItemName(filename);
        const resource = this.getResource(file);
        if (!resource) {
            throw new Error(
                "Could not find workspace details for " + this._type + " " + item
            );
        }
        if (doc?.isDirty) {
            // don't ask about uploading, we're already doing that
            this._suppressNextSave = doc;
            await doc?.save();
        }
        const text = doc.getText();
        return { item, resource, text };
    }

    async inputSpec(doc: vscode.TextDocument) {
        try {
            const { item, resource, text } = await this.validateAndGetResource(doc);
            const newItem = await vscode.window.withProgress(
                {
                    location: vscode.ProgressLocation.Window,
                    title: "Uploading spec for " + this._type + " " + item,
                },
                () => this.inputSpecText(resource, item, text)
            );
            if (newItem && newItem !== item) {
                vscode.commands.executeCommand("workbench.action.closeActiveEditor");
            }
            // re-open with new values - old job specs are not valid because of the timestamp
            this.editSpec(resource, newItem ?? item);
        } catch (err) {
            Display.showImportantError(err);
        }
    }

    async refreshSpec(doc: vscode.TextDocument) {
        const { item, resource } = await this.validateAndGetResource(doc);
        await this.editSpec(resource, item);
    }

    private async checkSavedDoc(event: vscode.TextDocumentWillSaveEvent) {
        if (this._suppressNextSave === event.document) {
            this._suppressNextSave = undefined;
            return;
        }
        if (
            !this._hasUnresolvedPrompt &&
            event.reason === vscode.TextDocumentSaveReason.Manual
        ) {
            const doc = event.document;
            if (this.isValidSpecFilename(doc.fileName) && this.getResource(doc.uri)) {
                const item = this.getSpecItemName(doc.fileName);
                const ok = "Apply now";
                this._hasUnresolvedPrompt = true;

                const message =
                    item === "new"
                        ? "Create new " + this._type + " on the perforce server now?"
                        : "Apply your changes to the spec for " +
                          this._type +
                          " " +
                          item +
                          " on the perforce server now?";
                const chosen = await vscode.window.showInformationMessage(message, ok);
                this._hasUnresolvedPrompt = false;
                if (chosen === ok) {
                    this.inputSpec(doc);
                }
            }
        }
    }
}

class ChangeSpecEditor extends SpecEditor {
    constructor(context: vscode.ExtensionContext) {
        super(context, "change");
    }

    protected getSpecText(resource: vscode.Uri, item: string) {
        const chnum = item === "new" ? undefined : item;
        return p4.outputChange(resource, { existingChangelist: chnum });
    }
    protected async inputSpecText(resource: vscode.Uri, item: string, text: string) {
        const output = await p4.inputRawChangeSpec(resource, { input: text });
        Display.showMessage(output.rawOutput);
        PerforceSCMProvider.RefreshAll();
        return output.chnum ?? item;
    }
}

class JobSpecEditor extends SpecEditor {
    constructor(context: vscode.ExtensionContext) {
        super(context, "job");
    }

    protected getSpecText(resource: vscode.Uri, item: string) {
        const job = item === "new" ? undefined : item;
        return p4.outputJob(resource, { existingJob: job });
    }
    protected async inputSpecText(resource: vscode.Uri, item: string, text: string) {
        const output = await p4.inputRawJobSpec(resource, { input: text });
        // TODO parse job output ahnd return new job name
        Display.showMessage(output.rawOutput);
        return output.job ?? item;
    }
}

export let changeSpecEditor: SpecEditor;
export let jobSpecEditor: SpecEditor;

export function createSpecEditor(context: vscode.ExtensionContext) {
    changeSpecEditor = new ChangeSpecEditor(context);
    jobSpecEditor = new JobSpecEditor(context);
    context.subscriptions.push(changeSpecEditor);
    context.subscriptions.push(jobSpecEditor);
    changeSpecEditor.archiveOldItems();
    jobSpecEditor.archiveOldItems();
}
