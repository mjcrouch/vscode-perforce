import { Uri, workspace, ConfigurationTarget } from "vscode";

export enum HideNonWorkspace {
    SHOW_ALL,
    HIDE_FILES,
    HIDE_CHANGELISTS,
    HIDE_CHANGELISTS_AND_DEFAULT_FILES,
}

export enum FileShelveMode {
    SWAP,
    KEEP_BOTH,
    PROMPT,
}

export enum SyncMode {
    WHOLE_CLIENT,
    WORKSPACE_ONLY,
}

export class ConfigAccessor {
    constructor() {
        /**/
    }

    private getConfigItem<T>(item: string): T | undefined {
        return workspace.getConfiguration("perforce").get<T>(item);
    }

    private setConfigItem<T>(item: string, value: T) {
        workspace.getConfiguration("perforce").update(item, value);
    }

    private setConfigItemGlobally<T>(item: string, value: T) {
        // clear from workspace first
        workspace.getConfiguration("perforce").update(item, undefined);
        workspace
            .getConfiguration("perforce")
            .update(item, value, ConfigurationTarget.Global);
    }

    public get changelistOrder(): string {
        return this.getConfigItem("changelistOrder") ?? "descending";
    }

    public get ignoredChangelistPrefix(): string | undefined {
        return this.getConfigItem("ignoredChangelistPrefix");
    }

    public get hideNonWorkspaceFiles(): HideNonWorkspace {
        const val = this.getConfigItem("hideNonWorkspaceFiles");
        if (typeof val === "boolean") {
            return val ? HideNonWorkspace.HIDE_FILES : HideNonWorkspace.SHOW_ALL;
        } else if (typeof val === "string") {
            if (val === "show all files") {
                return HideNonWorkspace.SHOW_ALL;
            }
            if (val === "hide changelists, hide files in default changelist") {
                return HideNonWorkspace.HIDE_CHANGELISTS_AND_DEFAULT_FILES;
            }
            if (val.startsWith("hide changelists")) {
                return HideNonWorkspace.HIDE_CHANGELISTS;
            }
            if (
                val.startsWith("show all changelists") || // legacy name
                val === "hide non workspace files"
            ) {
                return HideNonWorkspace.HIDE_FILES;
            }
        }
        return HideNonWorkspace.SHOW_ALL;
    }

    public get hideEmptyChangelists(): boolean {
        return this.getConfigItem("hideEmptyChangelists") ?? false;
    }

    public get hideShelvedFiles(): boolean {
        return this.getConfigItem("hideShelvedFiles") ?? false;
    }

    public get maxFilePerCommand(): number {
        return this.getConfigItem("maxFilePerCommand") ?? 32;
    }

    public get countBadge(): string {
        return this.getConfigItem<string>("countBadge") ?? "all-but-shelved";
    }

    public get promptBeforeSubmit(): boolean {
        return this.getConfigItem("promptBeforeSubmit") ?? false;
    }

    public get refreshDebounceTime(): number {
        return 1000;
    }

    public get editOnFileSave(): boolean {
        return this.getConfigItem("editOnFileSave") ?? false;
    }

    public get editOnFileModified(): boolean {
        return this.getConfigItem("editOnFileModified") ?? false;
    }

    public get addOnFileCreate(): boolean {
        return this.getConfigItem("addOnFileCreate") ?? false;
    }

    public get deleteOnFileDelete(): boolean {
        return this.getConfigItem("deleteOnFileDelete") ?? false;
    }

    public get resolveP4EDITOR(): string | undefined {
        return this.getConfigItem("resolve.p4editor");
    }

    public get swarmHost(): string | undefined {
        return this.getConfigItem("swarmHost");
    }

    public getSwarmLink(chnum: string): string | undefined {
        const host = this.swarmHost;
        if (!host) {
            return undefined;
        }
        if (host.includes("${chnum}")) {
            return host.replace("${chnum}", chnum);
        }
        return host + "/changes/" + chnum;
    }

    public get changelistSearchMaxResults(): number {
        return this.getConfigItem("changelistSearch.maxResults") ?? 200;
    }

    public get fileShelveMode(): FileShelveMode {
        const mode = this.getConfigItem<string>("fileShelveMode");
        if (mode === "keep both") {
            return FileShelveMode.KEEP_BOTH;
        }
        if (mode === "swap") {
            return FileShelveMode.SWAP;
        }
        return FileShelveMode.PROMPT;
    }

    public set fileShelveMode(mode: FileShelveMode) {
        if (mode === FileShelveMode.KEEP_BOTH) {
            this.setConfigItemGlobally("fileShelveMode", "keep both");
        } else if (mode === FileShelveMode.SWAP) {
            this.setConfigItemGlobally("fileShelveMode", "swap");
        } else if (mode === FileShelveMode.PROMPT) {
            this.setConfigItemGlobally("fileShelveMode", "prompt");
        }
    }

    public get annotateFollowBranches(): boolean {
        return this.getConfigItem("annotate.followBranches") ?? false;
    }

    public get syncMode(): SyncMode {
        const mode = this.getConfigItem<string>("syncMode");
        if (mode === "whole client") {
            return SyncMode.WHOLE_CLIENT;
        } else {
            return SyncMode.WORKSPACE_ONLY;
        }
    }
}

export const configAccessor = new ConfigAccessor();

export class WorkspaceConfigAccessor extends ConfigAccessor {
    constructor(private _workspaceUri: Uri) {
        super();
    }

    private getWorkspaceConfigItem<T>(item: string): T | undefined {
        return workspace.getConfiguration("perforce", this._workspaceUri).get<T>(item);
    }

    public get pwdOverride(): string | undefined {
        return this.getWorkspaceConfigItem("dir");
    }
}
