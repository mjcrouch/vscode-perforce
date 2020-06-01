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
import { showComboBoxInput } from "../ComboBoxInput";
import * as p4 from "../api/PerforceApi";
import { Display } from "../Display";
import { MementoItem } from "../MementoItem";

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

type StringMemento = MementoItem<SearchFilterValue<string>>;

type PickWithValue<T> = vscode.QuickPickItem & { value?: T };

export abstract class FilterItem<T> extends SelfExpandingTreeItem<any> {
    private _selected?: SearchFilterValue<T>;
    private _didChangeFilter: vscode.EventEmitter<void>;
    get onDidChangeFilter() {
        return this._didChangeFilter.event;
    }

    constructor(
        protected readonly _filter: SearchFilter,
        private _mementoItem: MementoItem<SearchFilterValue<T>>
    ) {
        super(_filter.name + ":", vscode.TreeItemCollapsibleState.None);
        this._didChangeFilter = new vscode.EventEmitter();
        this._subscriptions.push(this._didChangeFilter);
        this.setValueWithoutEvent(_mementoItem.value);
    }

    get command(): vscode.Command {
        return {
            command: "perforce.changeSearch.setFilter",
            title: "Set " + this._filter.name,
            arguments: [this],
        };
    }

    private setValueWithoutEvent(value?: SearchFilterValue<T>) {
        this._selected = value;
        if (value && value.value !== undefined) {
            this.description = this._selected?.label;
        } else {
            this.description = "<" + this._filter.defaultText + ">";
        }
        this._mementoItem.save(value);
    }

    private setValue(value?: SearchFilterValue<T>) {
        const didChange = this._selected !== value;

        this.setValueWithoutEvent(value);

        if (didChange) {
            this._didChangeFilter.fire();
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

    get contextValue() {
        return this._selected?.value !== undefined
            ? "filterItem-val"
            : "filterItem-empty";
    }

    reset(fireFilterUpdate = true) {
        this.setValue(undefined);
        this.didChange();
        if (fireFilterUpdate) {
            this._didChangeFilter.fire();
        }
    }
}
class StatusFilter extends FilterItem<ChangelistStatus> {
    constructor(memento: MementoItem<SearchFilterValue<ChangelistStatus>>) {
        super(
            {
                name: "Status",
                placeHolder: "Filter by changelist status",
                defaultText: "all",
            },
            memento
        );
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
    currentValue: string,
    getSearchResults: (value: string) => Promise<string[]>
): Promise<SearchFilterValue<string> | undefined> {
    const value = await vscode.window.showInputBox({
        prompt: placeHolder + " (use * for wildcards)",
        value: currentValue,
        placeHolder: placeHolder,
    });
    if (value === undefined) {
        return undefined;
    }
    if (value.includes("*")) {
        return showSearchResults(value, placeHolder, getSearchResults);
    }
    return {
        label: value,
        value: value || undefined,
    };
}

async function showSearchResults(
    filter: string,
    placeHolder: string,
    getSearchResults: (value: string) => Promise<string[]>
): Promise<SearchFilterValue<string> | undefined> {
    const results = await getSearchResults(filter);
    if (results.length < 1) {
        Display.showImportantError("No results found for filter " + filter);
        return;
    }
    const items = results.map((item) => {
        return {
            label: item,
            value: {
                label: item,
                value: item,
            },
            alwaysShow: true,
        };
    });
    const newChosen = await vscode.window.showQuickPick(items, { placeHolder });
    return newChosen?.value;
}

async function pickFromProviderOrCustom(
    placeHolder: string,
    currentValue: string | undefined,
    client: ClientRoot | undefined,
    clientValue: string | undefined,
    readableKey: string,
    getSearchResults: (value: string) => Promise<string[]>
) {
    const current: PickWithValue<SearchFilterValue<string>> | undefined =
        client && clientValue !== undefined
            ? {
                  label: "$(person) Current " + readableKey,
                  description: clientValue,
                  value: {
                      label: clientValue ?? "",
                      value: clientValue,
                  },
              }
            : undefined;
    const items: PickWithValue<SearchFilterValue<string>>[] = [
        current,
        {
            label: "$(chrome-close) Reset",
            description: "Don't filter by " + readableKey,
            value: {
                label: "any",
                value: undefined,
            },
        },
    ].filter(isTruthy);
    const customDescription = "Type a " + readableKey + " filter";
    const chosen = await showComboBoxInput(
        items,
        { placeHolder, matchOnDescription: true, insertBeforeIndex: 1 },
        (value) => {
            const isSearch = value.includes("*");
            return [
                {
                    label: value
                        ? (isSearch ? "$(search) Search for " : "$(edit) Entered ") +
                          readableKey +
                          ": " +
                          value
                        : "$(edit) Enter a " + readableKey,
                    description: value ? "" : customDescription,
                    detail: value
                        ? "\xa0".repeat(4) + "Use * as a wildcard to perform a search"
                        : "",
                    alwaysShow: true,
                    value: {
                        label: value,
                        value: value,
                    },
                },
            ];
        }
    );

    if (chosen?.description === customDescription && !chosen.value?.value) {
        return showFilterTextInput(
            "Enter a " + readableKey,
            currentValue ?? "",
            getSearchResults
        );
    } else if (chosen?.label.startsWith("$(search)")) {
        return showSearchResults(
            chosen.value?.value ?? "*",
            placeHolder,
            getSearchResults
        );
    }
    return chosen?.value;
}

class UserFilter extends FilterItem<string> {
    constructor(private _provider: ProviderSelection, memento: StringMemento) {
        super(
            {
                name: "User",
                placeHolder: "Filter by username",
                defaultText: "any",
            },
            memento
        );
    }

    public async chooseValue(): Promise<SearchFilterValue<string> | undefined> {
        const client = this._provider.client;
        if (!client) {
            throw new Error("No client selected");
        }
        return pickFromProviderOrCustom(
            this._filter.placeHolder,
            this.value,
            client,
            client.userName,
            "user",
            async (value) => {
                const users = await p4.users(client.configSource, {
                    max: 200,
                    userFilters: [value.replace("*", "...")],
                });
                return users.map((u) => u.user);
            }
        );
    }
}

class ClientFilter extends FilterItem<string> {
    constructor(private _provider: ProviderSelection, memento: StringMemento) {
        super(
            {
                name: "Client",
                placeHolder: "Filter by perforce client",
                defaultText: "any",
            },
            memento
        );
    }

    public async chooseValue(): Promise<SearchFilterValue<string> | undefined> {
        const client = this._provider.client;
        if (!client) {
            throw new Error("No client selected");
        }
        return pickFromProviderOrCustom(
            this._filter.placeHolder,
            this.value,
            this._provider.client,
            this._provider.client?.clientName,
            "perforce client",
            async (value) => {
                const clients = await p4.clients(client.configSource, {
                    max: 200,
                    nameFilter: value.replace("*", "..."),
                });
                return clients.map((c) => c.client);
            }
        );
    }
}

export class FileFilterValue extends SelfExpandingTreeItem<any> {
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

class FileFilterAdd extends SelfExpandingTreeItem<any> {
    constructor(private _command: vscode.Command) {
        super("Add path...");
    }

    get command() {
        return this._command;
    }
}

export class FileFilterRoot extends SelfExpandingTreeItem<
    FileFilterAdd | FileFilterValue
> {
    private _didChangeFilter: vscode.EventEmitter<void>;
    get onDidChangeFilter() {
        return this._didChangeFilter.event;
    }

    constructor(
        private _provider: ProviderSelection,
        private _memento: MementoItem<string[]>
    ) {
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
        this._didChangeFilter = new vscode.EventEmitter();
        this._subscriptions.push(this._didChangeFilter);
        this.loadFromMemento();
    }

    // needs to happen after constructor is done!
    private loadFromMemento() {
        this._memento.value?.forEach((saved) =>
            this.addSelectedFilterWithoutEvent(new FileFilterValue(saved))
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
            : PerforceUri.fsPathWithoutRev(openUri);
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
                label: "Current Editor File",
                description: filePath,
                value: filePath,
            },
            {
                label: "Current File's Folder",
                description: fileWildcard,
                value: fileWildcard,
            },
        ];
    }

    private async pickNewFilter() {
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

        const existingChildren = this.getChildren();
        const options = [clientRoot, clientSource, ...this.makeOpenFilePicks()]
            .filter(isTruthy)
            .filter(
                (opt) =>
                    !existingChildren.some((existing) => existing.label === opt.value)
            );

        const customDescription = "Type a path";
        const chosen = await showComboBoxInput(
            options,
            {
                matchOnDescription: true,
                placeHolder: "Filter by a depot or file path",
            },
            (value) => {
                return [
                    {
                        label: value ? "Entered path: " + value : "Enter a path",
                        description: value ? "" : customDescription,
                        detail: value
                            ? "\xa0".repeat(4) + "Use ... for wildcards"
                            : undefined,
                        alwaysShow: true,
                        value: value,
                    },
                ];
            }
        );

        if (!chosen) {
            return;
        }

        return chosen.description === customDescription && !chosen.value
            ? await this.enterCustomValue()
            : chosen.value;
    }

    async addNewFilter() {
        const value = await this.pickNewFilter();
        if (value) {
            this.addSelectedFilter(value);
            this.saveDefault();
        }
    }

    private addSelectedFilterWithoutEvent(val: FileFilterValue) {
        this.addChild(val);
        this._subscriptions.push(
            val.onDisposed(() => {
                this._didChangeFilter.fire();
                this.saveDefault();
            }),
            val.onChanged(() => {
                this._didChangeFilter.fire();
                this.saveDefault();
            })
        );
    }

    private addSelectedFilter(value: string) {
        const val = new FileFilterValue(value);

        this.addSelectedFilterWithoutEvent(val);

        this.didChange();
        this._didChangeFilter.fire();

        val.reveal();
    }

    get value(): string[] {
        return this.getChildren()
            .filter((child) => child.contextValue === "fileFilter")
            .map((file) => file.label)
            .filter(isTruthy);
    }

    reset(fireFilterUpdate = true) {
        this.getChildren()
            .filter((child) => child.contextValue === "fileFilter")
            .forEach((child) => child.dispose());

        if (fireFilterUpdate) {
            this._didChangeFilter.fire();
        }
        this.didChange();
        this.saveDefault();
    }

    private saveDefault() {
        this._memento.save(this.value);
    }
}

export class FilterRootItem extends SelfExpandingTreeItem<any> {
    private _userFilter: UserFilter;
    private _clientFilter: ClientFilter;
    private _statusFilter: StatusFilter;
    private _fileFilter: FileFilterRoot;

    private _didChangeFilters: vscode.EventEmitter<void>;
    get onDidChangeFilters() {
        return this._didChangeFilters.event;
    }

    constructor(provider: ProviderSelection, memento: vscode.Memento) {
        super("Filters", vscode.TreeItemCollapsibleState.Expanded);
        this._statusFilter = new StatusFilter(
            new MementoItem("changeSearch.statusFilter", memento)
        );
        this.addChild(this._statusFilter);
        this._userFilter = new UserFilter(
            provider,
            new MementoItem("changeSearch.userFilter", memento)
        );
        this.addChild(this._userFilter);
        this._clientFilter = new ClientFilter(
            provider,
            new MementoItem("changeSearch.clientFilter", memento)
        );
        this.addChild(this._clientFilter);
        this._fileFilter = new FileFilterRoot(
            provider,
            new MementoItem("changeSearch.fileFilters", memento)
        );
        this.addChild(this._fileFilter);
        this._didChangeFilters = new vscode.EventEmitter();

        this.subscribeToChanges([
            this._statusFilter,
            this._userFilter,
            this._clientFilter,
            this._fileFilter,
        ]);

        this._subscriptions.push(this._didChangeFilters);
    }

    subscribeToChanges(filters: (FilterItem<any> | FileFilterRoot)[]) {
        filters.forEach((f) =>
            this._subscriptions.push(
                f.onDidChangeFilter(() => this._didChangeFilters.fire())
            )
        );
    }

    public get currentFilters(): Filters {
        return {
            status: this._statusFilter.value,
            client: this._clientFilter.value,
            user: this._userFilter.value,
            files: this._fileFilter.value,
        };
    }

    resetAllFilters() {
        this._userFilter.reset(false);
        this._clientFilter.reset(false);
        this._statusFilter.reset(false);
        this._fileFilter.reset(false);
        this._didChangeFilters.fire();
    }

    public contextValue = "filterRoot";
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
