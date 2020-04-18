import * as vscode from "vscode";

import {
    SelfExpandingTreeView as SelfExpandingTreeProvider,
    SelfExpandingTreeItem,
    SelfExpandingTreeRoot,
} from "../TreeView";
import { PerforceSCMProvider } from "../ScmProvider";
import { ClientRoot } from "../extension";
import * as Path from "path";
import { eventNames } from "cluster";

class ChangelistTreeItem extends SelfExpandingTreeItem {}

class ChooseProviderTreeItem extends SelfExpandingTreeItem {
    private _selectedClient?: ClientRoot;

    constructor() {
        super("Search Context", vscode.TreeItemCollapsibleState.None);

        this._subscriptions.push(
            PerforceSCMProvider.onDidChangeScmProviders(
                this.onDidChangeScmProviders.bind(this)
            )
        );

        this.setClient(PerforceSCMProvider.clientRoots[0]);
    }

    private setClient(client?: ClientRoot) {
        this._selectedClient = client;
        if (client) {
            this.description = client.clientName + " / " + client.userName;
        } else {
            this.description = "Choose a perforce client as context for the search";
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
            tooltip: "Choose the perforce client for performing the search",
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
            placeHolder: "Choose a perforce client to use as the context for the search",
        });

        if (chosen && chosen.client !== this._selectedClient) {
            this.setClient(chosen.client);
            this.didChange();
        }
    }

    public tooltip = "Choose a perforce client to use as context for the search";
}

type SearchFilterValue = {
    label: string;
    description?: string;
    codicon?: string;
    value: string;
};

type SearchFilter = {
    name: string;
    placeHolder: string;
    values: () => SearchFilterValue[];
    defaultValue?: () => SearchFilterValue | undefined;
};

type SearchFilterValueItem = vscode.QuickPickItem & { value?: SearchFilterValue };

class FilterItem extends SelfExpandingTreeItem {
    private _selected?: SearchFilterValue;

    constructor(private _filter: SearchFilter) {
        super(_filter.name + ":", vscode.TreeItemCollapsibleState.None);
        this.setSelected(_filter.defaultValue?.());
    }

    get command(): vscode.Command {
        return {
            command: "perforce.changeSearch.setFilter",
            title: "Set " + this._filter.name,
            arguments: [this],
        };
    }

    private setSelected(value?: SearchFilterValue) {
        this._selected = value;
        if (value) {
            this.description = this._selected?.label;
        } else {
            this.description = "...";
        }
    }

    private toQuickPickItems(values: SearchFilterValue[]): SearchFilterValueItem[] {
        return values.map<SearchFilterValueItem>((val) => {
            return {
                value: val,
                label: "$(" + (val.codicon ?? "search") + ") " + val.label,
                description: val.description,
            };
        });
    }

    public async chooseValue() {
        const reset: SearchFilterValueItem = {
            label: "$(chrome-close) Reset",
            description: "Clear this filter",
            value: undefined,
        };
        const items = this.toQuickPickItems(this._filter.values()).concat(reset);
        const chosen = await vscode.window.showQuickPick(items, {
            placeHolder: this._filter.placeHolder,
        });
        if (chosen) {
            this.setSelected(chosen.value);
            this.didChange();
        }
    }

    get value() {
        return "";
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
            values: () => [
                {
                    label: "Pending",
                    codicon: "tools",
                    description: "Search for pending changelists",
                    value: "pending",
                },
                {
                    label: "Submitted",
                    codicon: "check",
                    description: "Search for submitted changelists",
                    value: "submitted",
                },
                {
                    label: "Shelved",
                    codicon: "files",
                    description: "Search for shelved changelists",
                    value: "submitted",
                },
            ],
        });
    }
}

class FilterRootItem extends SelfExpandingTreeItem {
    constructor() {
        super("Filters", vscode.TreeItemCollapsibleState.Expanded);
        this.addChild(new StatusFilter());
        //this.addChild(new FilterItem("User"));
        //this.addChild(new FilterItem("Paths"));
    }
}

class ChangelistTreeRoot extends SelfExpandingTreeRoot {
    constructor() {
        super();
        this.addChild(new ChooseProviderTreeItem());
        this.addChild(new FilterRootItem());
    }
}

export function registerChangelistSearch() {
    vscode.commands.registerCommand(
        "perforce.changeSearch.chooseProvider",
        (arg: ChooseProviderTreeItem) => arg.chooseProvider()
    );

    vscode.commands.registerCommand(
        "perforce.changeSearch.setFilter",
        (arg: FilterItem) => arg.chooseValue()
    );

    vscode.window.registerTreeDataProvider(
        "perforce.searchChangelists",
        new SelfExpandingTreeProvider(new ChangelistTreeRoot())
    );
}
