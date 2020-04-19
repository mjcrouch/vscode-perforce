import * as vscode from "vscode";
import { ClientRoot } from "../extension";
import { SelfExpandingTreeItem } from "../TreeView";
import { isTruthy } from "../TsUtils";
import { ChangelistStatus } from "../api/PerforceApi";

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
};

type PickWithValue<T> = vscode.QuickPickItem & { value?: SearchFilterValue<T> };

export abstract class FilterItem<T> extends SelfExpandingTreeItem {
    private _selected?: SearchFilterValue<T>;
    private _client?: ClientRoot;

    protected get client() {
        return this._client;
    }

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
    changeProvider(client?: ClientRoot): void {
        this._client = client;
        this.onDidChangeProvider();
    }
    protected onDidChangeProvider(_client?: ClientRoot) {
        //
    }

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
        const items: PickWithValue<ChangelistStatus>[] = [
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
    const current: PickWithValue<T> | undefined =
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
    const custom: PickWithValue<T> = {
        label: "$(edit) Enter a " + readableKey + "...",
        description: "Filter by a different " + readableKey,
    };
    const items: PickWithValue<T>[] = [
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
    constructor() {
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
            this.client,
            this.client?.userName,
            "user",
            this.client?.userName
        );
    }
}

class ClientFilter extends FilterItem<string> {
    constructor() {
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
            this.client,
            this.client?.clientName,
            "perforce client",
            this.client?.clientName
        );
    }
}

export class FilterRootItem extends SelfExpandingTreeItem {
    private _userFilter: UserFilter;
    private _clientFilter: ClientFilter;
    private _statusFilter: StatusFilter;

    constructor(private _client: ClientRoot | undefined) {
        super("Filters", vscode.TreeItemCollapsibleState.Expanded);
        this._statusFilter = new StatusFilter();
        this.addChild(this._statusFilter);
        this._userFilter = new UserFilter();
        this.addChild(this._userFilter);
        this._clientFilter = new ClientFilter();
        this.addChild(this._clientFilter);
        //this.addChild(new FilterItem("User"));
        //this.addChild(new FilterItem("Paths"));
    }

    onDidChangeProvider(client?: ClientRoot) {
        if (this._client !== client) {
            this._client = client;
            this._userFilter.changeProvider(client);
            this._clientFilter.changeProvider(client);
        }
    }

    public get currentFilters(): Filters {
        return {
            status: this._statusFilter.value,
            client: this._clientFilter.value,
            user: this._userFilter.value,
        };
    }
}
