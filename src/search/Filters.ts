import * as vscode from "vscode";
import { ClientRoot } from "../extension";
import { SelfExpandingTreeItem } from "../TreeView";
import { isTruthy, pluralise } from "../TsUtils";
import { ChangelistStatus } from "../api/PerforceApi";
import { PerforceFile } from "../api/CommonTypes";
import * as PerforceUri from "../PerforceUri";
import * as Path from "path";
import { ProviderSelection } from "./ProviderSelection";
import { configAccessor } from "../ConfigService";

type SearchFilterValue<T> = {
    label: string;
    value?: T;
};

type SearchFilter = {
    name: string;
    placeHolder: string;
    defaultText: string;
};

export type Filters = {
    user?: string;
    client?: string;
    status?: ChangelistStatus;
    files?: PerforceFile[];
};

type PickWithValue<T> = vscode.QuickPickItem & { value?: T };

export abstract class FilterItem<T> extends SelfExpandingTreeItem {
    private _selected?: SearchFilterValue<T>;

    constructor(protected readonly _filter: SearchFilter) {
        super(_filter.name + ":", vscode.TreeItemCollapsibleState.None);
        this.setValue(undefined);
    }

    get command(): vscode.Command {
        return {
            command: "perforce.changeSearch.setFilter",
            title: "Set " + this._filter.name,
            arguments: [this],
        };
    }

    private setValue(value?: SearchFilterValue<T>) {
        this._selected = value;
        if (value && value.value !== undefined) {
            this.description = this._selected?.label;
        } else {
            this.description = "<" + this._filter.defaultText + ">";
        }
    }

    async requestNewValue() {
        const chosen = await this.chooseValue();
        if (chosen) {
            this.setValue(chosen);
            this.didChange();
        }
    }

    /**
     * Prompt the user for a value and return the result
     * Return undefined for cancellation. Return a SearchFilterValue with an undefined value to clear
     */
    abstract chooseValue(): Promise<SearchFilterValue<T> | undefined>;

    get value() {
        return this._selected?.value;
    }

    get tooltip() {
        return this._filter.placeHolder;
    }
}
class StatusFilter extends FilterItem<ChangelistStatus> {
    constructor() {
        super({
            name: "Status",
            placeHolder: "Filter by changelist status",
            defaultText: "all",
        });
    }

    async chooseValue() {
        const items: PickWithValue<SearchFilterValue<ChangelistStatus>>[] = [
            {
                label: "$(tools) Pending",
                description: "Search for pending changelists",
                value: {
                    label: "pending",
                    value: ChangelistStatus.PENDING,
                },
            },
            {
                label: "$(check) Submitted",
                description: "Search for submitted changelists",
                value: {
                    label: "submitted",
                    value: ChangelistStatus.SUBMITTED,
                },
            },
            {
                label: "$(files) Shelved",
                description: "Search for shelved changelists",
                value: {
                    label: "shelved",
                    value: ChangelistStatus.SHELVED,
                },
            },
            {
                label: "$(chrome-close) Reset",
                description: "Don't filter by changelist status",
                value: {
                    label: "all",
                    value: undefined,
                },
            },
        ];
        const chosen = await vscode.window.showQuickPick(items, {
            placeHolder: this._filter.placeHolder,
        });
        return chosen?.value;
    }
}

async function showFilterTextInput(
    placeHolder: string,
    currentValue?: string
): Promise<SearchFilterValue<string> | undefined> {
    const value = await vscode.window.showInputBox({
        prompt: placeHolder,
        value: currentValue,
        placeHolder: placeHolder,
    });
    if (value === undefined) {
        return undefined;
    }
    return {
        label: value,
        value: value || undefined,
    };
}

async function pickFromProviderOrCustom<T>(
    placeHolder: string,
    currentValue: string | undefined,
    client: ClientRoot | undefined,
    clientValue: T | undefined,
    readableKey: string,
    readableValue: string | undefined
) {
    const current: PickWithValue<SearchFilterValue<T>> | undefined =
        client && clientValue !== undefined
            ? {
                  label: "$(person) Current " + readableKey,
                  description: readableValue,
                  value: {
                      label: readableValue ?? "",
                      value: clientValue,
                  },
              }
            : undefined;
    const custom: PickWithValue<SearchFilterValue<T>> = {
        label: "$(edit) Enter a " + readableKey + "...",
        description: "Filter by a different " + readableKey,
    };
    const items: PickWithValue<SearchFilterValue<T>>[] = [
        current,
        custom,
        {
            label: "$(chrome-close) Reset",
            description: "Don't filter by " + readableKey,
            value: {
                label: "any",
                value: undefined,
            },
        },
    ].filter(isTruthy);
    const chosen = await vscode.window.showQuickPick(items, {
        placeHolder: placeHolder,
    });
    if (chosen === custom) {
        return showFilterTextInput("Enter a " + readableKey, currentValue);
    }
    return chosen?.value;
}

class UserFilter extends FilterItem<string> {
    constructor(private _provider: ProviderSelection) {
        super({
            name: "User",
            placeHolder: "Filter by username",
            defaultText: "any",
        });
    }

    public async chooseValue(): Promise<SearchFilterValue<string> | undefined> {
        return pickFromProviderOrCustom(
            this._filter.placeHolder,
            this.value,
            this._provider.client,
            this._provider.client?.userName,
            "user",
            this._provider.client?.userName
        );
    }
}

class ClientFilter extends FilterItem<string> {
    constructor(private _provider: ProviderSelection) {
        super({
            name: "Client",
            placeHolder: "Filter by perforce client",
            defaultText: "any",
        });
    }

    public async chooseValue(): Promise<SearchFilterValue<string> | undefined> {
        return pickFromProviderOrCustom(
            this._filter.placeHolder,
            this.value,
            this._provider.client,
            this._provider.client?.clientName,
            "perforce client",
            this._provider.client?.clientName
        );
    }
}

export class FileFilterValue extends SelfExpandingTreeItem {
    constructor(path: string) {
        super(path);
    }

    get contextValue() {
        return "fileFilter";
    }

    get iconPath() {
        return new vscode.ThemeIcon("file");
    }

    async edit() {
        const value = await vscode.window.showInputBox({
            prompt: "Enter a local file or depot path. Use '...' for wildcards",
            validateInput: (val) => {
                if (val.trim() === "") {
                    return "Please enter a value";
                }
            },
            value: this.label,
        });
        if (value) {
            this.label = value;
            this.didChange();
        }
    }
}

class FileFilterAdd extends SelfExpandingTreeItem {
    constructor(private _command: vscode.Command) {
        super("Add path...");
    }

    get command() {
        return this._command;
    }
}

export class FileFilterRoot extends SelfExpandingTreeItem {
    constructor(private _provider: ProviderSelection) {
        super("Files", vscode.TreeItemCollapsibleState.Expanded, {
            reverseChildren: true,
        });
        this.description = "Any of the following paths:";
        this.addChild(
            new FileFilterAdd({
                command: "perforce.changeSearch.addFileFilter",
                arguments: [this],
                title: "Add file filter",
            })
        );
    }

    get contextValue() {
        return "fileFilters";
    }

    private async getFilePathFromClipboard() {
        const clipValue = (await vscode.env.clipboard.readText())?.split("\n")[0];
        const clipValid =
            clipValue?.includes("/") ||
            clipValue?.includes("\\") ||
            clipValue?.includes("...");
        return clipValid ? clipValue : undefined;
    }

    private getOpenFilePath() {
        const openUri = vscode.window.activeTextEditor?.document.uri;
        if (!openUri || (openUri.scheme !== "perforce" && openUri.scheme !== "file")) {
            return undefined;
        }
        const filePath = PerforceUri.isDepotUri(openUri)
            ? PerforceUri.getDepotPathFromDepotUri(openUri)
            : openUri.fsPath;
        return filePath;
    }

    private getClientRootPath() {
        return this._provider.client?.clientRoot.fsPath
            ? Path.join(this._provider.client.clientRoot.fsPath, "...")
            : undefined;
    }

    private getClientConfigSourcePath() {
        return this._provider.client?.configSource.fsPath
            ? Path.join(this._provider.client.configSource.fsPath, "...")
            : undefined;
    }

    private async enterCustomValue() {
        const clipPath = await this.getFilePathFromClipboard();
        const value = await vscode.window.showInputBox({
            prompt: "Enter a local file or depot path. Use '...' for wildcards",
            validateInput: (val) => {
                if (val.trim() === "") {
                    return "Please enter a value";
                }
            },
            value: clipPath ?? this.getOpenFilePath() ?? this.getClientConfigSourcePath(),
        });
        return value;
    }

    private makeOpenFilePicks(): PickWithValue<string>[] {
        const filePath = this.getOpenFilePath();
        if (!filePath) {
            return [];
        }
        const fileWildcard =
            Path.dirname(filePath) + (filePath.startsWith("/") ? "/" : Path.sep) + "...";
        return [
            {
                label: "Open File",
                description: filePath,
                value: filePath,
            },
            {
                label: "Open File's Directory",
                description: fileWildcard,
                value: fileWildcard,
            },
        ];
    }

    private async pickNewFilter() {
        const custom: PickWithValue<string> = {
            label: "Enter path...",
            description: "Enter a file or depot path",
        };
        const rootPath = this.getClientRootPath();
        const clientRoot: PickWithValue<string> | undefined = rootPath
            ? {
                  label: "Client Root",
                  description: rootPath,
                  value: rootPath,
              }
            : undefined;
        const sourcePath = this.getClientConfigSourcePath();
        const clientSource: PickWithValue<string> | undefined =
            sourcePath && rootPath !== sourcePath
                ? {
                      label: "Workspace location",
                      description: sourcePath,
                      value: sourcePath,
                  }
                : undefined;

        const options = [
            clientRoot,
            clientSource,
            ...this.makeOpenFilePicks(),
            custom,
        ].filter(isTruthy);

        const chosen = await vscode.window.showQuickPick(options, {
            matchOnDescription: true,
            placeHolder: "Filter by a depot or file path",
        });

        if (!chosen) {
            return;
        }

        return chosen === custom ? await this.enterCustomValue() : chosen.value;
    }

    async addNewFilter() {
        const value = await this.pickNewFilter();
        if (value) {
            this.addChild(new FileFilterValue(value));
            this.didChange();
        }
    }

    get value(): string[] {
        return this.getChildren()
            .filter((child) => child.contextValue === "fileFilter")
            .map((file) => file.label)
            .filter(isTruthy); // TODO bleh
    }
}

export class FilterRootItem extends SelfExpandingTreeItem {
    private _userFilter: UserFilter;
    private _clientFilter: ClientFilter;
    private _statusFilter: StatusFilter;
    private _fileFilter: FileFilterRoot;

    constructor(provider: ProviderSelection) {
        super("Filters", vscode.TreeItemCollapsibleState.Expanded);
        this._statusFilter = new StatusFilter();
        this.addChild(this._statusFilter);
        this._userFilter = new UserFilter(provider);
        this.addChild(this._userFilter);
        this._clientFilter = new ClientFilter(provider);
        this.addChild(this._clientFilter);
        this._fileFilter = new FileFilterRoot(provider);
        this.addChild(this._fileFilter);
        //this.addChild(new FilterItem("User"));
        //this.addChild(new FilterItem("Paths"));
    }

    public get currentFilters(): Filters {
        return {
            status: this._statusFilter.value,
            client: this._clientFilter.value,
            user: this._userFilter.value,
            files: this._fileFilter.value,
        };
    }
}

export function makeFilterLabelText(filters: Filters, resultCount: number) {
    const parts = [
        filters.status ? filters.status : undefined,
        filters.user ? "User: " + filters.user : undefined,
        filters.client ? "Client: " + filters.client : undefined,
        filters.files && filters.files.length > 0
            ? pluralise(filters.files.length, "path")
            : undefined,
    ].filter(isTruthy);
    const filterText = parts.length > 0 ? parts.join("] [") : "no filters";
    return (
        "(" +
        pluralise(resultCount, "result", configAccessor.changelistSearchMaxResults) +
        ") [" +
        filterText +
        "]"
    );
}
