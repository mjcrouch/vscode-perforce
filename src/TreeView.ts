import * as vscode from "vscode";

export interface TreeNodeOptions {
    reverseChildren?: boolean;
}

type TreeRevealOptions = { select?: boolean; focus?: boolean; expand?: boolean | number };

export abstract class SelfExpandingTreeItem extends vscode.TreeItem
    implements vscode.Disposable {
    protected _subscriptions: vscode.Disposable[];
    private _children: Set<SelfExpandingTreeItem>;

    private _onDisposed: vscode.EventEmitter<void>;
    private _onChanged: vscode.EventEmitter<SelfExpandingTreeItem>;
    private _onRevealRequested: vscode.EventEmitter<
        [SelfExpandingTreeItem, TreeRevealOptions | undefined]
    >;
    private _parent?: SelfExpandingTreeItem;

    public get onDisposed() {
        return this._onDisposed.event;
    }
    public get onChanged() {
        return this._onChanged.event;
    }
    public get onRevealRequested() {
        return this._onRevealRequested.event;
    }

    protected didChange() {
        this._onChanged.fire();
    }

    private setParent(parent: SelfExpandingTreeItem) {
        this._parent = parent;
    }

    get parent() {
        return this._parent;
    }

    constructor(
        label: string,
        collapsibleState?: vscode.TreeItemCollapsibleState,
        private _options?: TreeNodeOptions
    ) {
        super(label, collapsibleState);
        this._onDisposed = new vscode.EventEmitter();
        this._onChanged = new vscode.EventEmitter();
        this._onRevealRequested = new vscode.EventEmitter();
        this._subscriptions = [];
        this._subscriptions.push(this._onChanged, this._onDisposed);
        this._children = new Set();
    }

    public addChild(item: SelfExpandingTreeItem) {
        if (this._children.add(item)) {
            item.setParent(this);
            this._subscriptions.push(
                item.onChanged((subItem) => this._onChanged.fire(subItem))
            );
            this._subscriptions.push(
                item.onDisposed(() => {
                    this._children.delete(item);
                    this._onChanged.fire(this);
                })
            );
            this._subscriptions.push(
                item.onRevealRequested((item) => {
                    this._onRevealRequested.fire(item);
                })
            );
        }
    }

    public reveal(options?: TreeRevealOptions) {
        this._onRevealRequested.fire([this, options]);
    }

    getChildren(): SelfExpandingTreeItem[] {
        const ret: SelfExpandingTreeItem[] = [];
        for (const child of this._children.values()) {
            ret.push(child);
        }
        return this._options?.reverseChildren ? ret.reverse() : ret;
    }

    dispose() {
        this._onDisposed.fire();
        this._subscriptions.forEach((s) => s.dispose());
        // dipose children after the listeners, so we don't get lots of noisy events
        this._children.forEach((child) => child.dispose());
        this._parent = undefined;
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
    private _treeView: vscode.TreeView<SelfExpandingTreeItem> | undefined;

    public get onDidChangeTreeData() {
        return this._changeEmitter.event;
    }

    public set treeView(treeView: vscode.TreeView<SelfExpandingTreeItem> | undefined) {
        this._treeView = treeView;
    }

    constructor(private _root: R) {
        this._subscriptions = [];
        this._changeEmitter = new vscode.EventEmitter();
        this._subscriptions.push(
            this._root.onChanged((item) => this._changeEmitter.fire(item))
        );
        this._subscriptions.push(
            this._root.onRevealRequested((item) =>
                this._treeView?.reveal(item[0], item[1])
            )
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

    getParent(
        element: SelfExpandingTreeItem
    ): vscode.ProviderResult<SelfExpandingTreeItem> {
        return element.parent;
    }

    private getRootElements(): SelfExpandingTreeItem[] {
        return this._root.getChildren();
    }
}
