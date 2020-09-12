import {
    Uri,
    EventEmitter,
    Event,
    SourceControl,
    SourceControlResourceGroup,
    Disposable,
    ProgressLocation,
    window,
    workspace,
    commands,
} from "vscode";
import {
    HideNonWorkspace,
    ConfigAccessor,
    configAccessor,
    FileShelveMode,
} from "../ConfigService";
import * as PerforceUri from "../PerforceUri";
import { Display, ActiveStatusEvent, ActiveEditorStatus } from "../Display";
import { Resource } from "./Resource";

import * as vscode from "vscode";
import { DebouncedFunction, debounce } from "../Debounce";
import * as p4 from "../api/PerforceApi";
import { ChangeInfo, ChangeSpec } from "../api/CommonTypes";
import { isTruthy, pluralise } from "../TsUtils";
import { showQuickPickForChangelist } from "../quickPick/ChangeQuickPick";
import { showQuickPickForJob } from "../quickPick/JobQuickPick";
import { changeSpecEditor, jobSpecEditor } from "../SpecEditor";

function isResourceGroup(arg: any): arg is SourceControlResourceGroup {
    return arg && arg.id !== undefined;
}

export type FstatInfo = {
    depotFile: string;
    [key: string]: string;
};

export interface ResourceGroup extends SourceControlResourceGroup {
    model: Model;
    chnum: string;
    isDefault: boolean;
}

class ChangelistContext {
    private _val: { [key: string]: true };

    constructor(private _type: string) {
        this._val = {};
    }

    private updateContext() {
        vscode.commands.executeCommand(
            "setContext",
            "perforce.changes." + this._type,
            this._val
        );
    }

    removeChangelists(chnums: string[]) {
        chnums.forEach((change) => delete this._val["pending:" + change]);
        this.updateContext();
    }

    addChangelists(chnums: string[]) {
        chnums.forEach((change) => (this._val["pending:" + change] = true));
        this.updateContext();
    }
}

export class Model implements Disposable {
    private static _resolvable = new ChangelistContext("resolvable");
    private static _reResolvable = new ChangelistContext("reresolvable");

    private _disposables: Disposable[] = [];
    private _config: ConfigAccessor;

    private _onDidChange = new EventEmitter<void>();
    public get onDidChange(): Event<void> {
        return this._onDidChange.event;
    }

    private _refreshInProgress = false;

    public dispose() {
        this.clean();
        if (this._disposables) {
            this._disposables.forEach((d) => d.dispose());
            this._disposables = [];
        }
    }

    private _defaultGroup?: ResourceGroup;
    private _pendingGroups = new Map<
        string,
        { description: string; group: ResourceGroup }
    >();
    private _openResourcesByPath = new Map<string, Resource>();
    /**
     * The set of local paths we are known NOT to have #have revisions of.
     * Cleared on refresh
     */
    private _knownHaveListByPath = new Map<string, boolean>();

    /**
     * Stores the set of files where the display has checked
     * if the file is open and returned that it is not, but
     * the model believes it is open - so that we know there may
     * be a conflict when trying to perform automatic operations
     * like opening a modified filed to edit, after it was just
     * submitted externally
     */
    private _conflictsByPath = new Set<string>();

    private _refresh: DebouncedFunction<any[], Promise<void>>;

    get workspaceUri() {
        return this._workspaceUri;
    }

    public get ResourceGroups(): ResourceGroup[] {
        const result: ResourceGroup[] = [];

        if (this._defaultGroup) {
            result.push(this._defaultGroup);
        }

        return result.concat([...this._pendingGroups.values()].map((v) => v.group));
    }

    private get hideDefaultNonWorkspace() {
        return (
            this._config.hideNonWorkspaceFiles ===
                HideNonWorkspace.HIDE_CHANGELISTS_AND_DEFAULT_FILES ||
            this._config.hideNonWorkspaceFiles === HideNonWorkspace.HIDE_FILES
        );
    }

    public constructor(
        private _workspaceUri: vscode.Uri, // TODO better not to dupliate this with the scm provider
        private _clientName: string,
        public _sourceControl: SourceControl
    ) {
        this._config = configAccessor;
        this._refresh = debounce<(boolean | undefined)[], Promise<void>>(
            this.RefreshImpl.bind(this),
            this._config.refreshDebounceTime,
            () => (this._refreshInProgress = true)
        );
        this._disposables.push(this._refresh);
        this._disposables.push(
            Display.onActiveFileStatusKnown(this.checkForConflicts.bind(this))
        );
    }

    private assertIsNotDefault(input: ResourceGroup) {
        if (input.isDefault) {
            throw new Error("The default changelist is not valid for this operation");
        }
    }

    private assertIsDefault(input: ResourceGroup) {
        if (!input.isDefault) {
            throw new Error(
                "The non-default changelist '" +
                    input.chnum +
                    "' is not valid for this operation"
            );
        }
    }

    public mayHaveConflictForFile(uri: Uri) {
        return (
            this._conflictsByPath.has(uri.fsPath) ||
            (this._refreshInProgress && this._openResourcesByPath.has(uri.fsPath))
        );
    }

    private checkForConflicts(event: ActiveStatusEvent) {
        if (this._refreshInProgress || this._conflictsByPath.has(event.file.fsPath)) {
            // don't check anything while a refresh is in progress
            return;
        }
        if (event.status === ActiveEditorStatus.NOT_OPEN) {
            const openFile = this.getOpenResource(event.file);
            if (openFile) {
                Display.channel.appendLine(
                    "Detected conflicting status for file " +
                        event.file +
                        "\nSCM provider believes the file is open, but latest 'opened' call does not.\n" +
                        "This is probably caused by an external change such as submitting or reverting the file from another application."
                );
                // does not refresh immediately to prevent the possibility of infinite refreshing
                // only stores the fact that there is a conflict to override checks in other places (file system watcher)
                this._conflictsByPath.add(event.file.fsPath);
            }
        }
    }

    public async Login() {
        const ok = await Display.doLoginFlow(this._workspaceUri);
        if (ok) {
            await this.Refresh();
        }
    }

    public Logout() {
        return Display.doLogoutFlow(this._workspaceUri);
    }

    public async GoToChangelist() {
        const chnum = await Display.requestChangelistNumber();
        if (chnum) {
            showQuickPickForChangelist(this._workspaceUri, chnum);
        }
    }

    public async GoToJob() {
        const job = await Display.requestJobId();
        if (job) {
            showQuickPickForJob(this._workspaceUri, job);
        }
    }

    public async Sync(paths?: Uri[]): Promise<void> {
        const loggedin = await p4.isLoggedIn(this._workspaceUri);
        if (!loggedin) {
            return;
        }

        window.withProgress(
            {
                location: ProgressLocation.SourceControl,
                title: "Syncing...",
            },
            () => this.syncUpdate(paths)
        );
    }

    public async Refresh() {
        await this._refresh.withoutLeadingCall();
    }

    public async RefreshPolitely() {
        await this._refresh();
    }

    public async RefreshImmediately() {
        await this.RefreshImpl();
    }

    /**
     * Gets the resource for a local file if it is open in the workspace (not shelved)
     * @param localFile
     */
    public getOpenResource(localFile: Uri) {
        return this._openResourcesByPath.get(localFile.fsPath);
    }

    /**
     * Checks whether we have a #have revision for a given file in the perforce client
     * The first call after a refresh is cached
     * @param uri the local file to check
     */
    public async haveFile(uri: Uri): Promise<boolean> {
        const cachedHave = this._knownHaveListByPath.get(uri.fsPath);
        if (cachedHave !== undefined) {
            return cachedHave;
        }
        const ret = await p4.haveFile(uri, { file: uri });

        this._knownHaveListByPath.set(uri.fsPath, ret);

        return ret;
    }

    private async RefreshImpl(): Promise<void> {
        // don't clean the changelists now - this will be done by updateStatus
        // seeing an empty scm view and waiting for it to populate makes it feel slower.
        this._refreshInProgress = true;

        const loggedin = await p4.isLoggedIn(this._workspaceUri);
        if (!loggedin) {
            return;
        }

        await window.withProgress(
            {
                location: ProgressLocation.SourceControl,
                title: "Updating status...",
            },
            () => this.updateStatus()
        );
    }

    public async Info(): Promise<void> {
        const resource = this._sourceControl.rootUri;
        if (resource) {
            Display.channel.show();

            const output = await p4.info(resource, {});
            Display.channel.append(output);
        }
    }
    private isInWorkspace(clientFile?: string): boolean {
        return !!clientFile && !!workspace.getWorkspaceFolder(Uri.file(clientFile));
    }

    private isUriInWorkspace(uri?: vscode.Uri): boolean {
        return !!uri && !!workspace.getWorkspaceFolder(uri);
    }

    public async SaveToChangelist(
        descStr: string,
        existingChangelist?: string
    ): Promise<string | undefined> {
        if (!descStr) {
            descStr = "<saved by VSCode>";
        }

        const changeFields = await p4.getChangeSpec(this._workspaceUri, {
            existingChangelist,
        });

        if (this.hideDefaultNonWorkspace && changeFields.files) {
            const infos = await p4.getFstatInfoMapped(this._workspaceUri, {
                depotPaths: changeFields.files.map((file) => file.depotPath),
            });

            changeFields.files = changeFields.files.filter((_file, i) =>
                this.isInWorkspace(infos[i]?.["clientFile"])
            );
        }
        changeFields.description = descStr;

        let newChangelistNumber: string | undefined;
        try {
            const created = await p4.inputChangeSpec(this._workspaceUri, {
                spec: changeFields,
            });

            newChangelistNumber = created.chnum;
            Display.channel.append(created.rawOutput);
            this.Refresh();
        } catch (err) {
            Display.showError(err.toString());
        }

        return newChangelistNumber;
    }

    private async createEmptyChangelist(descStr: string) {
        try {
            const changeFields = await p4.getChangeSpec(this._workspaceUri, {});
            changeFields.files = [];
            changeFields.description = descStr;
            const created = await p4.inputChangeSpec(this._workspaceUri, {
                spec: changeFields,
            });
            return created.chnum;
        } catch (err) {
            Display.showImportantError(err.toString());
        }
    }

    public async ProcessChangelist(): Promise<void> {
        let description = this._sourceControl.inputBox.value;
        this._sourceControl.inputBox.value = "";

        let existingChangelist = "";
        const matches = new RegExp(/^#(\d+)\r?\n([^]+)/).exec(description);
        if (matches) {
            existingChangelist = matches[1];
            description = matches[2];
        }

        await this.SaveToChangelist(description, existingChangelist);
    }

    public async EditChangelist(input: ResourceGroup): Promise<void> {
        const id = input.chnum;

        const change = await p4.getChangeSpec(this._workspaceUri, {
            existingChangelist: id,
        });

        this._sourceControl.inputBox.value = "#" + id + "\n" + change.description ?? "";
    }

    public async EditChangeSpec(input: ResourceGroup): Promise<void> {
        this.assertIsNotDefault(input);
        await changeSpecEditor.editSpec(this._workspaceUri, input.chnum);
    }

    public async NewChangeSpec(): Promise<void> {
        await changeSpecEditor.editSpec(this._workspaceUri, "new");
    }

    public async NewJobSpec(): Promise<void> {
        await jobSpecEditor.editSpec(this._workspaceUri, "new");
    }

    public async Describe(input: ResourceGroup): Promise<void> {
        if (input.isDefault) {
            const uri = PerforceUri.forCommand(input.model.workspaceUri, "change", "-o");
            await commands.executeCommand<void>("vscode.open", uri);
        } else {
            const uri = PerforceUri.forCommand(
                input.model.workspaceUri,
                "describe",
                input.chnum
            );
            await commands.executeCommand<void>("vscode.open", uri);
        }
    }

    public async SubmitDefault(): Promise<void> {
        const loggedin = await p4.isLoggedIn(this._workspaceUri);
        if (!loggedin) {
            return;
        }

        try {
            const files = await p4.getOpenedFiles(this._workspaceUri, {
                chnum: "default",
            });
            if (files.length === 0) {
                throw new Error("The default changelist is empty");
            }
        } catch (err) {
            Display.showError(err.toString());
            return;
        }

        const descStr = await this.requestChangelistDescription();

        if (descStr === undefined) {
            return;
        }

        const pick = await vscode.window.showQuickPick(
            ["Submit", "Save Changelist", "Cancel"],
            {
                ignoreFocusOut: true,
            }
        );

        if (!pick || pick === "Cancel") {
            return;
        }

        if (pick === "Submit") {
            if (this.hideDefaultNonWorkspace) {
                // TODO - relies on state - i.e. that savetochangelist applies hideNonWorkspaceFiles
                const changeListNr = await this.SaveToChangelist(descStr);

                if (changeListNr !== undefined) {
                    await p4.submitChangelist(this._workspaceUri, {
                        chnum: changeListNr,
                    });
                }
            } else {
                await p4.submitChangelist(this._workspaceUri, {
                    description: descStr,
                });
            }
        } else {
            await this.SaveToChangelist(descStr);
        }
        this.Refresh();
    }

    public async Submit(input: ResourceGroup): Promise<void> {
        this.assertIsNotDefault(input);

        if (this._config.promptBeforeSubmit) {
            if (
                !(await this.requestConfirmation(
                    "Are you sure you want to submit changelist " + input.chnum + "?",
                    "Submit changelist"
                ))
            ) {
                return;
            }
        }

        await p4.submitChangelist(this._workspaceUri, { chnum: input.chnum });
        Display.showMessage("Changelist Submitted");
        this.Refresh();
    }

    private async createAndSubmitFromSpec(spec: ChangeSpec) {
        const newChange = await p4.inputChangeSpec(this.workspaceUri, { spec });

        if (!newChange.chnum) {
            throw new Error("Couldn't find the new changelist number");
        }

        const output = await p4.submitChangelist(this.workspaceUri, {
            chnum: newChange.chnum,
        });

        Display.showMessage("Change " + output.chnum + " submitted");
        this.Refresh();
    }

    public async SubmitSelectedFile(resources: Resource[]) {
        if (resources.some((r) => r.change !== "default")) {
            Display.showModalMessage(
                "Only files from the default changelist can be submitted selectively"
            );
            return;
        }

        const spec = await p4.getChangeSpec(this.workspaceUri, {});
        spec.files = spec.files?.filter((file) =>
            resources.some((r) => r.depotPath === file.depotPath)
        );
        if (spec.files?.length !== resources.length) {
            Display.showModalMessage(
                "Unable to submit. The selection is inconsistent with the actual default changelist. Perhaps the perforce view needs refreshing?"
            );
            return;
        }

        const desc = await this.requestChangelistDescription();
        if (!desc) {
            return;
        }
        spec.description = desc;

        this.createAndSubmitFromSpec(spec);
    }

    private hasShelvedFiles(group: SourceControlResourceGroup) {
        return group.resourceStates.some((resource) => (resource as Resource).isShelved);
    }

    public async Revert(
        input: Resource | ResourceGroup,
        unchanged?: boolean
    ): Promise<void> {
        let needRefresh = false;

        const opts: p4.RevertOptions = { paths: [], unchanged };

        let message = "Are you sure you want to revert the changes ";
        if (input instanceof Resource) {
            if (input.isShelved) {
                Display.showImportantError(
                    "Revert cannot be used on shelved file: " + input.basenameWithoutRev
                );
                return;
            }
            opts.paths = [input.actionUriNoRev];
            message += "to file " + input.basenameWithoutRev + "?";
        } else if (isResourceGroup(input)) {
            opts.paths = ["//..."];
            opts.chnum = input.chnum;
            if (input.isDefault) {
                message += "in the default changelist?";
            } else {
                message += "in the changelist " + input.chnum + "?";
            }
        } else {
            return;
        }

        if (!unchanged) {
            if (!(await this.requestConfirmation(message, "Revert Changes"))) {
                return;
            }
        }

        try {
            const output = await p4.revert(this._workspaceUri, opts);
            Display.updateEditor();
            Display.channel.append(output);
            needRefresh = true;
        } catch {
            // p4 shows error
        }

        // delete changelist after
        if (isResourceGroup(input) && !this.hasShelvedFiles(input) && !input.isDefault) {
            try {
                const output = await p4.deleteChangelist(this._workspaceUri, {
                    chnum: input.chnum,
                });
                Display.updateEditor();
                Display.channel.append(output);
                needRefresh = true;
            } catch {
                // p4 shows error
            }
        }

        if (needRefresh) {
            this.Refresh();
        }
    }

    public async QuietlyRevertChangelist(chnum: string): Promise<void> {
        const output = await p4.revert(this._workspaceUri, {
            chnum: chnum,
            paths: ["//..."],
        });
        Display.updateEditor();
        Display.channel.append(output);
    }

    public async ResolveChangelist(input: ResourceGroup) {
        this.assertIsNotDefault(input);

        await p4.resolve(this._workspaceUri, { chnum: input.chnum });
        this.Refresh();
    }

    public async ReResolveChangelist(input: ResourceGroup) {
        this.assertIsNotDefault(input);

        await p4.resolve(this._workspaceUri, { chnum: input.chnum, reresolve: true });
        this.Refresh();
    }

    public async ShelveChangelist(input: ResourceGroup, revert?: boolean): Promise<void> {
        if (input.isDefault) {
            throw new Error("Cannot shelve the default changelist");
        }

        try {
            await p4.shelve(this._workspaceUri, { chnum: input.chnum, force: true });
            if (revert) {
                await this.QuietlyRevertChangelist(input.chnum);
            }
            Display.showMessage("Changelist shelved");
        } catch (err) {
            Display.showImportantError(err.toString());
        }
        this.Refresh();
    }

    public async UnshelveChangelist(input: ResourceGroup): Promise<void> {
        if (input.isDefault) {
            throw new Error("Cannot unshelve the default changelist");
        }

        try {
            const unshelved = await p4.unshelve(this._workspaceUri, {
                shelvedChnum: input.chnum,
                toChnum: input.chnum,
                force: true,
            });
            this.Refresh();
            if (unshelved.warnings.length > 0) {
                const resolveButton = "Resolve changelist";
                const chosen = await vscode.window.showWarningMessage(
                    "Changelist " +
                        input.chnum +
                        " was unshelved, but " +
                        pluralise(
                            unshelved.warnings.length,
                            "file needs",
                            0,
                            "files need"
                        ) +
                        " resolving",
                    resolveButton
                );
                if (chosen === resolveButton) {
                    await p4.resolve(this._workspaceUri, { chnum: input.chnum });
                    this.Refresh();
                }
            }
            Display.showMessage("Changelist unshelved");
        } catch (err) {
            Display.showImportantError(err.toString());
        }
    }

    public async DeleteShelvedChangelist(input: ResourceGroup): Promise<void> {
        if (input.isDefault) {
            throw new Error("Cannot delete shelved files from the default changelist");
        }

        const message =
            "Are you sure you want to delete the shelved files from changelist " +
            input.chnum +
            "?";

        if (!(await this.requestConfirmation(message, "Delete Shelved Files"))) {
            return;
        }

        try {
            await p4.shelve(this._workspaceUri, {
                chnum: input.chnum,
                delete: true,
            });
            this.Refresh();
            Display.showMessage("Shelved files deleted");
        } catch (err) {
            Display.showImportantError(err.toString());
        }
    }

    async showResolveWarningForFile(input: Resource) {
        const resolveButton = "Resolve file";
        const chosen = await vscode.window.showWarningMessage(
            input.basenameWithoutRev + " was unshelved, but needs resolving",
            resolveButton
        );
        if (chosen === resolveButton) {
            await p4.resolve(this._workspaceUri, {
                files: [input.actionUriNoRev],
            });
            this.Refresh();
        }
    }

    async deleteFileAfterUnshelve(input: Resource) {
        const mode = configAccessor.fileShelveMode;
        if (mode === FileShelveMode.KEEP_BOTH) {
            return;
        }

        if (mode === FileShelveMode.PROMPT) {
            const file = input.basenameWithoutRev;
            const message = file + " was unshelved. Delete the shelved file?";
            const yes = "Delete " + file + "@=" + input.change;
            const always = "Always";
            const never = "Never";
            const chosen = await vscode.window.showWarningMessage(
                message,
                { modal: true },
                yes,
                always,
                never
            );
            if (chosen === always) {
                configAccessor.fileShelveMode = FileShelveMode.SWAP;
            } else if (chosen === never) {
                configAccessor.fileShelveMode = FileShelveMode.KEEP_BOTH;
                return;
            } else if (chosen !== yes) {
                return;
            }
        }

        const output = await p4.shelve(this._workspaceUri, {
            chnum: input.change,
            delete: true,
            paths: [input.depotPath],
        });
        Display.channel.append(output);
        this.Refresh();
    }

    async revertFileAfterUnshelve(input: Resource) {
        const mode = configAccessor.fileShelveMode;
        if (mode === FileShelveMode.KEEP_BOTH) {
            return;
        }

        if (mode === FileShelveMode.PROMPT) {
            const file = input.basenameWithoutRev;
            const message = file + " was shelved. Revert the open file?";
            const yes = "Revert " + file;
            const always = "Always";
            const never = "Never";
            const chosen = await vscode.window.showWarningMessage(
                message,
                { modal: true },
                yes,
                always,
                never
            );
            if (chosen === always) {
                configAccessor.fileShelveMode = FileShelveMode.SWAP;
            } else if (chosen === never) {
                configAccessor.fileShelveMode = FileShelveMode.KEEP_BOTH;
                return;
            } else if (chosen !== yes) {
                return;
            }
        }

        await p4.revert(this._workspaceUri, { paths: [input.actionUriNoRev] });
        this.Refresh();
    }

    async unshelveShelvedFile(input: Resource) {
        const unshelveOutput = await p4.unshelve(this._workspaceUri, {
            toChnum: input.change,
            shelvedChnum: input.change,
            paths: [input.depotPath],
        });
        this.Refresh();
        if (unshelveOutput.warnings.length > 0) {
            await this.showResolveWarningForFile(input);
        } else {
            await this.deleteFileAfterUnshelve(input);
        }
        Display.updateEditor();
    }

    async shelveOpenFile(input: Resource) {
        await p4.shelve(this._workspaceUri, {
            chnum: input.change,
            force: true,
            paths: [input.actionUriNoRev],
        });
        this.Refresh();
        await this.revertFileAfterUnshelve(input);
    }

    async ShelveOrUnshelve(input: Resource): Promise<void> {
        try {
            if (input.isShelved) {
                await this.unshelveShelvedFile(input);
            } else {
                await this.shelveOpenFile(input);
            }
        } catch (reason) {
            Display.showImportantError(reason.toString());
            this.Refresh();
        }
    }

    public async ShelveOrUnshelveMultiple(input: Resource[]) {
        if (input.some((r) => r.isShelved !== input[0].isShelved)) {
            Display.showModalMessage(
                "A mix of shelved / open files was selected. Please select only shelved or only open files for this operation"
            );
            return;
        }
        const promises = input.map((r) => this.ShelveOrUnshelve(r));
        await Promise.all(promises);
    }

    public async DeleteShelvedFile(input: Resource): Promise<void> {
        if (!input.isShelved) {
            Display.showImportantError(
                "Shelve cannot be used on normal file: " + input.basenameWithoutRev
            );
            return;
        }

        const message =
            "Are you sure you want to delete the shelved file " + input.depotPath;
        if (!(await this.requestConfirmation(message, "Delete Shelved File"))) {
            return;
        }

        try {
            const ret = await p4.shelve(this._workspaceUri, {
                delete: true,
                chnum: input.change,
                paths: [input.depotPath],
            });
            this.Refresh();
            Display.showMessage(ret);
        } catch (err) {
            Display.showImportantError(err.toString());
        }
    }

    private async requestJobId(chnum: string) {
        const re = new RegExp(/^[a-z0-9]+$/i);
        return await window.showInputBox({
            prompt: "Enter the job to be fixed by changelist " + chnum,
            placeHolder: "jobNNNNNN",
            validateInput: (val) => {
                if (val.trim() === "") {
                    return "Enter a job name";
                }
                if (!re.exec(val)) {
                    return "Job names can only contain letters and numbers";
                }
            },
        });
    }

    public async FixJob(input: ResourceGroup) {
        if (input.isDefault) {
            throw new Error("The default changelist cannot fix a job");
        }

        const jobId = await this.requestJobId(input.chnum);
        if (jobId === undefined) {
            return;
        }

        try {
            await p4.fixJob(this._workspaceUri, { chnum: input.chnum, jobId });
            this.Refresh();
            Display.showMessage("Job " + jobId + " added");
        } catch (err) {
            Display.showImportantError(err.toString());
        }
    }

    private async pickJobFromChangelist(chnum: string) {
        const allJobs = await p4.getFixedJobs(this._workspaceUri, { chnum });

        const items = allJobs.map(
            (job): vscode.QuickPickItem => {
                return {
                    description: job.description[0],
                    label: job.id,
                    detail: job.description.slice(1).join(" "),
                };
            }
        );

        if (items.length === 0) {
            Display.showModalMessage(
                "Changelist " + chnum + " does not have any jobs attached"
            );
            return;
        }

        const job = await window.showQuickPick(items, {
            placeHolder: "Select a job to remove",
            matchOnDescription: true,
            matchOnDetail: true,
        });

        return job;
    }

    public async UnfixJob(input: ResourceGroup) {
        if (input.isDefault) {
            throw new Error("The default changelist cannot fix a job");
        }

        const job = await this.pickJobFromChangelist(input.chnum);

        if (job === undefined) {
            return;
        }

        const jobId = job.label;

        try {
            await p4.fixJob(this._workspaceUri, {
                chnum: input.chnum,
                jobId,
                removeFix: true,
            });
            this.Refresh();
            Display.showMessage("Job " + jobId + " removed");
        } catch (err) {
            Display.showImportantError(err.toString());
        }
    }

    private async requestConfirmation(message: string, yes: string) {
        const result = await window.showWarningMessage(message, { modal: true }, yes);
        return result === yes;
    }

    private async requestChangelistDescription() {
        const newText = await window.showInputBox({
            prompt: "Enter the new changelist's description",
            validateInput: (val) => {
                if (val.trim() === "") {
                    return "Description must not be empty";
                }
            },
        });

        return newText;
    }

    private async createEmptyChangelistInteractively() {
        const newText = await this.requestChangelistDescription();
        return newText ? await this.createEmptyChangelist(newText) : undefined;
    }

    public async ReopenFile(resources: Resource[]): Promise<void> {
        if (resources.some((r) => r.isShelved)) {
            Display.showImportantError("Cannot reopen a shelved file");
            throw new Error("Cannot reopen shelved file");
        }

        const loggedin = await p4.isLoggedIn(this._workspaceUri);
        if (!loggedin) {
            return;
        }

        const items = [];
        items.push({
            id: "default",
            label: this._defaultGroup?.label ?? "Default Changelist",
            description: "",
        });
        items.push({ id: "new", label: "New Changelist...", description: "" });
        this._pendingGroups.forEach((value, key) => {
            items.push({
                id: key,
                label: "#" + key,
                description: value.description,
            });
        });

        const selection = await window.showQuickPick(items, {
            matchOnDescription: true,
            placeHolder: "Choose a changelist:",
        });

        if (selection === undefined) {
            return;
        }

        const chnum =
            selection.id === "new"
                ? await this.createEmptyChangelistInteractively()
                : selection.id;

        if (chnum === undefined) {
            return;
        }

        try {
            const output = await p4.reopenFiles(this._workspaceUri, {
                chnum: chnum,
                files: resources.map((resource) => resource.actionUriNoRev),
            });
            Display.channel.append(output);
        } catch (reason) {
            Display.showImportantError(reason.toString());
        }
        this.Refresh();
    }

    private cleanState() {
        this._openResourcesByPath.clear();
        this._conflictsByPath.clear();
        this._knownHaveListByPath.clear();
        Model._resolvable.removeChangelists([...this._pendingGroups.keys()]);
        Model._reResolvable.removeChangelists([...this._pendingGroups.keys()]);
    }

    private cleanPendingGroups() {
        this._pendingGroups.forEach((value) => value.group.dispose());
        this._pendingGroups.clear();
        this._onDidChange.fire();
    }

    private clean() {
        this.cleanState();

        if (this._defaultGroup) {
            this._defaultGroup.dispose();
            this._defaultGroup = undefined;
        }

        this.cleanPendingGroups();
    }

    private async syncUpdate(paths?: Uri[]): Promise<void> {
        try {
            const output = await p4.sync(this._workspaceUri, {
                files: paths,
            });
            Display.channel.append(output);
            this.Refresh();
        } catch (reason) {
            Display.showImportantError(reason.toString());
        }
    }

    private async updateStatus(): Promise<void> {
        const loggedin = await p4.isLoggedIn(this._workspaceUri);
        if (!loggedin) {
            return;
        }

        const changelists = await this.getChanges();
        const shelvedPromise = this.getAllShelvedResources(changelists);
        const openPromise = this.getDepotOpenedResources();
        const [shelvedResources, openResources] = await Promise.all([
            shelvedPromise,
            openPromise,
        ]);
        this.createResourceGroups(changelists, shelvedResources.concat(openResources));

        this._refreshInProgress = false;
        this._onDidChange.fire();
    }

    private makeResourceForOpenFile(fstatInfo: FstatInfo): Resource | undefined {
        const clientFile = fstatInfo["clientFile"];
        const change = fstatInfo["change"];
        const action = fstatInfo["action"];
        const headType = fstatInfo["headType"];
        const depotPath = Uri.file(fstatInfo["depotFile"]);

        const uri = Uri.file(clientFile);
        if (
            this._config.hideNonWorkspaceFiles === HideNonWorkspace.HIDE_FILES ||
            (this._config.hideNonWorkspaceFiles ===
                HideNonWorkspace.HIDE_CHANGELISTS_AND_DEFAULT_FILES &&
                change === "default")
        ) {
            if (!this.isUriInWorkspace(uri)) {
                return;
            }
        }
        const resource: Resource = new Resource(
            this,
            depotPath,
            uri,
            change,
            false,
            action,
            fstatInfo,
            headType
        );

        return resource;
    }

    private static getChangelistsWhereSome(
        groups: ResourceGroup[],
        predicate: (resource: Resource) => boolean
    ) {
        return groups
            .filter((group) => group.resourceStates.some((r) => predicate(r as Resource)))
            .map((group) => group.chnum);
    }

    private static updateContextVars(groups: ResourceGroup[]) {
        this._resolvable.addChangelists(
            this.getChangelistsWhereSome(groups, (r) => r.isUnresolved)
        );
        this._reResolvable.addChangelists(
            this.getChangelistsWhereSome(groups, (r) => r.isReresolvable)
        );
    }

    private shouldDisplayChangelist(resourceStates: Resource[]) {
        if (this._config.hideEmptyChangelists && resourceStates.length < 1) {
            return false;
        }
        if (this._config.hideNonWorkspaceFiles === HideNonWorkspace.HIDE_CHANGELISTS) {
            const onlyHasNonWorkspace =
                resourceStates.length > 0 &&
                resourceStates.every((r) => !this.isUriInWorkspace(r.underlyingUri));
            if (onlyHasNonWorkspace) {
                return false;
            }
        }
        return true;
    }

    private getOrCreateResourceGroup(c: p4.ChangeInfo) {
        let group = this._pendingGroups.get(c.chnum)?.group;
        if (!group) {
            group = this._sourceControl.createResourceGroup(
                "pending:" + c.chnum,
                "#" + c.chnum + ": " + c.description.join(" ")
            ) as ResourceGroup;
            group.model = this;
            group.isDefault = false;
            group.chnum = c.chnum.toString();
        } else {
            group.label = "#" + c.chnum + ": " + c.description.join(" ");
        }

        return group;
    }

    private arrangeResourcesByChangelist(
        changelists: ChangeInfo[],
        resources: Resource[]
    ) {
        const changesWithResources = changelists
            .map((c) => {
                const resourceStates = resources.filter(
                    (resource) => resource.change === c.chnum
                );
                if (!this.shouldDisplayChangelist(resourceStates)) {
                    return;
                }
                return { change: c, resources: resourceStates };
            })
            .filter(isTruthy);

        const haveNewChangelists = changesWithResources.some(
            (res) => !this._pendingGroups.has(res.change.chnum)
        );
        return {
            haveNewChangelists,
            changesWithResources,
        };
    }

    private disposeUnusedGroups(usedGroups: ResourceGroup[]) {
        this._pendingGroups.forEach((group) => {
            if (!usedGroups.includes(group.group)) {
                group.group.dispose();
            }
        });
    }

    private createResourceGroups(changelists: ChangeInfo[], resources: Resource[]) {
        if (!this._sourceControl) {
            throw new Error("Source control not initialised");
        }
        this.cleanState();

        if (!this._defaultGroup) {
            this._defaultGroup = this._sourceControl.createResourceGroup(
                "default",
                "Default Changelist"
            ) as ResourceGroup;
            this._defaultGroup.isDefault = true;
            this._defaultGroup.model = this;
            this._defaultGroup.chnum = "default";
        }

        this._defaultGroup.resourceStates = resources.filter(
            (resource): resource is Resource =>
                !!resource && resource.change === "default"
        );

        const arranged = this.arrangeResourcesByChangelist(changelists, resources);

        // new resource groups always appear in the order they are created, so if there
        // is a new changelist we need to clear out the existing ones to make it appear at the top
        if (arranged.haveNewChangelists) {
            this.cleanPendingGroups();
        }

        const groups = arranged.changesWithResources.map(({ change, resources }) => {
            const group = this.getOrCreateResourceGroup(change);
            group.resourceStates = resources;
            return group;
        });

        // clear out any old groups that we didn't create or re-use above
        this.disposeUnusedGroups(groups);

        resources.forEach((resource) => {
            if (!resource.isShelved && resource.underlyingUri) {
                this._openResourcesByPath.set(resource.underlyingUri.fsPath, resource);
            }
        });

        groups.forEach((group, i) => {
            this._pendingGroups.set(changelists[i].chnum, {
                description: changelists[i].description.join(" "),
                group: group,
            });
        });

        Model.updateContextVars(groups);
    }

    private async getChanges(): Promise<ChangeInfo[]> {
        const changes = this.filterIgnoredChangelists(
            await p4.getChangelists(this._workspaceUri, {
                client: this._clientName,
                status: p4.ChangelistStatus.PENDING,
            })
        );

        return this._config.changelistOrder === "ascending" ? changes.reverse() : changes;
    }

    private filterIgnoredChangelists(changelists: ChangeInfo[]): ChangeInfo[] {
        const prefix = this._config.ignoredChangelistPrefix;
        if (prefix) {
            changelists = changelists.filter((c) => !c.description[0].startsWith(prefix));
        }
        return changelists;
    }

    private async getAllShelvedResources(changes: ChangeInfo[]): Promise<Resource[]> {
        if (this._config.hideShelvedFiles || changes.length === 0) {
            return [];
        }
        const allFileInfo = await p4.getShelvedFiles(this._workspaceUri, {
            chnums: changes.map((c) => c.chnum),
        });
        return this.getShelvedResources(allFileInfo);
    }

    private makeResourceForShelvedFile(chnum: string, fstatInfo: FstatInfo) {
        const underlyingUri = fstatInfo["clientFile"]
            ? Uri.file(fstatInfo["clientFile"])
            : undefined;

        if (this._config.hideNonWorkspaceFiles === HideNonWorkspace.HIDE_FILES) {
            if (!this.isUriInWorkspace(underlyingUri)) {
                return;
            }
        }

        const resource: Resource = new Resource(
            this,
            PerforceUri.fromDepotPath(
                underlyingUri ?? this.workspaceUri,
                fstatInfo.depotFile,
                undefined
            ),
            underlyingUri,
            chnum,
            true,
            fstatInfo["action"],
            fstatInfo
        );
        return resource;
    }

    private async getShelvedResources(
        files: p4.ShelvedChangeInfo[]
    ): Promise<Resource[]> {
        const proms = files.map((f) =>
            p4.getFstatInfoMapped(this._workspaceUri, {
                depotPaths: f.paths,
                limitToShelved: true,
                outputPendingRecord: true,
                chnum: f.chnum.toString(),
            })
        );
        const fstatInfo = await Promise.all(proms);

        return fstatInfo.flatMap((cur, i) =>
            cur
                .filter(isTruthy)
                .map((f) => this.makeResourceForShelvedFile(files[i].chnum.toString(), f))
                .filter(isTruthy)
        );
    }

    private async getDepotOpenedResources(): Promise<Resource[]> {
        const depotPaths = await this.getDepotOpenedFilePaths();
        const fstatInfo = (
            await p4.getFstatInfoMapped(this._workspaceUri, {
                depotPaths,
                outputPendingRecord: true,
            })
        ).filter(isTruthy);

        return fstatInfo
            .map((info) => this.makeResourceForOpenFile(info))
            .filter(isTruthy); // for files out of workspace
    }

    private async getDepotOpenedFilePaths(): Promise<string[]> {
        return (await p4.getOpenedFiles(this._workspaceUri, {})).map(
            (file) => file.depotPath
        );
    }
}
