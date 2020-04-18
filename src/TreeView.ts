import * as vscode from "vscode";

export class SelfExpandingTreeItem extends vscode.TreeItem implements vscode.Disposable {
    protected _subscriptions: vscode.Disposable[];
    private _children: Set<SelfExpandingTreeItem>;

    private _onDisposed: vscode.EventEmitter<void>;
    private _onChanged: vscode.EventEmitter<SelfExpandingTreeItem>;

    public get onDisposed() {
        return this._onDisposed.event;
    }
    public get onChanged() {
        return this._onChanged.event;
    }

    protected didChange() {
        this._onChanged.fire();
    }

    constructor(label: string, collapsibleState?: vscode.TreeItemCollapsibleState) {
        super(label, collapsibleState);
        this._onDisposed = new vscode.EventEmitter();
        this._onChanged = new vscode.EventEmitter();
        this._subscriptions = [];
        this._subscriptions.push(this._onChanged, this._onDisposed);
        this._children = new Set();
    }

    public addChild(item: SelfExpandingTreeItem) {
        if (this._children.add(item)) {
            this._subscriptions.push(
                item.onChanged((subItem) => this._onChanged.fire(subItem))
            );
            this._subscriptions.push(
                item.onDisposed(() => {
                    this._children.delete(item);
                    this._onChanged.fire(this);
                })
            );
        }
    }

    getChildren(): SelfExpandingTreeItem[] {
        const ret: SelfExpandingTreeItem[] = [];
        for (const child of this._children.values()) {
            ret.push(child);
        }
        return ret;
    }

    dispose() {
        this._onDisposed.fire();
        this._subscriptions.forEach((s) => s.dispose());
        // dipose children after the listeners, so we don't get lots of noisy events
        this._children.forEach((child) => child.dispose());
    }
}

/**
 * Used to provide the root elements for a list, that don't need a label
 * - a bit of an inheritance hack, maybe a better way to do this
 */
export class SelfExpandingTreeRoot extends SelfExpandingTreeItem {
    constructor() {
        super("n/a");
    }
}

export class SelfExpandingTreeView<R extends SelfExpandingTreeItem>
    implements vscode.TreeDataProvider<SelfExpandingTreeItem> {
    private _changeEmitter: vscode.EventEmitter<SelfExpandingTreeItem | undefined>;
    private _subscriptions: vscode.Disposable[];

    public get onDidChangeTreeData() {
        return this._changeEmitter.event;
    }

    constructor(private _root: R) {
        this._subscriptions = [];
        this._changeEmitter = new vscode.EventEmitter();
        this._subscriptions.push(
            this._root.onChanged((item) => this._changeEmitter.fire(item))
        );
        this._subscriptions.push(this._changeEmitter, this._root);
    }

    dispose() {
        this._subscriptions.forEach((sub) => sub.dispose());
    }

    getTreeItem(element: SelfExpandingTreeItem) {
        return element;
    }

    getChildren(
        element?: SelfExpandingTreeItem
    ): vscode.ProviderResult<SelfExpandingTreeItem[]> {
        if (element) {
            return element.getChildren();
        } else {
            return this.getRootElements();
        }
    }

    private getRootElements(): SelfExpandingTreeItem[] {
        return this._root.getChildren();
    }
}
