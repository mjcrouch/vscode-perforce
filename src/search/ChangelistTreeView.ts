import * as vscode from "vscode";

import {
    SelfExpandingTreeView as SelfExpandingTreeProvider,
    SelfExpandingTreeItem,
    SelfExpandingTreeRoot,
} from "../TreeView";
import { PerforceSCMProvider } from "../ScmProvider";
import { ClientRoot } from "../extension";
import * as Path from "path";
import { isTruthy } from "../TsUtils";

class ChangelistTreeItem extends SelfExpandingTreeItem {}

class ChooseProviderTreeItem extends SelfExpandingTreeItem {
    private _selectedClient?: ClientRoot;

    constructor() {
        super("Context:", vscode.TreeItemCollapsibleState.None);

        this._subscriptions.push(
            PerforceSCMProvider.onDidChangeScmProviders(
                this.onDidChangeScmProviders.bind(this)
            )
        );

        this.setClient(PerforceSCMProvider.clientRoots[0]);
    }

    get selectedClient() {
        return this._selectedClient;
    }

    private setClient(client?: ClientRoot) {
        this._selectedClient = client;
        if (client) {
            this.description = client.clientName + " / " + client.userName;
        } else {
            this.description = "<choose a perforce instance>";
        }
    }

    private onDidChangeScmProviders() {
        if (
            !this._selectedClient ||
            !PerforceSCMProvider.GetInstanceByClient(this._selectedClient)
        ) {
            this.setClient(PerforceSCMProvider.clientRoots[0]);
            this.didChange();
        }
    }

    public get command(): vscode.Command {
        return {
            command: "perforce.changeSearch.chooseProvider",
            title: "Choose Provider",
            tooltip: "Choose a perforce instance for performing the search",
            arguments: [this],
        };
    }

    public async chooseProvider() {
        const items = PerforceSCMProvider.clientRoots.map<
            vscode.QuickPickItem & { client: ClientRoot }
        >((client) => {
            return {
                label: Path.basename(client.clientRoot.fsPath),
                description: client.clientName + " $(person) " + client.userName,
                client,
            };
        });
        const chosen = await vscode.window.showQuickPick(items, {
            matchOnDescription: true,
            placeHolder: "Choose a perforce instance to use as context for the search",
        });

        if (chosen && chosen.client !== this._selectedClient) {
            this.setClient(chosen.client);
            this.didChange();
        }
    }

    public tooltip = "Choose a perforce instance to use as context for the search";
}

type SearchFilterValue = {
    label: string;
    value?: string;
};

type SearchFilter = {
    name: string;
    placeHolder: string;
    defaultText: string;
};

type PickWithValue = vscode.QuickPickItem & { value?: SearchFilterValue };

abstract class FilterItem extends SelfExpandingTreeItem {
    private _selected?: SearchFilterValue;
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

    private setValue(value?: SearchFilterValue) {
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
    abstract chooseValue(): Promise<SearchFilterValue | undefined>;
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
class StatusFilter extends FilterItem {
    constructor() {
        super({
            name: "Status",
            placeHolder: "Filter by changelist status",
            defaultText: "all",
        });
    }

    async chooseValue() {
        const items: PickWithValue[] = [
            {
                label: "$(tools) Pending",
                description: "Search for pending changelists",
                value: {
                    label: "pending",
                    value: "pending",
                },
            },
            {
                label: "$(check) Submitted",
                description: "Search for submitted changelists",
                value: {
                    label: "submitted",
                    value: "submitted",
                },
            },
            {
                label: "$(files) Shelved",
                description: "Search for shelved changelists",
                value: {
                    label: "shelved",
                    value: "shelved",
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
): Promise<SearchFilterValue | undefined> {
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

async function pickFromProviderOrCustom(
    placeHolder: string,
    currentValue: string | undefined,
    client: ClientRoot | undefined,
    clientValue: string | undefined,
    readableKey: string
) {
    const current: PickWithValue | undefined =
        client && clientValue !== undefined
            ? {
                  label: "$(person) Current " + readableKey,
                  description: clientValue,
                  value: {
                      label: clientValue,
                      value: clientValue,
                  },
              }
            : undefined;
    const custom: PickWithValue = {
        label: "$(edit) Enter a " + readableKey + "...",
        description: "Filter by a different " + readableKey,
    };
    const items: PickWithValue[] = [
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

class UserFilter extends FilterItem {
    constructor() {
        super({
            name: "User",
            placeHolder: "Filter by username",
            defaultText: "any",
        });
    }

    public async chooseValue(): Promise<SearchFilterValue | undefined> {
        return pickFromProviderOrCustom(
            this._filter.placeHolder,
            this.value,
            this.client,
            this.client?.userName,
            "user"
        );
    }
}

class ClientFilter extends FilterItem {
    constructor() {
        super({
            name: "Client",
            placeHolder: "Filter by perforce client",
            defaultText: "any",
        });
    }

    public async chooseValue(): Promise<SearchFilterValue | undefined> {
        return pickFromProviderOrCustom(
            this._filter.placeHolder,
            this.value,
            this.client,
            this.client?.clientName,
            "perforce client"
        );
    }
}

class FilterRootItem extends SelfExpandingTreeItem {
    private _userFilter: UserFilter;
    private _clientFilter: ClientFilter;

    constructor(private _client: ClientRoot | undefined) {
        super("Filters", vscode.TreeItemCollapsibleState.Expanded);
        this.addChild(new StatusFilter());
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
}

class ChangelistTreeRoot extends SelfExpandingTreeRoot {
    constructor() {
        super();
        const chooseProvider = new ChooseProviderTreeItem();
        const filterRoot = new FilterRootItem(chooseProvider.selectedClient);
        this._subscriptions.push(
            chooseProvider.onChanged(() =>
                filterRoot.onDidChangeProvider(chooseProvider.selectedClient)
            )
        );
        this.addChild(chooseProvider);
        this.addChild(filterRoot);
    }
}

export function registerChangelistSearch() {
    vscode.commands.registerCommand(
        "perforce.changeSearch.chooseProvider",
        (arg: ChooseProviderTreeItem) => arg.chooseProvider()
    );

    vscode.commands.registerCommand(
        "perforce.changeSearch.setFilter",
        (arg: FilterItem) => arg.requestNewValue()
    );

    vscode.window.registerTreeDataProvider(
        "perforce.searchChangelists",
        new SelfExpandingTreeProvider(new ChangelistTreeRoot())
    );
}
