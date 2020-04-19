import * as vscode from "vscode";

import {
    SelfExpandingTreeView as SelfExpandingTreeProvider,
    SelfExpandingTreeItem,
    SelfExpandingTreeRoot,
} from "../TreeView";
import { PerforceSCMProvider } from "../ScmProvider";
import { ClientRoot } from "../extension";
import * as Path from "path";
import { FilterItem, FilterRootItem } from "./Filters";

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
