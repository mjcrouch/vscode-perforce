import * as vscode from "vscode";
import { ClientRoot } from "../extension";

export class ProviderSelection {
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

    constructor() {
        this._onDidChangeProvider = new vscode.EventEmitter();
    }
}
