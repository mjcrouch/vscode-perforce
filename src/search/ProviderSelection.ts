import * as vscode from "vscode";
import { ClientRoot } from "../extension";

export class ProviderSelection implements vscode.Disposable {
    private _selectedProvider?: ClientRoot;
    private _onDidChangeProvider: vscode.EventEmitter<ClientRoot | undefined>;

    get client() {
        return this._selectedProvider;
    }

    set client(client: ClientRoot | undefined) {
        this._selectedProvider = client;
        this._onDidChangeProvider.fire();
    }

    get onDidChangeProvider() {
        return this._onDidChangeProvider.event;
    }

    dispose() {
        this._onDidChangeProvider.dispose();
    }

    constructor() {
        this._onDidChangeProvider = new vscode.EventEmitter();
    }
}
