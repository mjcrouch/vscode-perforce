import * as vscode from "vscode";

import {
    SelfExpandingTreeView as SelfExpandingTreeProvider,
    SelfExpandingTreeItem,
    SelfExpandingTreeRoot,
} from "../TreeView";
import { PerforceSCMProvider } from "../ScmProvider";
import { ClientRoot } from "../extension";
import * as Path from "path";
import { FilterItem, FilterRootItem, Filters } from "./Filters";
import { showQuickPickForChangelist } from "../quickPick/ChangeQuickPick";
import { Display } from "../Display";
import * as p4 from "../api/PerforceApi";
import { ChangeInfo } from "../api/CommonTypes";
import { isTruthy, pluralise, isPositiveOrZero } from "../TsUtils";

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

class GoToChangelist extends SelfExpandingTreeItem {
    constructor(private _chooseProvider: ChooseProviderTreeItem) {
        super("Go to changelist...");
    }

    async execute() {
        const selectedClient = this._chooseProvider.selectedClient;
        if (!selectedClient) {
            Display.showImportantError(
                "Please choose a context before entering a changelist number"
            );
            throw new Error("No context for changelist search");
        }

        const clipValue = await vscode.env.clipboard.readText();
        const value = isPositiveOrZero(clipValue) ? clipValue : undefined;

        const chnum = await vscode.window.showInputBox({
            placeHolder: "Changelist number",
            prompt: "Enter a changelist number",
            value,
            validateInput: (value) => {
                if (!isPositiveOrZero(value)) {
                    return "must be a positive number";
                }
            },
        });
        if (chnum !== undefined) {
            showQuickPickForChangelist(selectedClient.configSource, chnum);
        }
    }

    get command(): vscode.Command {
        return {
            command: "perforce.changeSearch.goToChangelist",
            arguments: [this],
            title: "Go to changelist",
        };
    }
}

class RunSearch extends SelfExpandingTreeItem {
    constructor(private _root: ChangelistTreeRoot) {
        super("Search Now");
    }

    get command(): vscode.Command {
        return {
            command: "perforce.changeSearch.run",
            arguments: [this._root],
            title: "Run Search",
        };
    }

    get iconPath() {
        return new vscode.ThemeIcon("search");
    }
}

class SearchResultItem extends SelfExpandingTreeItem {
    constructor(private _clientRoot: ClientRoot, private _change: ChangeInfo) {
        super(
            _change.chnum + ": " + _change.description.slice(0, 32),
            vscode.TreeItemCollapsibleState.None
        );
        this.description = _change.user;
    }

    get iconPath() {
        return new vscode.ThemeIcon(
            this._change.status === "pending" ? "tools" : "check"
        );
    }

    get command(): vscode.Command {
        return {
            command: "perforce.showQuickPick",
            arguments: [
                "change",
                this._clientRoot.configSource.toString(),
                this._change.chnum,
            ],
            title: "Show changelist quick pick",
        };
    }
}

interface Pinnable extends vscode.Disposable {
    pin: () => void;
    unpin: () => void;
    pinned: boolean;
}

function isPinnable(obj: any): obj is Pinnable {
    return obj && obj.pin && obj.unpin;
}

class SearchResultTree extends SelfExpandingTreeItem implements Pinnable {
    private _isPinned: boolean = false;
    constructor(
        private _clientRoot: ClientRoot,
        filters: Filters,
        private _results: ChangeInfo[]
    ) {
        super(
            SearchResultTree.makeLabelText(filters, _results),
            vscode.TreeItemCollapsibleState.Expanded
        );
        const children = _results.map((r) => new SearchResultItem(_clientRoot, r));
        children.forEach((child) => this.addChild(child));
    }

    static makeLabelText(filters: Filters, results: ChangeInfo[]) {
        const parts = [
            filters.status,
            filters.user ? "User: " + filters.user : undefined,
            filters.client ? "Client: " + filters.client : undefined,
        ].filter(isTruthy);
        const filterText = parts.length > 0 ? parts.join(" / ") : "no filters";
        return "(" + pluralise(results.length, "result") + ") " + filterText;
    }

    pin() {
        this._isPinned = true;
        this.didChange();
    }

    unpin() {
        this._isPinned = false;
        this.didChange();
    }

    get pinned() {
        return this._isPinned;
    }

    get contextValue() {
        return this._isPinned ? "results-pinned" : "results-unpinned";
    }

    showInQuickPick() {
        showResultsInQuickPick(this._clientRoot.configSource, this._results);
    }
}

class AllResultsTree extends SelfExpandingTreeItem {
    constructor() {
        super("Results", vscode.TreeItemCollapsibleState.Expanded, {
            reverseChildren: true,
        });
    }

    addResults(selectedClient: ClientRoot, filters: Filters, results: ChangeInfo[]) {
        this.removeUnpinned();
        this.addChild(new SearchResultTree(selectedClient, filters, results));
    }

    removeUnpinned() {
        const children = this.getChildren();
        children.forEach((child) => {
            if (isPinnable(child) && !child.pinned) {
                child.dispose();
            }
        });
    }
}

async function showResultsInQuickPick(resource: vscode.Uri, results: ChangeInfo[]) {
    const items: vscode.QuickPickItem[] = results.map((change) => {
        const statusIcon = change.status === "pending" ? "$(tools)" : "$(check)";
        return {
            label: change.chnum,
            description:
                "$(person) " + change.user + " " + statusIcon + " " + change.description,
        };
    });
    const chosen = await vscode.window.showQuickPick(items, {
        matchOnDescription: true,
        placeHolder: "Search results",
    });
    if (!chosen) {
        return;
    }
    showQuickPickForChangelist(resource, chosen.label);
}

class ChangelistTreeRoot extends SelfExpandingTreeRoot {
    private _chooseProvider: ChooseProviderTreeItem;
    private _filterRoot: FilterRootItem;
    private _allResults: AllResultsTree;
    constructor() {
        super();
        this._chooseProvider = new ChooseProviderTreeItem();
        this._filterRoot = new FilterRootItem(this._chooseProvider.selectedClient);
        this._subscriptions.push(
            this._chooseProvider.onChanged(() =>
                this._filterRoot.onDidChangeProvider(this._chooseProvider.selectedClient)
            )
        );
        this._allResults = new AllResultsTree();
        this.addChild(this._chooseProvider);
        this.addChild(new GoToChangelist(this._chooseProvider));
        this.addChild(this._filterRoot);
        this.addChild(new RunSearch(this));
        this.addChild(this._allResults);
    }

    async executeSearch() {
        const selectedClient = this._chooseProvider.selectedClient;
        if (!selectedClient) {
            Display.showImportantError("Please choose a context before searching");
            throw new Error("No context for changelist search");
        }
        const filters = this._filterRoot.currentFilters;
        const results = await vscode.window.withProgress(
            { location: { viewId: "perforce.searchChangelists" } },
            () => p4.getChangelists(selectedClient.configSource, filters)
        );

        this._allResults.addResults(selectedClient, filters, results);

        this.didChange();
    }
}

export function registerChangelistSearch() {
    vscode.commands.registerCommand(
        "perforce.changeSearch.chooseProvider",
        (arg: ChooseProviderTreeItem) => arg.chooseProvider()
    );

    vscode.commands.registerCommand(
        "perforce.changeSearch.setFilter",
        (arg: FilterItem<any>) => arg.requestNewValue()
    );

    vscode.commands.registerCommand(
        "perforce.changeSearch.goToChangelist",
        (arg: GoToChangelist) => arg.execute()
    );

    vscode.commands.registerCommand(
        "perforce.changeSearch.run",
        (arg: ChangelistTreeRoot) => arg.executeSearch()
    );

    vscode.commands.registerCommand(
        "perforce.changeSearch.pin",
        (arg: SearchResultTree) => arg.pin()
    );

    vscode.commands.registerCommand(
        "perforce.changeSearch.unpin",
        (arg: SearchResultTree) => arg.unpin()
    );

    vscode.commands.registerCommand(
        "perforce.changeSearch.delete",
        (arg: SearchResultTree) => arg.dispose()
    );

    vscode.commands.registerCommand(
        "perforce.changeSearch.showInQuickPick",
        (arg: SearchResultTree) => arg.showInQuickPick()
    );

    vscode.window.registerTreeDataProvider(
        "perforce.searchChangelists",
        new SelfExpandingTreeProvider(new ChangelistTreeRoot())
    );
}
